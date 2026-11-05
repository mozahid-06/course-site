#!/usr/bin/env node
// One-command deploy: build, deploy, then make the bucket ready for browser uploads.
//
// The order matters. Uploads go browser -> R2 with presigned URLs, so the bucket
// must allow the origin the Worker was just deployed to. That rule used to be a
// manual README step and was the one thing that silently broke on a fresh account.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  configureCors,
  discoverWorkersDevUrl,
  ensureBucket,
  ensureLifecycle,
  findDeployedUrl,
  listSecrets,
  missingSecrets,
  readConfig,
  resolveAccount,
  root,
  wranglerEnv,
  wranglerSpawn,
} from './cloudflare.mjs';

const isWin = process.platform === 'win32';

/** Run a command, stream its output, and return everything it printed. */
function runStreaming(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

function printSecretHelp(account) {
  console.log('\nAdd them with:');
  console.log('  npx wrangler secret put SESSION_SECRET     # random, 32+ characters');
  console.log('  npx wrangler secret put ADMIN_EMAIL        # the owner\'s email');
  console.log('  npx wrangler secret put R2_ACCESS_KEY_ID');
  console.log('  npx wrangler secret put R2_SECRET_ACCESS_KEY');
  console.log(`  npx wrangler secret put R2_ACCOUNT_ID       # ${account.id}`);
  console.log(
    'Create the R2 access key under Cloudflare dashboard -> R2 -> Manage API tokens ' +
      '(Object Read & Write on the bucket).',
  );
}

function printUploadSetupFailure(siteUrl) {
  const target = siteUrl ? `SITE_URL=${siteUrl}` : 'SITE_URL=<your site URL>';
  console.log('\n================================================================');
  console.log('Browser uploads are NOT configured yet.');
  console.log('The site is live, but the Files tab will fail until the bucket allows it.');
  console.log('Run this once from a machine signed in to Cloudflare:');
  console.log(`  ${target} npm run setup:r2`);
  console.log('(If this ran in Workers Builds, give the build token R2 access, or run');
  console.log(' `npm run deploy` locally instead.)');
  console.log('================================================================\n');
}

async function main() {
  const account = resolveAccount();
  const env = wranglerEnv(account);
  const { bucket, worker } = readConfig();
  // Workers Builds already ran the build command, and its token may not be allowed
  // to manage R2. There, provisioning is best-effort: deploy must still succeed.
  const inCi = env.WORKERS_CI === '1' || env.CI === 'true' || env.CI === '1';

  console.log(`Cloudflare account: ${account.name ?? account.id} (${account.id})`);
  console.log(`Worker:             ${worker}`);
  console.log(`R2 bucket:          ${bucket}\n`);

  // Older Wrangler versions cached the first account they saw and kept using it
  // even after `wrangler login` switched accounts. The cache is safe to drop, and
  // every command below passes the resolved account explicitly anyway.
  const staleCache = join(root, 'node_modules', '.cache', 'wrangler', 'wrangler-account.json');
  if (existsSync(staleCache)) {
    try {
      const cached = JSON.parse(readFileSync(staleCache, 'utf8'))?.account?.id;
      if (cached && cached !== account.id) {
        console.log(`Cleared a stale Wrangler account cache (${cached}).`);
      }
    } catch {
      // unreadable cache: still safe to delete
    }
    rmSync(staleCache, { force: true });
  }

  // A fresh account has no bucket, and the deploy fails without one.
  try {
    const bucketState = ensureBucket(bucket, env);
    console.log(`Bucket: ${bucketState === 'created' ? 'created' : 'already exists'}`);
  } catch (error) {
    if (!inCi) throw error;
    console.warn(`\nCould not check the bucket from this build: ${error.message}`);
  }
  try {
    ensureLifecycle(bucket, env);
  } catch (error) {
    console.warn(`\nCould not add the multipart cleanup rule: ${error.message}`);
    console.warn('Uploads still work; `npm run setup:r2` adds it later.');
  }

  const built = existsSync(join(root, 'dist', 'web', 'browser', 'index.html'));
  if (inCi && built) {
    console.log('Using the build produced by Workers Builds.');
  } else {
    console.log('Building…');
    const npm = isWin ? 'npm.cmd' : 'npm';
    const build = spawnSync(npm, ['run', 'build'], { cwd: root, env, stdio: 'inherit' });
    if (build.status !== 0) {
      console.error('\nBuild failed; nothing was deployed.');
      process.exit(build.status ?? 1);
    }
  }

  console.log('\nDeploying…');
  const { command, args } = wranglerSpawn(['deploy']);
  const deploy = await runStreaming(command, args, env);
  if (deploy.code !== 0) {
    console.error('\nDeploy failed. Nothing was changed in the bucket settings.');
    process.exit(deploy.code ?? 1);
  }

  let siteUrl = process.env.SITE_URL || findDeployedUrl(deploy.output);
  if (!siteUrl) siteUrl = await discoverWorkersDevUrl(account, worker, env);

  let failed = false;
  if (!siteUrl) {
    console.warn(
      '\nCould not detect the deployed URL (custom domain or unusual output). ' +
        'Set SITE_URL=https://your-site and run `npm run setup:r2` so the browser can upload.',
    );
  } else {
    try {
      console.log(`\nAllowing browser uploads from ${siteUrl} …`);
      const { origins } = configureCors({ siteUrl, env });
      console.log(`Bucket CORS now allows ${origins.length} origin(s):`);
      for (const origin of origins) console.log(`  ${origin}`);
      console.log('Cloudflare can take up to ~30 seconds to apply the rule.');
    } catch (error) {
      console.error(`\nUpload setup failed: ${error.message}`);
      if (inCi) {
        printUploadSetupFailure(siteUrl);
      } else {
        failed = true;
        console.error('Browser uploads will not work until this is fixed.');
      }
    }
  }

  const names = listSecrets(env);
  const { required, upload } = missingSecrets(names);
  if (names === null) {
    console.warn('\nCould not read the Worker secret list; check secrets in the dashboard.');
  } else if (required.length || upload.length) {
    if (required.length) {
      console.warn(`\nMissing required secrets: ${required.join(', ')}`);
      console.warn('The site runs, but sign-in and the admin panel will not work until they are set.');
    }
    if (upload.length) {
      console.warn(`\nMissing upload secrets: ${upload.join(', ')}`);
      console.warn('Everything else works, but the Files tab cannot upload (it answers 503).');
    }
    printSecretHelp(account);
  } else {
    console.log('\nSecrets: all required and upload secrets are set.');
  }

  console.log(siteUrl ? `\nDone. ${siteUrl}` : '\nDone.');
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(`\nDeploy failed: ${error.message}`);
  process.exit(1);
});

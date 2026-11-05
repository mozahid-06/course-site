#!/usr/bin/env node
// Diagnoses the pieces that only break in a real browser: the account Wrangler
// talks to, the bucket, the CORS rule, the multipart cleanup rule and the secrets.
//
//   npm run doctor
//   SITE_URL=https://your-site npm run doctor
//
// Exit code is 1 when a required check fails, so CI can use it too.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getCors,
  listSecrets,
  missingSecrets,
  readConfig,
  resolveAccount,
  root,
  wrangler,
  wranglerEnv,
} from './cloudflare.mjs';

const problems = [];
let current = '';

function heading(text) {
  current = text;
  console.log(`\n${text}`);
}

function ok(text) {
  console.log(`  ok    ${text}`);
}

function warn(text) {
  console.log(`  warn  ${text}`);
}

function bad(text) {
  console.log(`  FAIL  ${text}`);
  problems.push(`${current}: ${text}`);
}

function hasIgnoreCase(values, wanted) {
  return [...values].some((value) => String(value).toLowerCase() === String(wanted).toLowerCase());
}

async function main() {
  const account = resolveAccount();
  const env = wranglerEnv(account);
  const { bucket, worker } = readConfig();

  console.log('Course site doctor');
  console.log(`Worker: ${worker}`);
  console.log(`Bucket: ${bucket}`);

  heading('Cloudflare account');
  ok(`${account.name ?? '(CLOUDFLARE_ACCOUNT_ID)'} — ${account.id}`);
  const staleCache = join(root, 'node_modules', '.cache', 'wrangler', 'wrangler-account.json');
  if (existsSync(staleCache)) {
    try {
      const cached = JSON.parse(readFileSync(staleCache, 'utf8'))?.account?.id;
      if (cached && cached !== account.id) {
        warn(
          `Wrangler has a stale account cache (${cached}). ` +
            'Run `rm -rf node_modules/.cache/wrangler` or `npm run deploy`, which clears it.',
        );
      }
    } catch {
      warn('The Wrangler account cache is unreadable; `npm run deploy` clears it.');
    }
  }

  heading('R2 bucket');
  const list = wrangler(['r2', 'bucket', 'list'], { env });
  if (list.status !== 0) {
    bad(`Could not list buckets:\n${(list.stderr || list.stdout || '').trim()}`);
  } else {
    const names = [...String(list.stdout).matchAll(/^name:\s+(.+)$/gm)].map((match) => match[1].trim());
    if (names.includes(bucket)) {
      ok(`Bucket "${bucket}" exists in this account.`);
    } else {
      bad(`Bucket "${bucket}" was not found in this account. Run \`npm run setup:r2\`.`);
    }
  }

  const lifecycle = wrangler(['r2', 'bucket', 'lifecycle', 'list', bucket], { env });
  const lifecycleText = `${lifecycle.stdout ?? ''}\n${lifecycle.stderr ?? ''}`;
  if (lifecycle.status === 0 && /abort incomplete multipart uploads/i.test(lifecycleText)) {
    ok('Incomplete multipart uploads are aborted automatically.');
  } else {
    warn('No multipart-abort lifecycle rule. Run `npm run setup:r2` to add it.');
  }

  heading('Upload CORS rule');
  try {
    const cors = getCors(bucket, env);
    if (!cors.origins.size) {
      bad('The bucket has no CORS rule; browser uploads will fail. Run `npm run setup:r2`.');
    } else {
      ok(`Origins: ${[...cors.origins].join(', ')}`);
    }
    if (cors.methods.has('PUT') && cors.methods.has('POST') && cors.methods.has('GET')) {
      ok(`Methods: ${[...cors.methods].join(', ')}`);
    } else {
      bad('The CORS rule must allow GET, HEAD, PUT and POST.');
    }
    if (hasIgnoreCase(cors.headers, 'content-type')) {
      ok('Header allowed: content-type');
    } else {
      bad('The CORS rule must allow the content-type request header.');
    }
    if (hasIgnoreCase(cors.expose, 'ETag')) {
      ok('Response header exposed: ETag (needed to finish multipart uploads).');
    } else {
      bad('The CORS rule must expose ETag, or uploads cannot be completed.');
    }
    const siteUrl = process.env.SITE_URL;
    if (siteUrl) {
      let origin;
      try {
        origin = new URL(siteUrl).origin;
      } catch {
        bad(`SITE_URL="${siteUrl}" is not a valid URL.`);
      }
      if (origin) {
        if (cors.origins.has(origin)) ok(`Site origin allowed: ${origin}`);
        else bad(`Site origin ${origin} is missing. Run \`SITE_URL=${origin} npm run setup:r2\`.`);
      }
    } else {
      warn('Set SITE_URL=https://your-site to check that the deployed origin is allowed.');
    }
  } catch (error) {
    bad(error.message);
  }

  heading('Worker secrets');
  const names = listSecrets(env);
  if (names === null) {
    warn('Could not list secrets; check Settings -> Variables and Secrets in the dashboard.');
  } else {
    const { required, upload } = missingSecrets(names);
    if (!required.length) ok(`Required secrets present: ${names.length} secret(s) total.`);
    else bad(`Missing required secrets: ${required.join(', ')} (sign-in and admin will not work).`);
    if (!upload.length) {
      ok('Upload secrets are set (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).');
    } else {
      bad(
        `Missing upload secrets: ${upload.join(', ')} — the Files tab answers 503. ` +
          'Create an R2 API token and add them with `npx wrangler secret put`.',
      );
    }
  }

  if (process.env.SITE_URL) {
    heading('Deployed site');
    try {
      const url = new URL(process.env.SITE_URL);
      const response = await fetch(`${url.origin}/api/me`);
      if (response.ok || response.status === 401) {
        ok(`${url.origin} answers (${response.status}).`);
      } else {
        warn(`${url.origin}/api/me answered ${response.status}.`);
      }
    } catch (error) {
      bad(`Could not reach ${process.env.SITE_URL}: ${error.message}`);
    }
  }

  console.log('');
  if (problems.length) {
    console.error(`Doctor found ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('Everything uploads need is in place.');
}

main().catch((error) => {
  console.error(`\nDoctor could not run: ${error.message}`);
  process.exit(1);
});

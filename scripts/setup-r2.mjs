#!/usr/bin/env node
// Adds (or repairs) the R2 bucket configuration that browser uploads need.
//
// `npm run deploy` already calls this after every deploy, so a fork only needs to
// run it by hand if it deploys from the Cloudflare dashboard, uses a custom domain,
// or something changed the bucket settings.
import {
  configureCors,
  discoverWorkersDevUrl,
  ensureBucket,
  ensureLifecycle,
  readConfig,
  resolveAccount,
  wranglerEnv,
} from './cloudflare.mjs';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const account = resolveAccount();
  const env = wranglerEnv(account);
  const { bucket, worker } = readConfig();

  console.log(`Cloudflare account: ${account.name ?? account.id} (${account.id})`);
  console.log(`R2 bucket:          ${bucket}`);

  const bucketState = ensureBucket(bucket, env);
  console.log(`Bucket:             ${bucketState === 'created' ? 'created' : 'already exists'}`);
  const lifecycleState = ensureLifecycle(bucket, env);
  console.log(
    `Multipart cleanup:  ${lifecycleState === 'created' ? 'added (abort after 7 days)' : 'already configured'}`,
  );

  // Prefer an explicit SITE_URL, then the deployed workers.dev URL. A first-ever
  // setup before any deploy has no URL yet; deploying adds it automatically.
  const siteUrl =
    (process.env.SITE_URL || argValue('--url')) ||
    (await discoverWorkersDevUrl(account, worker, env));

  const { origins } = configureCors({ siteUrl, env });

  console.log(`\nCORS rule updated. Allowed browser origins:`);
  for (const origin of origins) console.log(`  ${origin}`);
  if (!siteUrl) {
    console.log(
      '\nNo deployed URL was known yet, so only local origins were added. ' +
        'Run `npm run deploy` (it adds the deployed URL) or set SITE_URL=https://your-site and run this again.',
    );
  }
  console.log('\nCloudflare can take up to ~30 seconds to apply the rule.');
  console.log('Check it any time with: npm run doctor');
}

main().catch((error) => {
  console.error(`\nR2 setup failed: ${error.message}`);
  console.error(
    '\nNothing else was changed. Re-run `npx wrangler login` if the login expired, ' +
      'then run `npm run setup:r2` again.',
  );
  process.exit(1);
});

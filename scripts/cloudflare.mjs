// Helpers shared by `npm run deploy`, `npm run setup:r2` and `npm run doctor`.
//
// Uploads go straight from the browser to R2, so the bucket must allow the site's origin.
// That rule used to be a manual README step, which is easy to miss on a fresh account and
// produces a browser-only failure ("CORS not configured for this bucket"). These helpers
// read, merge and verify the rule with the same Wrangler login the deploy already uses.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const localWrangler = join(root, 'node_modules', '.bin', isWin ? 'wrangler.cmd' : 'wrangler');
const npx = isWin ? 'npx.cmd' : 'npx';

/** Origins every checkout needs for local development. */
const LOCAL_ORIGINS = [
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
];

/** The command and argument list for this checkout's Wrangler. */
export function wranglerSpawn(args) {
  const useLocal = existsSync(localWrangler);
  return {
    command: useLocal ? localWrangler : npx,
    args: useLocal ? args : ['wrangler', ...args],
  };
}

/** Run Wrangler and return its captured output. */
export function wrangler(args, { env = process.env, stdio = 'pipe' } = {}) {
  const { command, args: fullArgs } = wranglerSpawn(args);
  const result = spawnSync(command, fullArgs, { cwd: root, env, encoding: 'utf8', stdio });
  if (result.error) throw new Error(`Could not run Wrangler: ${result.error.message}`);
  return result;
}

/** Read the Worker and bucket names from the same config Wrangler deploys. */
export function readConfig() {
  const toml = join(root, 'wrangler.toml');
  const jsonc = join(root, 'wrangler.jsonc');
  let worker = 'course-site';
  let bucket = 'course-sourse';
  if (existsSync(toml)) {
    const text = readFileSync(toml, 'utf8');
    worker = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? worker;
    bucket = /^\s*bucket_name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? bucket;
  } else if (existsSync(jsonc)) {
    const text = readFileSync(jsonc, 'utf8');
    worker = /"name"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? worker;
    bucket = /"bucket_name"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? bucket;
  }
  return {
    worker: process.env.WORKER_NAME || worker,
    bucket: process.env.R2_BUCKET || bucket,
  };
}

/**
 * A gitignored file that maps a git branch to the Cloudflare account it deploys to,
 * e.g. `{ "main": { "id": "...", "name": "closed-source" }, "dev": "..." }`.
 * Keeping it out of git means the account ids never ship with the repo.
 */
export const LOCAL_ACCOUNTS_FILE = join(root, '.cloudflare-accounts.json');

/** The branch this checkout is on, or null when not a repo or detached HEAD. */
export function currentBranch(env = process.env) {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const branch = (result.stdout ?? '').trim();
  return branch && branch !== 'HEAD' ? branch : null;
}

/** Read the branch -> account map, tolerating a string id or an `{ id, name }` object. */
export function localAccountMap(env = process.env) {
  const file = env.CLOUDFLARE_ACCOUNTS_FILE || LOCAL_ACCOUNTS_FILE;
  if (!existsSync(file)) return {};
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
  if (!data || typeof data !== 'object') return {};
  const map = {};
  for (const [branch, value] of Object.entries(data)) {
    if (branch.startsWith('_')) continue; // allow a "_comment" key
    const id = typeof value === 'string' ? value : value?.id;
    if (typeof id === 'string' && id.trim()) {
      map[branch] = { id: id.trim(), name: typeof value === 'object' ? value.name : undefined };
    }
  }
  return map;
}

/**
 * The account Wrangler deploys to. CLOUDFLARE_ACCOUNT_ID wins (that is what CI uses);
 * otherwise the branch -> account map in `.cloudflare-accounts.json` picks the account;
 * otherwise ask Wrangler, which reflects the current login even when its old on-disk
 * account cache still points somewhere else.
 */
export function resolveAccount(env = process.env) {
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    return { id: env.CLOUDFLARE_ACCOUNT_ID, name: 'from CLOUDFLARE_ACCOUNT_ID' };
  }

  const branch = currentBranch(env);
  const map = localAccountMap(env);
  if (branch && map[branch]) {
    const { id, name } = map[branch];
    return { id, name: name ? `${name} (branch ${branch})` : `from branch "${branch}"` };
  }

  const result = wrangler(['whoami', '--json'], { env });
  if (result.status !== 0) {
    throw new Error(
      'Wrangler is not signed in. Run `npx wrangler login`, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.\n' +
        (result.stderr || result.stdout || '').trim(),
    );
  }
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error('Could not read `wrangler whoami --json` output.');
  }
  if (!data.loggedIn) {
    throw new Error('Wrangler is not signed in. Run `npx wrangler login` first.');
  }
  const accounts = data.accounts ?? [];
  if (accounts.length === 1) return accounts[0];
  if (!accounts.length) {
    throw new Error('Wrangler did not report any Cloudflare account for this login.');
  }
  const list = accounts.map((a) => `  ${a.name} — ${a.id}`).join('\n');
  const branchHint = branch
    ? `Pick the account for branch "${branch}" by adding it to ${LOCAL_ACCOUNTS_FILE}:\n` +
      `  { "${branch}": { "id": "<account id>", "name": "<account name>" } }\n`
    : '';
  throw new Error(
    'Wrangler can see more than one Cloudflare account. Set CLOUDFLARE_ACCOUNT_ID to one of:\n' +
      list +
      '\n' +
      branchHint +
      'See `.cloudflare-accounts.example.json` for the file format.',
  );
}

export function wranglerEnv(account, env = process.env) {
  return { ...env, CLOUDFLARE_ACCOUNT_ID: account.id };
}

/** Accept a full URL or an origin, and reject anything that is not a web origin. */
export function originOf(value, label = 'origin') {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error(`The ${label} is empty.`);
  if (raw.includes('*')) {
    // R2 allows one wildcard in a hostname, e.g. https://*.example.com.
    if (!/^https?:\/\/\*(\.[^\s/]+)+$/.test(raw)) {
      throw new Error(`The ${label} "${raw}" is not a valid origin.`);
    }
    return raw;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`The ${label} "${raw}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`The ${label} "${raw}" must start with http:// or https://.`);
  }
  return url.origin;
}

/** Parse the human-readable `wrangler r2 bucket cors list` output. */
export function parseCors(text) {
  const state = { origins: new Set(), methods: new Set(), headers: new Set(), expose: new Set(), maxAge: 0 };
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*(allowed_origins|allowed_methods|allowed_headers|exposed_headers|max_age_seconds):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'max_age_seconds') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > state.maxAge) state.maxAge = seconds;
      continue;
    }
    const target =
      key === 'allowed_origins'
        ? state.origins
        : key === 'allowed_methods'
          ? state.methods
          : key === 'allowed_headers'
            ? state.headers
            : state.expose;
    for (const item of value.split(',').map((s) => s.trim()).filter(Boolean)) target.add(item);
  }
  return state;
}

function hasIgnoreCase(set, value) {
  const lower = String(value).toLowerCase();
  return [...set].some((item) => String(item).toLowerCase() === lower);
}

export function getCors(bucket, env) {
  const result = wrangler(['r2', 'bucket', 'cors', 'list', bucket], { env });
  if (result.status === 0) return parseCors(result.stdout);
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (/does not exist|no cors|not configured|No CORS/i.test(text)) {
    return { origins: new Set(), methods: new Set(), headers: new Set(), expose: new Set(), maxAge: 0 };
  }
  throw new Error(`Could not read the CORS rules for "${bucket}":\n${text.trim()}`);
}

/** Merge the origins we need into whatever the bucket already allows. */
export function buildCors(existing, origins) {
  const allowedOrigins = new Set([...existing.origins, ...origins]);
  const methods = new Set([...existing.methods, 'GET', 'HEAD', 'PUT', 'POST']);
  const headers = new Set([...existing.headers, 'content-type']);
  const expose = new Set([...existing.expose, 'ETag']);
  return {
    rules: [
      {
        allowed: {
          origins: [...allowedOrigins],
          methods: [...methods],
          headers: [...headers],
        },
        exposeHeaders: [...expose],
        maxAgeSeconds: Math.max(existing.maxAge || 0, 3600),
      },
    ],
  };
}

export function setCors(bucket, config, env) {
  const dir = mkdtempSync(join(tmpdir(), 'course-cors-'));
  const file = join(dir, 'cors.json');
  try {
    writeFileSync(file, JSON.stringify(config, null, 2));
    const result = wrangler(['r2', 'bucket', 'cors', 'set', bucket, '--file', file, '--force'], { env });
    if (result.status !== 0) {
      throw new Error(
        `Could not update the CORS rules for "${bucket}":\n${(result.stderr || result.stdout || '').trim()}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function verifyCors(bucket, wantedOrigins, env) {
  const current = getCors(bucket, env);
  const problems = [];
  for (const origin of wantedOrigins) {
    if (!current.origins.has(origin)) problems.push(`missing origin ${origin}`);
  }
  if (!current.methods.has('PUT')) problems.push('missing method PUT');
  if (!hasIgnoreCase(current.headers, 'content-type')) problems.push('missing header content-type');
  if (!hasIgnoreCase(current.expose, 'ETag')) problems.push('missing exposed header ETag');
  if (problems.length) {
    throw new Error(
      `The bucket CORS rules were written but verification failed (${problems.join(', ')}). ` +
        'Run `npm run doctor` and check the bucket in the Cloudflare dashboard.',
    );
  }
  return current;
}

/**
 * Configure everything the browser needs to upload:
 * - keep every origin the bucket already allows,
 * - add the deployed site, localhost, and UPLOAD_ORIGINS,
 * - require GET/HEAD/PUT/POST, content-type, and an exposed ETag (multipart needs it).
 */
export function configureCors({ siteUrl, env = process.env } = {}) {
  const account = resolveAccount(env);
  const childEnv = wranglerEnv(account, env);
  const { bucket } = readConfig();
  const origins = new Set(LOCAL_ORIGINS);
  if (siteUrl) origins.add(originOf(siteUrl, 'site URL'));
  for (const item of String(env.UPLOAD_ORIGINS ?? '').split(',')) {
    if (item.trim()) origins.add(originOf(item, 'UPLOAD_ORIGINS entry'));
  }

  const existing = getCors(bucket, childEnv);
  const config = buildCors(existing, origins);
  setCors(bucket, config, childEnv);
  const current = verifyCors(bucket, [...origins], childEnv);
  return { account, bucket, origins: [...current.origins], rules: current };
}

/** Names only; values never leave Cloudflare. */
export function listSecrets(env) {
  const result = wrangler(['secret', 'list'], { env });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout).map((secret) => secret.name);
  } catch {
    return null;
  }
}

export const REQUIRED_SECRETS = ['SESSION_SECRET', 'ADMIN_EMAIL'];
export const UPLOAD_SECRETS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

export function missingSecrets(names) {
  if (!names) return { required: [], upload: [] };
  return {
    required: REQUIRED_SECRETS.filter((name) => !names.includes(name)),
    upload: UPLOAD_SECRETS.filter((name) => !names.includes(name)),
  };
}

export function findDeployedUrl(output) {
  const matches = String(output).match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/g) ?? [];
  return matches.length ? matches[matches.length - 1] : null;
}

const LIFECYCLE_NAME = 'Default Multipart Abort Rule';

/**
 * A fresh Cloudflare account has no bucket yet, and `wrangler deploy` refuses to
 * deploy an R2 binding that points at a missing bucket. Create it first so a fork
 * can go from `npm install` to a working deploy in one command.
 */
export function ensureBucket(bucket, env) {
  const result = wrangler(['r2', 'bucket', 'create', bucket], { env });
  if (result.status === 0) return 'created';
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (/already exists|already owned|code: 10004/i.test(text)) return 'exists';
  throw new Error(`Could not create the R2 bucket "${bucket}":\n${text.trim()}`);
}

/** Abandoned multipart uploads would otherwise keep paying for parts forever. */
export function ensureLifecycle(bucket, env) {
  const list = wrangler(['r2', 'bucket', 'lifecycle', 'list', bucket], { env });
  const listed = `${list.stdout ?? ''}\n${list.stderr ?? ''}`;
  if (list.status === 0 && /abort incomplete multipart uploads/i.test(listed)) return 'exists';
  const add = wrangler(
    ['r2', 'bucket', 'lifecycle', 'add', bucket, LIFECYCLE_NAME, '--abort-multipart-days', '7', '--force'],
    { env },
  );
  if (add.status === 0) return 'created';
  const text = `${add.stdout ?? ''}\n${add.stderr ?? ''}`;
  if (/already exists|duplicate|code: 10039/i.test(text)) return 'exists';
  throw new Error(`Could not add the multipart cleanup rule to "${bucket}":\n${text.trim()}`);
}

/**
 * The workers.dev URL without parsing deploy output. Only possible when an API
 * token is available (CI); an interactive login has no subdomain command.
 */
export async function discoverWorkersDevUrl(account, worker, env = process.env) {
  if (!env.CLOUDFLARE_API_TOKEN) return null;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account.id}/workers/subdomain`,
      { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const subdomain = data?.result?.subdomain;
    return subdomain ? `https://${worker}.${subdomain}.workers.dev` : null;
  } catch {
    return null;
  }
}

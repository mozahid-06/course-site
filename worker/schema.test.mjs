// The schema gate must never hang the Worker. D1 binding calls have no timeout of their
// own, so one stalled call used to pin the cached promise for the life of the isolate and
// every later request in that isolate hung with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ensureSchema } from './index.js';
import { db, r2 } from './harness.mjs';

const SECRET = 'S'.repeat(40);
const ORIGIN = 'https://s.example';
const env = (DB) => ({ DB, RESOURCES: r2({}), SESSION_SECRET: SECRET });

test('/api/config never touches the database', async () => {
  const touched = () => { throw new Error('D1 touched'); };
  const res = await worker.fetch(new Request(ORIGIN + '/api/config'), {
    ...env({ prepare: touched, batch: touched }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.nonce, 'config still returns a sign-in nonce');
});

test('a stalled schema call rejects at the deadline instead of hanging', async () => {
  const DB = { prepare: () => ({}), batch: () => new Promise(() => {}) };
  const started = Date.now();
  await assert.rejects(ensureSchema(env(DB), 25), (e) => e.dbTimeout === true);
  assert.ok(Date.now() - started < 2000, 'the deadline, not the client, ended the request');
});

test('a database timeout becomes 503 with Retry-After', async () => {
  const DB = {
    prepare: () => ({}),
    batch: async () => {
      const e = new Error('stalled');
      e.dbTimeout = true;
      throw e;
    },
  };
  const res = await worker.fetch(new Request(ORIGIN + '/api/me'), env(DB));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '5');
});

test('the next request retries after a timeout instead of reusing the dead promise', async () => {
  const { DB } = db();
  await ensureSchema(env(DB), 5000);
  const row = await DB.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").first();
  assert.ok(row.c >= 10, 'schema was created by the retry, not skipped');
});

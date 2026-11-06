// Test-only stand-ins for the Cloudflare bindings the Worker expects: a D1 adapter over
// Node's built-in SQLite and a tiny in-memory R2. Imported by worker/*.test.mjs; never shipped.
import { DatabaseSync } from 'node:sqlite';

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * A fake R2 bucket. `files` maps an object key to a string (encoded as UTF-8) or raw bytes.
 * It implements the two methods the Worker uses: `list` (paged) and `get`.
 */
export function r2(files = {}) {
  const map = new Map(Object.entries(files).map(([key, value]) => [key, typeof value === 'string' ? enc.encode(value) : value]));
  return {
    async list({ cursor, limit = 1000 } = {}) {
      const keys = [...map.keys()].sort();
      const start = cursor ? keys.indexOf(cursor) + 1 : 0;
      const page = keys.slice(start, start + limit);
      return {
        objects: page.map((key) => ({ key, size: map.get(key).length })),
        truncated: start + limit < keys.length,
        cursor: page.at(-1),
      };
    },
    async get(key) {
      if (!map.has(key)) return null;
      const bytes = map.get(key);
      return { body: bytes, size: bytes.length };
    },
  };
}

/** A D1-shaped adapter over a node:sqlite database: `prepare(sql).bind(...).run()/first()/all()`. */
export function d1(raw) {
  const make = (sql, args = []) => ({
    run: async () => {
      const r = raw.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    bind: (...more) => make(sql, more),
  });
  return {
    prepare: (sql) => make(sql),
    batch: (stmts) => Promise.all(stmts.map((s) => s.run())),
  };
}

/** A fresh in-memory database plus its D1 adapter. */
export function db() {
  const raw = new DatabaseSync(':memory:');
  return { raw, DB: d1(raw) };
}

/** PBKDF2 hash exactly as the Worker stores it (`salt.hash`, base64url), for seeding users. */
export async function hashPw(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return b64(salt) + '.' + b64(bits);
}

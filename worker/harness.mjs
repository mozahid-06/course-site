// Test-only stand-ins for the Cloudflare bindings the Worker expects: a D1 adapter over
// Node's built-in SQLite and a tiny in-memory R2. Imported by worker/*.test.mjs; never shipped.
import { DatabaseSync } from 'node:sqlite';

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Normalise whatever the Worker passes as `range`: a Headers instance (the raw
 * request headers used for non-video media), a `{ offset, length }` object, or a
 * `bytes=start-end` string. Returns null when there is no usable range.
 */
function readRange(range) {
  if (!range) return null;
  if (typeof range.get === 'function') {
    const header = range.get('range');
    return header ? readRange(header) : null;
  }
  if (typeof range === 'string') {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m) return null;
    const start = Number(m[1]);
    const end = m[2] === '' ? Infinity : Number(m[2]);
    return { offset: start, length: end - start + 1 };
  }
  if (typeof range.suffix === 'number') return { suffix: range.suffix };
  if (typeof range.offset === 'number') return { offset: range.offset, length: range.length ?? Infinity };
  return null;
}

/**
 * A fake R2 bucket. `files` maps an object key to a string (encoded as UTF-8) or raw bytes.
 * It implements the two methods the Worker uses: `list` (paged) and `get` (with ranges).
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
    async get(key, { range } = {}) {
      if (!map.has(key)) return null;
      const bytes = map.get(key);
      const total = bytes.length;
      const spec = readRange(range);
      if (!spec) return { body: bytes, size: total };
      let offset = 0;
      let length = total;
      if (spec.suffix != null) {
        offset = Math.max(0, total - spec.suffix);
        length = total - offset;
      } else {
        offset = Math.min(spec.offset, total);
        length = Math.max(0, Math.min(spec.length, total - offset));
      }
      return { body: bytes.subarray(offset, offset + length), size: total, range: { offset, length } };
    },
  };
}

/** A D1-shaped adapter over a node:sqlite database: `prepare(sql).bind(...).run()/first()/all()`. */
export function d1(raw) {
  // Round-trip telemetry for tests: a batch is one round trip, however many statements it
  // carries. This lets a test assert that a hot path did not regress into N separate queries.
  const stats = {
    roundTrips: 0,
    batches: 0,
    batchedStatements: 0,
    reset() { this.roundTrips = 0; this.batches = 0; this.batchedStatements = 0; },
  };
  const exec = {
    run: (sql, args) => {
      const r = raw.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    first: (sql, args) => raw.prepare(sql).get(...args) ?? null,
    all: (sql, args) => ({ results: raw.prepare(sql).all(...args) }),
  };
  const make = (sql, args = []) => {
    const stmt = {
      run: async () => { stats.roundTrips++; return exec.run(sql, args); },
      first: async () => { stats.roundTrips++; return exec.first(sql, args); },
      all: async () => { stats.roundTrips++; return exec.all(sql, args); },
      bind: (...more) => make(sql, more),
    };
    // Called by batch(), which already counted this statement's shared round trip.
    Object.defineProperty(stmt, 'exec', {
      value: () => (/^\s*(select|with|pragma)\b/i.test(sql)
        ? { success: true, ...exec.all(sql, args) }
        : exec.run(sql, args)),
    });
    return stmt;
  };
  return {
    prepare: (sql) => make(sql),
    batch: async (stmts) => {
      stats.roundTrips++;
      stats.batches++;
      stats.batchedStatements += stmts.length;
      return stmts.map((s) => s.exec());
    },
    stats,
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

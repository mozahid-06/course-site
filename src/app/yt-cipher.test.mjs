import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeYt } from './yt-cipher.ts';

// An independent encoder, so this test does not just mirror the implementation.
const enc = new TextEncoder();
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
const key = Buffer.from(KEY).toString('base64url');
const scramble = (text) => {
  const t = enc.encode(text);
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t[i] ^ KEY[i % KEY.length];
  return Buffer.from(out).toString('base64url');
};

test('decodes an id scrambled with the session key', () => {
  assert.equal(decodeYt(key, scramble('dQw4w9WgXcQ')), 'dQw4w9WgXcQ');
});

test('round-trips ids longer and shorter than the key', () => {
  for (const id of ['ab', 'x', 'a'.repeat(200), 'aB3-_9']) {
    assert.equal(decodeYt(key, scramble(id)), id);
  }
});

test('returns an empty string when the key or the payload is missing', () => {
  assert.equal(decodeYt('', scramble('dQw4w9WgXcQ')), '');
  assert.equal(decodeYt(key, ''), '');
});

// Scrambles a YouTube id for the wire. A per-session key (derived from the signed
// session) is handed to the client once via /api/me; the /yt route XORs the id with
// it and base64urls the result, so a casual glance at the response does not show a
// copyable id. This is obfuscation, not access control: the route still checks the
// session, the course grant and the hourly limit, and the client can always decode.
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** A stable key for this login session, safe to expose to its own client. */
export async function sessionKey(secret, uid, sid) {
  const k = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, enc.encode(`yt:${uid}:${sid || ''}`)));
}

/** XOR `text` with the session key bytes and base64url the result. */
export function scramble(key, text) {
  const k = fromB64(key);
  const t = enc.encode(String(text));
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t[i] ^ k[i % k.length];
  return b64(out);
}

/**
 * Decodes the YouTube id the server sends for one lesson. The id is scrambled
 * (XOR with a per-session key, then base64url) so a casual glance at the Network
 * tab does not show a copyable id. This is obfuscation, not a security boundary:
 * the session key comes from `/api/me`, and the final embed URL still contains the
 * plain id, so anyone determined can recover it. Access control happens on the
 * server; this only raises the effort of a drive-by copy.
 */
const bytes = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Reverse of the server's scramble: XOR the payload with the session key. */
export function decodeYt(key: string, data: string): string {
  if (!key || !data) return '';
  const k = bytes(key);
  if (!k.length) return '';
  const d = bytes(data);
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) out[i] = d[i] ^ k[i % k.length];
  return new TextDecoder().decode(out);
}

// Route-level tests for the security hardening. They drive the real Worker entry through a
// fake D1 (node:sqlite) and a fake R2, so the checks that matter live in code, not in prose.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import worker, { invalidateCourse } from './index.js';
import { db, r2, hashPw } from './harness.mjs';
// The client decoder is the contract for the scrambled payload, so the test decodes the
// real response with the real client code rather than a copy of the algorithm.
import { decodeYt } from '../src/app/yt-cipher.ts';

const SECRET = 'S'.repeat(40);
const OWNER = 'owner@example.com';
const OWNER_PW = 'owner-pass-123';
const ORIGIN = 'https://s.example';
const STUDENT_PW = 'student-pass-1';

// Two courses so an "unenrolled" case exists: a student is granted Course, never Other.
const FILES = {
  'Course/notes.pdf': '%PDF-1.4\nCourse notes',
  'Course/clip.mp4': new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
  'Other/hidden.pdf': '%PDF-1.4\nOther course',
};

const { raw, DB } = db();
const env = { DB, RESOURCES: r2(FILES), SESSION_SECRET: SECRET, ADMIN_EMAIL: OWNER, ADMIN_PASSWORD: OWNER_PW };

const call = (path, { method = 'GET', headers = {}, body, e = env } = {}) =>
  worker.fetch(new Request(ORIGIN + path, { method, headers, body }), e);

// The Worker memoises schema setup per process, so boot once and reuse the same database.
let booted;
before(async () => {
  booted ||= call('/api/config').then((res) => assert.equal(res.status, 200));
  await booted;
});

let n = 0;
async function addUser({ admin = false, pw = STUDENT_PW } = {}) {
  const email = `user${++n}@example.com`;
  raw.prepare('INSERT INTO users (email, pass, is_admin, ver, sid) VALUES (?, ?, ?, 0, NULL)')
    .run(email, await hashPw(pw), admin ? 1 : 0);
  return email;
}
const enroll = (email, course) =>
  raw.prepare('INSERT OR IGNORE INTO enrollments (user_id, course) SELECT id, ? FROM users WHERE email = ?').run(course, email);

async function login(email, { pw = STUDENT_PW, ip = '10.0.0.1' } = {}) {
  const res = await call('/api/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'cf-connecting-ip': ip, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
const browser = (cookie, dest = 'empty') => ({ cookie, 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': dest });

test('fails closed when SESSION_SECRET is missing or too short', async () => {
  for (const secret of [undefined, 'short', 'x'.repeat(31)]) {
    const res = await call('/api/me', { e: { ...env, SESSION_SECRET: secret } });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Server error' });
  }
});

test('rejects state-changing calls that do not come from this site (CSRF)', async () => {
  const crossOrigin = await call('/api/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(crossOrigin.status, 403);
  const crossSite = await call('/api/login', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(crossSite.status, 403);
});

test('API responses carry HSTS (includeSubDomains) and are not cacheable', async () => {
  const res = await call('/api/config');
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('a failed login reveals nothing about whether the email exists', async () => {
  const known = await addUser();
  const a = await login(known, { pw: 'wrong-password', ip: '10.0.0.2' });
  const b = await login('nobody@example.com', { pw: 'wrong-password', ip: '10.0.0.3' });
  assert.equal(a.res.status, 401);
  assert.equal(b.res.status, 401);
  assert.deepEqual(await a.res.json(), await b.res.json());
});

test('login throttling locks an email+IP after 8 failures', async () => {
  const email = await addUser();
  const ip = '10.0.0.9';
  for (let i = 0; i < 8; i++) {
    const { res } = await login(email, { pw: 'nope', ip });
    assert.equal(res.status, 401, `attempt ${i + 1} is a normal rejection`);
  }
  const { res } = await login(email, { pw: 'nope', ip });
  assert.equal(res.status, 429, 'the 9th attempt is throttled');
});

test('media: the browser gate and the range-only rule are enforced', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);

  // No Sec-Fetch metadata (curl/wget/yt-dlp): refused.
  assert.equal((await call('/api/media/Course/notes.pdf', { headers: { cookie } })).status, 403);
  // A top-level navigation / iframe / new tab is refused.
  assert.equal((await call('/api/media/Course/notes.pdf', { headers: browser(cookie, 'document') })).status, 403);
  // A normal in-page fetch is served.
  assert.equal((await call('/api/media/Course/notes.pdf', { headers: browser(cookie) })).status, 200);
  // Video without a Range header is refused; with one it is served.
  assert.equal((await call('/api/media/Course/clip.mp4', { headers: browser(cookie, 'video') })).status, 403);
  assert.equal((await call('/api/media/Course/clip.mp4', { headers: { ...browser(cookie, 'video'), range: 'bytes=0-' } })).status, 200);
});

test('media: a student only reaches courses they are enrolled in', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  assert.equal((await call('/api/media/Other/hidden.pdf', { headers: browser(cookie) })).status, 403);
});

test('media: the per-hour distinct-lesson limit answers 429', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const headers = browser(cookie);
  for (let i = 0; i < 20; i++) {
    // These keys are not in the bucket (404), but the lesson is still counted.
    assert.notEqual((await call(`/api/media/Course/lesson-${i}.pdf`, { headers })).status, 429);
  }
  assert.equal((await call('/api/media/Course/lesson-21.pdf', { headers })).status, 429);
});

test('/api/progress only accepts a real lesson in a course the student has', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const headers = { cookie, origin: ORIGIN, 'content-type': 'application/json' };
  const send = (lesson) => call('/api/progress', { method: 'POST', headers, body: JSON.stringify({ lesson, done: true }) });
  assert.equal((await send('Course/missing.pdf')).status, 404, 'unknown lesson');
  assert.equal((await send('Other/hidden.pdf')).status, 403, 'known lesson, unenrolled course');
  assert.equal((await send('Course/notes.pdf')).status, 200, 'known lesson in an enrolled course');
});

test('YouTube ids are fetched per lesson and never appear in /api/course', async () => {
  raw.prepare('INSERT OR IGNORE INTO youtube_lessons (id, yt, created) VALUES (?, ?, ?)').run('Course/Clip', 'dQw4w9WgXcQ', Date.now());
  invalidateCourse();

  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);

  const course = await (await call('/api/course', { headers: { cookie } })).json();
  const clip = course.flatMap((c) => c.sections.flatMap((s) => s.lessons)).find((l) => l.id === 'Course/Clip');
  assert.ok(clip, 'the YouTube lesson is listed');
  assert.ok(!('yt' in clip), 'the bulk course response carries no video id');

  const yt = await call('/api/lesson/Course/Clip/yt', { headers: { cookie } });
  assert.equal(yt.status, 200);
  const { ytKey } = await (await call('/api/me', { headers: { cookie } })).json();
  assert.equal(typeof ytKey, 'string');
  assert.ok(ytKey.length > 0, 'the session carries an obfuscation key');
  const body = await yt.json();
  assert.notEqual(body.yt, 'dQw4w9WgXcQ', 'the id is not the plain value');
  assert.ok(!String(body.yt).includes('dQw4w9WgXcQ'), 'the plain id does not appear in the payload');
  assert.equal(decodeYt(ytKey, body.yt), 'dQw4w9WgXcQ', 'the client decodes the real id');

  // A student without the course cannot fetch the id...
  const outsider = await addUser();
  const out = await login(outsider, { ip: '10.0.0.4' });
  assert.equal((await call('/api/lesson/Course/Clip/yt', { headers: { cookie: out.cookie } })).status, 403);
  // ...and a non-YouTube lesson answers 404, not an id.
  assert.equal((await call('/api/lesson/Course/notes.pdf/yt', { headers: { cookie } })).status, 404);
});

test('sign out everywhere ends every session for the account', async () => {
  const email = await addUser();
  const { cookie } = await login(email);
  assert.equal((await call('/api/me', { headers: { cookie } })).status, 200);
  const out = await call('/api/logout/all', { method: 'POST', headers: { cookie, origin: ORIGIN } });
  assert.equal(out.status, 200);
  assert.equal((await call('/api/me', { headers: { cookie } })).status, 401, 'the old cookie is dead');
});

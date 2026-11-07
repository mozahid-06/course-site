// Route-level tests for the security hardening. They drive the real Worker entry through a
// fake D1 (node:sqlite) and a fake R2, so the checks that matter live in code, not in prose.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import worker, { invalidateCourse, nonceOk } from './index.js';
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
  'Course/big.mp4': new Uint8Array(5 * 1024 * 1024),
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

test('Google sign-in binds the token to a nonce the page got from /api/config', async () => {
  const res = await call('/api/config');
  const body = await res.json();
  assert.ok(typeof body.nonce === 'string' && body.nonce.length >= 16, 'config returns a nonce');
  assert.ok((res.headers.get('set-cookie') || '').startsWith('gn=' + body.nonce + ';'), 'the nonce is also set as a cookie');
  assert.ok((res.headers.get('set-cookie') || '').includes('SameSite=Strict'), 'the nonce cookie is same-site');
  // The callback must echo exactly the nonce the page was given.
  assert.equal(nonceOk(body.nonce, body.nonce), true);
  assert.equal(nonceOk('other-nonce-value', body.nonce), false);
  assert.equal(nonceOk(undefined, body.nonce), false);
  assert.equal(nonceOk(body.nonce, ''), false);
});

test('a malformed percent-escape in a path is a 400, not a 500', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  for (const path of ['/api/media/Course/%', '/api/notes/%', '/api/lesson/%/comments', '/api/lesson/%/yt']) {
    const res = await call(path, { headers: browser(cookie) });
    assert.equal(res.status, 400, path + ' -> ' + res.status);
    assert.deepEqual(await res.json(), { error: 'Bad request' });
  }
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

test('login throttling also counts failures per email, across many IPs', async () => {
  const email = await addUser();
  // Each attempt comes from a different IP, so the email+IP cap (8) and the per-IP cap (40)
  // never trip: only a per-email counter can catch a distributed guess against one account.
  for (let i = 0; i < 30; i++) {
    const { res } = await login(email, { pw: 'nope', ip: `10.2.${i}.1` });
    assert.equal(res.status, 401, `attempt ${i + 1} is a normal rejection`);
  }
  const { res } = await login(email, { pw: 'nope', ip: '10.3.0.1' });
  assert.equal(res.status, 429, 'the account is throttled even though every IP is new');
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
  // Video without a Range header is refused; with one it is served (206, not 200).
  assert.equal((await call('/api/media/Course/clip.mp4', { headers: browser(cookie, 'video') })).status, 403);
  assert.equal((await call('/api/media/Course/clip.mp4', { headers: { ...browser(cookie, 'video'), range: 'bytes=0-' } })).status, 206);
});

test('media: only a single well-formed Range is served; anything else is refused', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const video = (range) => call('/api/media/Course/clip.mp4', { headers: { ...browser(cookie, 'video'), range } });
  // Ranges that used to fall through to R2 (which returns the whole object) now 416.
  assert.equal((await video('bytes=-500')).status, 416, 'a suffix range is refused');
  assert.equal((await video('bytes=5-2')).status, 416, 'end before start is refused');
  assert.equal((await video('bytes=0-1,3-4')).status, 416, 'a multi-range is refused');
  assert.equal((await video('bytes=abc')).status, 416, 'junk is refused');
  assert.equal((await video('bytes=')).status, 416, 'an empty range is refused');
  assert.equal((await video('bytes=0-100')).status, 206, 'a normal range is still served');
});

test('media: a range larger than one chunk is capped', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const res = await call('/api/media/Course/big.mp4', { headers: { ...browser(cookie, 'video'), range: 'bytes=0-' } });
  assert.equal(res.status, 206);
  assert.equal(Number(res.headers.get('content-length')), 4 * 1024 * 1024, 'one chunk, not the whole file');
  const tail = await call('/api/media/Course/big.mp4', { headers: { ...browser(cookie, 'video'), range: 'bytes=100000-6000000' } });
  assert.equal(Number(tail.headers.get('content-length')), 4 * 1024 * 1024, 'an oversized explicit range is capped too');
});

test('PDF notes: only a real PDF lesson or a real resource PDF is accepted', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const headers = { cookie, 'content-type': 'application/json' };
  const put = (key, data) => call('/api/notes/' + key.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', headers, body: JSON.stringify({ data }) });

  assert.equal((await put('Course/notes.pdf', [{ x: 1 }])).status, 200, 'a real PDF lesson is accepted');
  assert.equal((await put('Course/made-up.pdf', [{ x: 1 }])).status, 404, 'an invented key is refused');

  raw.prepare("INSERT INTO resources (lesson, title, url, note, created_by, created, kind, file_key) VALUES ('Course/notes.pdf','R','',NULL,1,?, 'pdf', 'Course/_resources/real.pdf')").run(Date.now());
  assert.equal((await put('Course/_resources/real.pdf', [{ x: 2 }])).status, 200, 'a resource PDF is accepted');
  const rows = raw.prepare('SELECT COUNT(*) c FROM pdf_notes').get().c;
  assert.equal(rows, 2, 'only the two real PDFs got a row');
  raw.prepare("DELETE FROM resources WHERE file_key = 'Course/_resources/real.pdf'").run();
});

test('PDF notes are limited by bytes, not characters', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const headers = { cookie, 'content-type': 'application/json' };
  const put = (data) => call('/api/notes/Course/notes.pdf', { method: 'PUT', headers, body: JSON.stringify({ data }) });

  const under = 'ক'.repeat(400000); // 1.2 MB in UTF-8
  assert.equal((await put([under])).status, 200, 'a 1.2 MB payload is saved');
  const over = 'ক'.repeat(500001); // 1,500,003 bytes, but only 500,001 characters
  assert.equal((await put([over])).status, 413, 'a payload over 1.5 MB in bytes is refused');
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

test('media: repeating one lesson does not consume the per-hour distinct quota', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const headers = browser(cookie);
  // An HLS burst is one lesson fetched many times; it must count once, not fifty times.
  for (let i = 0; i < 50; i++) {
    assert.notEqual((await call('/api/media/Course/repeat.pdf', { headers })).status, 429, `repeat ${i}`);
  }
  for (let i = 0; i < 19; i++) {
    assert.notEqual((await call(`/api/media/Course/extra-${i}.pdf`, { headers })).status, 429, `extra ${i}`);
  }
  assert.equal((await call('/api/media/Course/extra-21.pdf', { headers })).status, 429, 'the 21st distinct lesson');
});

test('media: a repeat request for the same lesson does not touch D1 for the hit counter', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const headers = browser(cookie);
  await call('/api/media/Course/notes.pdf', { headers }); // records this lesson for the hour
  env.DB.stats.reset();
  await call('/api/media/Course/notes.pdf', { headers });
  // The session and enrollment reads still happen (they are security checks), but the
  // lesson-hit INSERT and COUNT must not: an HLS burst would otherwise double D1 traffic.
  assert.ok(env.DB.stats.roundTrips <= 2, 'repeat used ' + env.DB.stats.roundTrips + ' D1 round trips');
});

test('a cold course listing reads its three metadata tables in one batched round trip', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  await call('/api/course', { headers: { cookie } }); // warm the schema memo and the course cache
  invalidateCourse();
  env.DB.stats.reset();
  const res = await call('/api/course', { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.ok(env.DB.stats.batches >= 1, 'metadata reads go through a batch');
  assert.ok(env.DB.stats.batchedStatements >= 3, 'all three reads share the batch, got ' + env.DB.stats.batchedStatements);
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

test('comments show a stable handle, never the email local part', async () => {
  const email = await addUser();
  await enroll(email, 'Course');
  const { cookie } = await login(email);
  const headers = { cookie, origin: ORIGIN, 'content-type': 'application/json' };
  const url = '/api/lesson/Course/notes.pdf/comments';

  const posted = await call(url, { method: 'POST', headers, body: JSON.stringify({ body: 'hello' }) });
  assert.equal(posted.status, 200);
  const { comment } = await posted.json();
  const me = await (await call('/api/me', { headers: { cookie } })).json();
  assert.equal(comment.name, me.name, 'the posted handle matches the one /api/me reports');
  assert.ok(comment.name && !comment.name.includes('@'), 'the handle is not an email');
  assert.ok(!comment.name.includes(email.split('@')[0]), 'the email local part is not shown');

  const list = await (await call(url, { headers: { cookie } })).json();
  assert.equal(list.comments[0].name, comment.name, 'the handle is stable across reads');
  assert.ok(!JSON.stringify(list).includes(email), 'the email never appears in the thread');

  const email2 = await addUser();
  await enroll(email2, 'Course');
  const two = await login(email2, { ip: '10.5.5.5' });
  const posted2 = await call(url, { method: 'POST', headers: { cookie: two.cookie, origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'hi' }) });
  assert.notEqual((await posted2.json()).comment.name, comment.name, 'different accounts get different handles');
});

test('sign out everywhere ends every session for the account', async () => {
  const email = await addUser();
  const { cookie } = await login(email);
  assert.equal((await call('/api/me', { headers: { cookie } })).status, 200);
  const out = await call('/api/logout/all', { method: 'POST', headers: { cookie, origin: ORIGIN } });
  assert.equal(out.status, 200);
  assert.equal((await call('/api/me', { headers: { cookie } })).status, 401, 'the old cookie is dead');
});

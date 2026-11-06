# Single-Device Login for Students Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student account has at most one live session — signing in on a new device signs every older device out — while admins (including the owner) stay signed in everywhere.

**Architecture:** The Worker gains a nullable `users.sid` (session id). Every login writes a fresh random `sid` into that row and embeds it in the signed cookie; `getUser` rejects a non-admin cookie whose `sid` does not match the row, so an older cookie stops working the moment a new login lands. Admins are exempt. On the client, any `401` clears the local session (drops to the sign-in screen), and a `visibilitychange`/`window focus` handler re-checks the session so an idle displaced device notices.

**Tech Stack:** Cloudflare Worker + D1 (`worker/index.js`), Angular 22 (`src/app/api.ts`, `src/app/app.ts`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-single-device-login-design.md`

## Global Constraints

- Live base URL `https://<your-site>.workers.dev`. Every Worker task is verified against the deployed site, so `npm run deploy` before running that task's live test.
- Throwaway test admin `uitest-tmp@example.com` / `UiTest-Pass-123!` — recreate with `/tmp/opencode/mk-test-admin.sh`. Throwaway test student `uitest-student@example.com` / `UiTest-Pass-123!`, `is_admin = 0`, granted no courses; create it through `POST /api/admin/users` as the test admin.
- **Never sign in as or modify the real owner `you@example.com`.**
- Delete every throwaway user (`uitest-*`) and the `legacy-student-cookie.txt` file before the work is finished.
- `/tmp/opencode` is wiped when the environment restarts and the repo has **no test runner**: verification lives there as throwaway harnesses. `/tmp/opencode/cdp.mjs` exports `BASE` and `connect(cookie)`, spawns a headless Chromium (reads `CDP_PORT` and `CDP_PROFILE` from the environment), and returns `{ send, evalJs, goto, waitFor, shot, close }`.
- No new dependencies. Angular templates plus the single global `src/styles.css`; no per-component styles.
- The cookie stays `HttpOnly; Secure; SameSite=Strict; 7 days`; only its payload gains `sid`.
- Admins (`is_admin = 1`, which includes the owner) are **never** limited.
- Copy stays sentence case, product voice; the client adds no new user-facing strings (a displaced device reuses the existing sign-in screen).

## Review Focus

- An admin logs in on a second device — both sessions must stay valid (the `is_admin` exemption). Task 1 test.
- A student cookie from **before the deploy** (no `sid`) must be rejected — the one-time mass sign-out. Task 1 test, using a cookie captured before the code changes.
- A student's two rapid logins must leave **exactly one** live session (the newest), the previous one `401`. Task 1 test.
- A displaced device that is sitting **idle on the course list** must return to the sign-in screen when brought back to the foreground, without any click. Task 2 test (a dispatched `focus`).
- A **network failure** (not a `401`) must **not** sign a live device out. Task 2 test (network emulated offline, then refocused; the course list must remain).

---

## Task 1: Worker — one live session per student

**Files:**
- Modify: `worker/index.js` — `SCHEMA` users row (~line 50), `migrate()` (~line 90), `getUser` (lines 27–37), `sessionCookie` (lines 41–44), and the two login endpoints (lines ~450 and ~459)
- Test: `/tmp/opencode/test-single-session.sh`

**Interfaces:**
- Consumes: the existing `hashPw`/`checkPw`/`hmac` helpers and the login handlers as they are.
- Produces: `sessionCookie(u, env, secure)` embeds `sid` from `u.sid`; a new `startSession(env, u, secure)` stores a fresh `sid` on `u.id` and returns the `Set-Cookie` string. `getUser` accepts a cookie only when the user is an admin, or when the cookie's `sid` is present and equals `users.sid`.

- [ ] **Step 1: Write the failing test and capture a pre-change cookie**

First make sure the throwaway users exist and capture a **sid-less** cookie (this is the deploy sign-out evidence):

```bash
BASE=https://<your-site>.workers.dev
bash /tmp/opencode/mk-test-admin.sh
ADMIN=$(curl -s -i -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
curl -s -X POST "$BASE/api/admin/users" -H "cookie: s=$ADMIN" -H 'content-type: application/json' \
  -d '{"email":"uitest-student@example.com","password":"UiTest-Pass-123!","is_admin":0,"courses":[]}' >/dev/null || true
curl -s -i -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"email":"uitest-student@example.com","password":"UiTest-Pass-123!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p' > /tmp/opencode/legacy-student-cookie.txt
```

Create `/tmp/opencode/test-single-session.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=https://<your-site>.workers.dev
login() { # $1 = email -> cookie
  curl -s -i -X POST "$BASE/api/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"UiTest-Pass-123!\"}" \
    | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p'
}
code() { curl -s -o /dev/null -w '%{http_code}' "$BASE/api/me" -H "cookie: s=$1"; }
fail() { echo "FAIL $1"; exit 1; }

# A student: the second login must displace the first.
A=$(login uitest-student@example.com)
B=$(login uitest-student@example.com)
[ -n "$A" ] && [ -n "$B" ] || fail "student login"
[ "$(code "$B")" = 200 ] || fail "device B should be signed in"
[ "$(code "$A")" = 401 ] || fail "device A should be signed out by the newer login"

# An admin: exempt, both stay signed in.
X=$(login uitest-tmp@example.com)
Y=$(login uitest-tmp@example.com)
[ "$(code "$X")" = 200 ] || fail "admin device X must stay signed in"
[ "$(code "$Y")" = 200 ] || fail "admin device Y must stay signed in"

# A cookie captured before this change (no sid) must be signed out.
L=$(cat /tmp/opencode/legacy-student-cookie.txt)
[ -n "$L" ] || fail "missing legacy cookie file"
[ "$(code "$L")" = 401 ] || fail "legacy student cookie should be signed out"

echo "OK one live student session; previous signed out; admins exempt"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash /tmp/opencode/test-single-session.sh`
Expected: FAIL — `device A should be signed out by the newer login` (the current Worker accepts both cookies).

- [ ] **Step 3: Add the `sid` column**

In `worker/index.js`, add `sid TEXT` to the `users` row in `SCHEMA`:

```js
'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, sid TEXT)',
```

and add it to `migrate()` next to the other column checks:

```js
const hasSid = await env.DB.prepare("SELECT COUNT(*) c FROM pragma_table_info('users') WHERE name = 'sid'").first();
if (!hasSid.c) await env.DB.prepare('ALTER TABLE users ADD COLUMN sid TEXT').run();
```

- [ ] **Step 4: Enforce the session id in `getUser`**

Select `sid` and require it for non-admins (replace the body's final query + return):

```js
const u = await env.DB.prepare('SELECT id, email, is_admin, ver, sid FROM users WHERE id = ?').bind(d.uid).first();
// 'ver' changes on password reset / role change, which signs the user out everywhere
if (!u || (d.v || 0) !== u.ver) return null;
// Students: the cookie must carry the account's current session id, so a newer
// login (or a cookie from before this feature) is rejected. Admins are exempt.
if (!u.is_admin && (!d.sid || d.sid !== u.sid)) return null;
return u;
```

- [ ] **Step 5: Carry the id in the cookie and claim a slot on each login**

Change `sessionCookie` to include `sid`, and add `startSession` just below it:

```js
async function sessionCookie(u, env, secure) {
  const p = b64(enc.encode(JSON.stringify({ uid: u.id, v: u.ver || 0, sid: u.sid || '', exp: Date.now() + 7 * 864e5 })));
  return `s=${p}.${await hmac(env.SESSION_SECRET, p)}; HttpOnly${secure ? '; Secure' : ''}; SameSite=Strict; Path=/; Max-Age=604800`;
}

// A new login becomes the only live session for that account: a fresh random id
// replaces the stored one, so every cookie minted earlier fails getUser.
async function startSession(env, u, secure) {
  const sid = crypto.randomUUID();
  await env.DB.prepare('UPDATE users SET sid = ? WHERE id = ?').bind(sid, u.id).run();
  return sessionCookie({ ...u, sid }, env, secure);
}
```

In both login endpoints, replace `await sessionCookie(u, env, secure)` with `await startSession(env, u, secure)`:

- `/api/login/google` (the `return json({ ok: true }, 200, { 'set-cookie': ... })` near line 450)
- `/api/login` (the same line near line 459)

- [ ] **Step 6: Deploy and verify the test passes**

Run: `npm run typecheck && npm run build && npm run check:scripts`, then `npm run deploy`, then `bash /tmp/opencode/test-single-session.sh`
Expected: PASS — `OK one live student session; previous signed out; admins exempt`.

- [ ] **Step 7: Commit**

```bash
git add worker/index.js
git commit -m "feat(auth): one live session per student (newest login wins)"
```

---

## Task 2: Client — a displaced device returns to sign-in

**Files:**
- Modify: `src/app/api.ts` — `req` (~lines 38–47), `raw` (~lines 49–54); add `signOutLocal()` and `refreshMe()`
- Modify: `src/app/app.ts` — constructor listeners (~lines 155–176) and cleanup (~line 172)
- Test: `/tmp/opencode/check-single-device.mjs`

**Interfaces:**
- Consumes: the Worker `401` for a displaced session (Task 1); `Api.me` (signal `Me | null | undefined`) which `app.ts` already uses at `@if (api.me(); as me)` (line 28) / `@else if (api.me() === null)` (line 127).
- Produces: `Api.refreshMe(): Promise<void>`; any `401` from `req`/`raw` sets `me` to `null` (and clears `courses`/`order`), switching the app to `<app-login>`. `App` re-checks the session on `window focus` and `document visibilitychange`.

- [ ] **Step 1: Write the failing test**

Create `/tmp/opencode/check-single-device.mjs`:

```js
import { connect } from './cdp.mjs';

const BASE = 'https://<your-site>.workers.dev';
const login = async () => {
  const r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'uitest-student@example.com', password: 'UiTest-Pass-123!' }),
  });
  return /s=([^;]+)/.exec(r.headers.get('set-cookie') || '')?.[1];
};

// Device A signs in.
const cookieA = await login();
if (!cookieA) throw new Error('could not sign in device A');
process.env.CDP_PORT = '9333';
process.env.CDP_PROFILE = '/tmp/opencode/chrome-a';
const a = await connect(cookieA);
await a.goto(BASE + '/');
if (!await a.waitFor(`document.querySelector('.course-card')`, 15000)) throw new Error('device A did not sign in');

// Device B signs in with the same account, displacing A.
const cookieB = await login();
if (!cookieB) throw new Error('could not sign in device B');

// A is idle on the course list; bringing it to the foreground must notice the
// displaced session and return to the sign-in screen without any click.
await a.evalJs(`window.dispatchEvent(new Event('focus'))`);
if (!await a.waitFor(`document.querySelector('.login')`, 15000)) {
  await a.shot('single-device-a-still-in');
  throw new Error('displaced device A did not return to the sign-in screen');
}
if (await a.evalJs(`!!document.querySelector('.course-card')`)) throw new Error('device A still shows courses');
await a.shot('single-device-a-signed-out');
console.log('OK a displaced device returns to sign-in on refocus');
a.close();

// A network failure must not sign a live device out.
process.env.CDP_PORT = '9334';
process.env.CDP_PROFILE = '/tmp/opencode/chrome-b';
const b = await connect(cookieB);
await b.goto(BASE + '/');
if (!await b.waitFor(`document.querySelector('.course-card')`, 15000)) throw new Error('device B did not sign in');
await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await b.evalJs(`window.dispatchEvent(new Event('focus'))`);
await new Promise((r) => setTimeout(r, 1500));
if (!await b.evalJs(`!!document.querySelector('.course-card')`)) {
  await b.shot('single-device-b-offline-out');
  throw new Error('a network failure signed the live device out');
}
await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
console.log('OK a network failure keeps the live session');
await b.shot('single-device-b-offline-kept');
b.close();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node /tmp/opencode/check-single-device.mjs`
Expected: FAIL — `displaced device A did not return to the sign-in screen` (Task 1 already makes the server `401`, but the client neither re-checks on focus nor clears the session on a `401`).

- [ ] **Step 3: Clear the local session on any `401`**

In `src/app/api.ts`, add the helper and call it from both request helpers right after the body is parsed:

```ts
/** Drop the local session after the server rejects it (another device signed in). */
private signOutLocal(): void {
  if (this.me() === null) return;
  this.me.set(null);
  this.courses.set([]);
  this.order.set({});
}
```

In `req<T>` and `raw<T>`, between `const data = await res.json().catch(() => ({}));` and the `if (!res.ok)` throw:

```ts
if (res.status === 401) this.signOutLocal();
```

A wrong-password `401` on the login screen is harmless: `me` is already `null`, so `signOutLocal` does nothing.

- [ ] **Step 4: Add `refreshMe()`**

In `src/app/api.ts`, next to `init()`:

```ts
/** Re-check the session; a 401 signs the client out through req(). */
async refreshMe(): Promise<void> {
  if (this.me() == null) return;
  try { this.me.set(await this.req<Me>('me')); } catch { /* 401 already handled; a network error keeps the session */ }
}
```

- [ ] **Step 5: Revalidate on refocus**

In `src/app/app.ts`, add two handlers and wire them in the constructor beside the existing scroll listener, removing them on destroy:

```ts
private readonly onFocus = (): void => { void this.api.refreshMe(); };
private readonly onVisible = (): void => { if (document.visibilityState === 'visible') void this.api.refreshMe(); };
```

```ts
// in the constructor:
window.addEventListener('focus', this.onFocus);
document.addEventListener('visibilitychange', this.onVisible);
// in inject(DestroyRef).onDestroy(...):
window.removeEventListener('focus', this.onFocus);
document.removeEventListener('visibilitychange', this.onVisible);
```

`refreshMe` early-returns when `me` is `null`, so this does nothing on the sign-in screen.

- [ ] **Step 6: Deploy and verify the test passes**

Run: `npm run typecheck && npm run build`, then `npm run deploy`, then `node /tmp/opencode/check-single-device.mjs`
Expected: PASS — `OK a displaced device returns to sign-in on refocus` and `OK a network failure keeps the live session`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api.ts src/app/app.ts
git commit -m "feat(auth): return a displaced student to the sign-in screen"
```

---

## Task 3: Docs

**Files:**
- Modify: `docs/CHANGELOG.md` — a `### Added (single-device login)` subsection under `## Unreleased`
- Modify: `docs/HANDOFF.md` — the cookie/auth notes (~lines 175–176) and the "future work" list item about stateful sessions (~line 317)

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1–2.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the changelog entry**

Under `## Unreleased`, add, matching the existing style (bold lead sentence, then the mechanism, then the verification):

```markdown
### Added (single-device login)
- **A student account can now be signed in on only one device at a time.** The Worker stores one `sid` (session id) per user: every login writes a fresh random `sid` and puts it in the signed cookie, and `getUser` rejects a non-admin cookie whose `sid` no longer matches the row, so signing in on a new device immediately signs the old one out. Admins (and the owner) are exempt and keep working across devices. On deploy every existing student cookie (which has no `sid`) is rejected once — a one-time sign-out of current students. On the client, any `401` clears the local session back to the sign-in screen, and a `window focus` / `visibilitychange` handler re-checks the session so a device that is idle on the course list notices it was displaced. Verified with a live Worker pass (the second student login `401`s the first, the legacy pre-change cookie `401`s, two admin logins both stay `200`) and a headless Chromium check (the displaced device returns to sign-in on refocus; a network failure does not sign a live device out).
```

- [ ] **Step 2: Update HANDOFF**

In the auth/cookie notes (~line 175), change the cookie shape to include `sid` and add the rule:

- Cookie `s=<base64url(JSON{uid, v, sid, exp})>.<base64url(HMAC-SHA256 with SESSION_SECRET)>`, `HttpOnly; Secure; SameSite=Strict`, 7 days.
- `users.sid` is the account's current session id (nullable); a student cookie is only valid while its `sid` matches, so one account has one live student session and a new login signs the old device out. Admins (`is_admin = 1`) skip the check. The client clears its session on any `401` and revalidates on focus/visibility.

Update the future-work item (~line 317) from "Stateful sessions (a `sessions` table) for instant revocation and device lists" to note that single-session enforcement now exists via `users.sid`, while a `sessions` table (for instant revocation and device lists) remains future work.

- [ ] **Step 3: Commit**

```bash
git add docs/CHANGELOG.md docs/HANDOFF.md
git commit -m "docs: single-device login for students"
```

---

## Cleanup (do before calling the work done)

- Delete the throwaway users and the captured cookie:

```bash
npx wrangler d1 execute course-db --remote --command "DELETE FROM users WHERE email IN ('uitest-student@example.com','uitest-tmp@example.com')"
rm -f /tmp/opencode/legacy-student-cookie.txt
```

- Confirm the real owner `you@example.com` is untouched and still an admin.
- Confirm the working tree is clean and every commit from Tasks 1–3 is pushed to `main`.

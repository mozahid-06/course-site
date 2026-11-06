# Single-device login for students — design

Date: 2026-11-06
Status: APPROVED 2026-11-06 — ready for the implementation plan
Approach: server-tracked session id, newest login wins
On deploy: everyone signed out once (students); admins exempt
Old device reaction: on next 401 + on refocus/visibility
Scope: both email/password and Google sign-in; admins/owner always exempt

## Intent (why)

The owner wants a student account usable on **one device at a time**: when a
student signs in on a new device, every older device is signed out immediately
(no shared accounts). This is a security/piracy control for students only — the
owner and admins must keep working across devices.

Today the session is a **stateless signed cookie** (`worker/index.js:27`): any
correctly-signed, unexpired cookie is accepted, so a student can copy a cookie
or sign in on many devices at once. To enforce one device, the server has to
remember which session is current.

## Goals

- A student has at most one live session; a new login replaces the old one.
- Old devices stop working: their next API call returns `401`, and the client
  returns to the sign-in screen.
- The old device is also checked when the tab regains focus/visibility, so a
  device that was sitting idle notices without the user clicking anything.
- Applies to both `/api/login` and `/api/login/google`.
- Admins (`is_admin = 1`, which includes the owner) are **never** limited.
- On deploy, current student cookies (which carry no session id) stop working —
  a one-time sign-out of everyone who is currently a student. Admins are
  unaffected, so the owner stays signed in.

## Non-goals

- No device list, no "sign out my other devices" UI, no per-device names.
- No change to `ver` (password reset / role change still signs out everywhere as
  it does now).
- No change to logout's existing behaviour beyond what falls out of this.
- No change to upload endpoints, Video.js internals, the watermark, the Google
  sign-in flow (`renderButton`/callback/`loginGoogle`), or the PDF.js toolbar.
- No self-registration; accounts stay invite-only.
- No polling loop; nothing runs while the tab is idle and hidden.

## Constraints

- Stateless-cookie model and the existing `users` schema/migration style
  (`google_sub`, `ver` are added the same way in `migrate()`).
- `getUser` runs on every authenticated request; it must stay a single query.
- `Secure` cookie rule and `SameSite=Strict` are unchanged.
- One global `src/styles.css`; Angular templates; `npm run typecheck`,
  `npm run build`, `npm run check:scripts` must pass.

## The design

### 1. Worker — a per-student session id (`worker/index.js`)

Add one nullable column:

```js
// SCHEMA
'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, sid TEXT)',

// migrate()
const hasSid = await env.DB.prepare(
  "SELECT COUNT(*) c FROM pragma_table_info('users') WHERE name = 'sid'").first();
if (!hasSid.c) await env.DB.prepare('ALTER TABLE users ADD COLUMN sid TEXT').run();
```

`sid` is a random per-login value. It is stored raw (like `ver`); it is only
ever compared against the value inside the HMAC-signed cookie, so a leaked
`sid` alone cannot be turned into a session without `SESSION_SECRET`.

### 2. Worker — `getUser` enforces it (`worker/index.js:27`)

Select `sid` and require it to match for non-admins:

```js
const u = await env.DB.prepare(
  'SELECT id, email, is_admin, ver, sid FROM users WHERE id = ?').bind(d.uid).first();
if (!u || (d.v || 0) !== u.ver) return null;
// Students: the cookie must carry the current session id. A legacy cookie
// (no sid) or one displaced by a newer login is rejected. Admins are exempt.
if (!u.is_admin && (!d.sid || d.sid !== u.sid)) return null;
return u;
```

This is where the one-time deploy sign-out falls out: existing student cookies
have no `sid`, so `!d.sid` is true and they are rejected on their next request.

### 3. Worker — new session on every login

`sessionCookie` carries the id; a small helper claims the slot:

```js
async function sessionCookie(u, env, secure) {
  const p = b64(enc.encode(JSON.stringify({
    uid: u.id, v: u.ver || 0, sid: u.sid || '', exp: Date.now() + 7 * 864e5,
  })));
  return `s=${p}.${await hmac(env.SESSION_SECRET, p)}; HttpOnly${secure ? '; Secure' : ''}; SameSite=Strict; Path=/; Max-Age=604800`;
}

// A new login becomes the only live session for that account.
async function startSession(env, u, secure) {
  const sid = crypto.randomUUID();
  await env.DB.prepare('UPDATE users SET sid = ? WHERE id = ?').bind(sid, u.id).run();
  return sessionCookie({ ...u, sid }, env, secure);
}
```

Both login endpoints switch to it:

- `/api/login/google` (`:~450`): `'set-cookie': await startSession(env, u, secure)`
- `/api/login` (`:~459`): `'set-cookie': await startSession(env, u, secure)`

Because `sid` is set for every login including admins, the code stays uniform;
admins are simply exempt from the *check* in `getUser`.

### 4. Client — a 401 always means "signed out" (`src/app/api.ts`)

Centralise it in the two request helpers so every call site benefits:

```js
private signOutLocal(): void {
  if (this.me() !== null) {
    this.me.set(null);
    this.courses.set([]);
    this.order.set({});
  }
}

// in req() and raw(), after computing the response:
if (res.status === 401) this.signOutLocal();
if (!res.ok) throw new ApiError(data.error || 'Request failed', res.status);
```

`me = null` is exactly what `app.ts` uses to render `<app-login>` in place of the
courses/admin views, so a displaced device drops to sign-in on its next request.
A wrong-password `401` is harmless here: the user is already on the login screen
(`me === null`), so `signOutLocal` does nothing.

### 5. Client — revalidate on refocus (`src/app/api.ts`, `src/app/app.ts`)

```js
// api.ts
/** Re-check the session; a 401 signs the client out via req(). */
async refreshMe(): Promise<void> {
  if (this.me() == null) return;          // nothing to revalidate on the login screen
  try { this.me.set(await this.req<Me>('me')); } catch { /* 401 already signed out */ }
}
```

```js
// app.ts constructor — alongside the existing scroll listener
document.addEventListener('visibilitychange', this.onVisible);
window.addEventListener('focus', this.onVisible);
// DestroyRef.onDestroy: remove both
```

```js
private readonly onVisible = (): void => {
  if (document.visibilityState === 'visible') void this.api.refreshMe();
};
```

This gives the "idle device notices when you come back to it" behaviour without
any background polling. Network errors are ignored (only a real `401` signs out).

## Approaches considered

- **A — Per-user session id column, newest login wins (chosen).** Smallest change
  that actually enforces the rule: one extra column, one comparison in the
  existing `getUser`, one helper. Fits the current stateless-cookie model and its
  migration style, and admins are trivially exempt.
- **B — A `sessions` table (one row per login).** Supports device lists, "sign out
  other devices", and future multi-device limits, but it is more schema, more
  queries and more UI than the requirement asks for. Rejected as over-sized; can
  grow out of A later if needed.
- **C — Reuse `ver` as the session token.** Would conflate two meanings
  (sign-out-everywhere vs. current session) and still needs a per-login value to
  compare, so it does not actually save a column. Rejected.

## Decisions

1. **One active session per student, newest login wins.** A new login overwrites
   `sid`; every earlier cookie fails `getUser`.
2. **Admins/owner are exempt** — `is_admin = 1` skips the `sid` check.
3. **On deploy, current student sessions end once** (their cookies have no `sid`).
   Admins keep their sessions.
4. **A displaced device returns to sign-in on its next `401`** (any API call).
5. **Idle devices revalidate on visibility/focus**, not on a timer — no polling.
6. **Both login methods** go through the same `startSession`.
7. **`sid` is stored raw and compared against the signed cookie**; the HMAC stays
   the real gate.

## Rollout

1. Worker: add `sid` to `SCHEMA` + `migrate()`.
2. Worker: `getUser` selects/enforces `sid` (admins exempt); `sessionCookie` adds
   `sid`; add `startSession`; switch both login endpoints.
3. `api.ts`: `signOutLocal()` on `401` in `req`/`raw`; `refreshMe()`.
4. `app.ts`: `visibilitychange` + `window focus` → `refreshMe()`; clean up on destroy.
5. Docs: CHANGELOG (Unreleased) + HANDOFF (auth section).
6. Verify (with the throwaway test admin, deleted afterwards):
   - `curl` a test student: login on "device A" → cookie A works; login on
     "device B" → cookie B works and cookie A now `401`s; `/api/me` with A `401`.
   - Legacy: a student cookie without `sid` → `401` (deploy sign-out).
   - Admin: two logins both keep working (exempt); owner untouched.
   - `npm run typecheck`, `npm run build`, `npm run check:scripts`.
   - Headless pass in two cookie jars: after B logs in, A drops to the sign-in
     screen on refocus.
   Then deploy.

## Open questions

- None blocking. If the owner later wants "sign out other devices" or a device
  list, that is approach B and a separate design.

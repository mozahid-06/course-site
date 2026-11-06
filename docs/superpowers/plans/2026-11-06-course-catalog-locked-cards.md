# Course Catalog + Locked Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every course appears on the home screen for every signed-in user — an empty course included — and a course a student has not been granted is sent locked (no lessons, `0/0 lessons`, unopenable).

**Architecture:** The Worker does the gating. `listCourse()` learns to register a top-level folder even with no lessons; `/api/course` stops filtering by enrollment and instead returns every course, withholding `sections` and marking an ungranted one `locked: true`; `/api/order` exposes course-level positions for all but lesson-level only when granted. The Angular card reads `locked` and renders a disabled, muted `No access` card. All existing lesson-access checks are untouched.

**Tech Stack:** Cloudflare Worker + D1 + R2 (`worker/index.js`, `worker/files.js`), Angular 22 templates (`src/app/api.ts`, `src/app/course.ts`), one global `src/styles.css`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-course-catalog-locked-cards-design.md`

## Global Constraints

- Live base URL `https://course-site.cspg.workers.dev`. Every Worker task is verified against the deployed site, so deploy with `npm run deploy` (it builds first) before running that task's live test.
- Throwaway test admin `uitest-tmp@example.com` / `UiTest-Pass-123!` — recreate with `/tmp/opencode/mk-test-admin.sh` (it deletes and re-inserts that row). Throwaway test student `uitest-student@example.com` / `UiTest-Pass-123!`, `is_admin = 0`, granted no courses; create it through `POST /api/admin/users` as the test admin.
- Never sign in as or modify the real owner `mbthunter007@gmail.com`.
- Delete every throwaway user (`uitest-*`) and every `zz-*` course/lesson you create, before the work is finished.
- `/tmp/opencode` is wiped when the environment restarts, and the repo has no test runner: verification scripts live there as throwaway harnesses. `/tmp/opencode/cdp.mjs` exports `BASE` and `connect(cookie)`, driving a headless Chromium (screenshots to `/tmp/opencode/shots/`).
- No new dependencies. Angular templates plus the single global `src/styles.css`; no per-component styles.
- Exact response shape for `/api/course`, per item: `{ title, description, locked: boolean, sections }`. Exact copy: locked card CTA is `No access`; the lesson line stays `{{done}}/{{total}} lessons`, which reads `0/0 lessons` when locked. Sentence case, product voice.

## Review Focus

- A student jumps to a locked course from the header search — it must not open, and the search must not offer it.
- A locked course that **has** lessons — `/api/course` must carry no sections/lesson ids for it (withheld, not merely hidden by CSS).
- `/api/order` must not return lesson paths under a locked course.
- A folder that holds only its `.keep` placeholder must appear as a course with zero sections (no spurious empty section).
- Granting a course must unlock it on the next `/api/course` (enrollment is read fresh, so no stale-cache window).

---

## Task 1: An empty top-level folder is a course

**Files:**
- Modify: `worker/index.js` — `listCourse()`, the key loop starting `for (const key of keys) {` (~line 195)
- Test: `/tmp/opencode/test-empty-course.sh`

**Interfaces:**
- Consumes: `listCourse(env)` as it exists (returns `{ title, description, sections }[]`, 60 s-cached).
- Produces: `listCourse` includes a course for a top-level folder that holds only `<Folder>/.keep`, as `{ title: '<Folder>', description, sections: [] }`. `/api/course`, `/api/admin/courses` and the file manager all see it through the existing calls.

- [ ] **Step 1: Write the failing test**

Create `/tmp/opencode/test-empty-course.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=https://course-site.cspg.workers.dev
COOKIE=$(curl -s -i -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
[ -n "$COOKIE" ] || { echo "FAIL login"; exit 1; }
C='zz-catalog-empty'
curl -s -X POST "$BASE/api/admin/files/delete" -H "cookie: s=$COOKIE" -H 'content-type: application/json' \
  --data-binary "{\"path\":\"$C\"}" >/dev/null || true
curl -s -X POST "$BASE/api/admin/files/folder" -H "cookie: s=$COOKIE" -H 'content-type: application/json' \
  --data-binary "{\"path\":\"$C\"}" >/dev/null
BODY=$(curl -s "$BASE/api/course" -H "cookie: s=$COOKIE")
node -e '
  const body = JSON.parse(process.argv[1]);
  const c = body.find((x) => x.title === process.argv[2]);
  if (!c) { console.error("FAIL empty course not listed"); process.exit(1); }
  if (c.sections.length !== 0) { console.error("FAIL expected no sections"); process.exit(1); }
  console.log("OK empty course listed");
' "$BODY" "$C"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash /tmp/opencode/test-empty-course.sh`
Expected: FAIL — `zz-catalog-empty` is not in `/api/course` (the deployed Worker still builds the list from lesson files only).

- [ ] **Step 3: Register the top-level folder in `listCourse`**

At the top of the key loop in `worker/index.js`, before the pdf/video filter and its `continue`, register the course for any key that has a `/`:

```js
for (const key of keys) {
  const slash = key.indexOf('/');
  if (slash > 0) {
    const top = key.slice(0, slash);
    if (!courses.has(top)) courses.set(top, new Map());
  }
  // ... the existing `.ts` / `_resources` / pdf|video handling continues unchanged ...
}
```

The existing `parts.length < 2` guard (and the fact that only nested keys have a `/`) still keeps stray root-level objects out. Do not change anything else in the loop.

- [ ] **Step 4: Deploy and verify the test passes**

Run: `npm run deploy`, then `bash /tmp/opencode/test-empty-course.sh`
Expected: PASS — `OK empty course listed`.

- [ ] **Step 5: Commit**

```bash
git add worker/index.js
git commit -m "feat(course): list an empty top-level folder as a course"
```

---

## Task 2: Lock an ungranted course and expose every course

**Files:**
- Modify: `worker/index.js` — the `/api/course` handler (~line 460) and the `/api/order` handler (~line 474)
- Test: `/tmp/opencode/test-catalog-lock.sh`

**Interfaces:**
- Consumes: `listCourse(env)` (Task 1), `myCourses(env, u)` (returns `null` for an admin, else a `Set<string>` of granted course names).
- Produces: `/api/course` item `{ title, description, locked, sections }`; `locked` is `true` exactly when the viewer is a non-admin without that course granted, and then `sections` is `[]`. `/api/order` returns course-level paths for all courses and lesson-level paths only for granted ones.

- [ ] **Step 1: Write the failing test**

Create `/tmp/opencode/test-catalog-lock.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=https://course-site.cspg.workers.dev
ADMIN=$(curl -s -i -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
STU=$(curl -s -i -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"email":"uitest-student@example.com","password":"UiTest-Pass-123!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
[ -n "$ADMIN" ] && [ -n "$STU" ] || { echo "FAIL login (run mk-test-admin.sh and create the student)"; exit 1; }

# The empty course from Task 1, and a course that HAS a lesson but is not granted.
E='zz-catalog-empty'; C='zz-catalog-lessons'
curl -s -X POST "$BASE/api/admin/files/delete" -H "cookie: s=$ADMIN" -H 'content-type: application/json' --data-binary "{\"path\":\"$C\"}" >/dev/null || true
curl -s -X POST "$BASE/api/admin/files/folder" -H "cookie: s=$ADMIN" -H 'content-type: application/json' --data-binary "{\"path\":\"$C\"}" >/dev/null
curl -s -X POST "$BASE/api/admin/youtube" -H "cookie: s=$ADMIN" -H 'content-type: application/json' \
  --data-binary "{\"course\":\"$C\",\"folder\":\"\",\"lesson\":\"Intro\",\"link\":\"https://youtu.be/dQw4w9WgXcQ\"}" >/dev/null

BODY=$(curl -s "$BASE/api/course" -H "cookie: s=$STU")
node -e '
  const body = JSON.parse(process.argv[1]);
  const empty = body.find((x) => x.title === process.argv[2]);
  const withLessons = body.find((x) => x.title === process.argv[3]);
  const fail = (m) => { console.error("FAIL " + m); process.exit(1); };
  if (!empty) fail("empty course not sent to student");
  if (empty.locked !== true) fail("empty course should be locked");
  if (empty.sections.length !== 0) fail("locked empty course leaked sections");
  if (!withLessons) fail("ungranted course not sent to student");
  if (withLessons.locked !== true) fail("ungranted course should be locked");
  if (withLessons.sections.length !== 0) fail("locked course leaked its sections/lesson ids");
  console.log("OK student sees both courses locked with no sections");
' "$BODY" "$E" "$C"

ORDER=$(curl -s "$BASE/api/order" -H "cookie: s=$STU")
node -e '
  const order = JSON.parse(process.argv[1]);
  const course = process.argv[2];
  const fail = (m) => { console.error("FAIL " + m); process.exit(1); };
  if (!(course in order)) fail("course-level position missing for a locked course");
  const leaked = Object.keys(order).find((k) => k.startsWith(course + "/"));
  if (leaked) fail("order leaked a locked lesson path: " + leaked);
  console.log("OK order has the course but no locked lesson paths");
' "$ORDER" "$C"
```

Create the student first if needed, as the test admin:

```bash
curl -s -X POST "$BASE/api/admin/users" -H "cookie: s=$ADMIN" -H 'content-type: application/json' \
  -d '{"email":"uitest-student@example.com","password":"UiTest-Pass-123!","is_admin":0,"courses":[]}'
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash /tmp/opencode/test-catalog-lock.sh`
Expected: FAIL — the student is not sent `zz-catalog-empty`/`zz-catalog-lessons` at all (the handler still filters by enrollment), and their `locked` field does not exist.

- [ ] **Step 3: Return every course, locking the ungranted ones**

In `/api/course`, replace the `.filter(...)` with a `.map(...)`; keep the `watched` set. Signature of each item: `{ title, description, locked, sections }`.

```js
const mine = await myCourses(env, u);
return json((await listCourse(env)).map((c) => {
  const locked = !!mine && !mine.has(c.title);
  return {
    title: c.title,
    description: c.description || '',
    locked,
    sections: locked ? [] : c.sections.map((s) => ({
      title: s.title,
      lessons: s.lessons.map((l) => ({ ...l, done: w.has(l.id) })),
    })),
  };
}));
```

- [ ] **Step 4: Keep lesson positions private in `/api/order`**

Replace the inclusion test so a course-level row (`path` with no `/`) always passes, and a lesson-level row only when the course is granted:

```js
for (const row of rows) {
  const key = String(row.path);
  const courseLevel = !key.includes('/');
  if (!mine || mine.has(key.split('/')[0]) || courseLevel) order[key] = Number(row.position);
}
```

- [ ] **Step 5: Deploy and verify the test passes**

Run: `npm run deploy`, then `bash /tmp/opencode/test-catalog-lock.sh`
Expected: PASS — `OK student sees both courses locked with no sections` and `OK order has the course but no locked lesson paths`.

- [ ] **Step 6: Commit**

```bash
git add worker/index.js
git commit -m "feat(course): send every course, locked when not granted"
```

---

## Task 3: The locked card in the UI

**Files:**
- Modify: `src/app/api.ts` — `CourseData` (~line 6)
- Modify: `src/app/course.ts` — the card template (~line 132), the deep-link handler (~line 181), `openCourse()` (~line 283)
- Modify: `src/app/app.ts` — `courseHits` (~line 208, the header search's course list)
- Modify: `src/styles.css` — after the `.course-card` rules (~line 170)
- Test: `/tmp/opencode/check-locked-card.mjs`

**Interfaces:**
- Consumes: the `/api/course` item `{ title, description, locked, sections }` (Task 2), loaded into `Api.courses()`.
- Produces: `CourseData.locked?: boolean`; a locked card is `disabled`, its CTA is `No access`, and it cannot be opened.

- [ ] **Step 1: Write the failing test**

Create `/tmp/opencode/check-locked-card.mjs`:

```js
import { connect } from './cdp.mjs';
const course = process.env.CS_COURSE;          // zz-catalog-empty
const studentCookie = process.env.CS_STUDENT;  // the student's session cookie
const b = await connect(studentCookie);

const read = `(() => {
  const card = [...document.querySelectorAll('.course-card')]
    .find((c) => c.querySelector('.card-title')?.textContent.trim() === ${JSON.stringify(course)});
  if (!card) return JSON.stringify({ error: 'card not shown' });
  return JSON.stringify({
    disabled: card.disabled,
    meta: card.querySelector('.row-meta')?.textContent.trim(),
    cta: card.querySelector('.card-cta')?.textContent.trim(),
  });
})()`;

await b.goto('https://course-site.cspg.workers.dev/');
if (!await b.waitFor(`document.querySelector('.course-card')`, 15000)) throw new Error('no cards');
let m = JSON.parse(await b.evalJs(read));
console.log('locked', JSON.stringify(m));
if (m.error) throw new Error(m.error);
if (m.disabled !== true) throw new Error('locked card should be disabled');
if (m.meta !== '0/0 lessons') throw new Error('expected 0/0 lessons, got ' + m.meta);
if (m.cta !== 'No access') throw new Error('expected No access, got ' + m.cta);

// Clicking a disabled card must not leave the home screen.
await b.evalJs(`[...document.querySelectorAll('.course-card')]
  .find((c) => c.querySelector('.card-title')?.textContent.trim() === ${JSON.stringify(course)}).click()`);
await new Promise((r) => setTimeout(r, 400));
if (await b.evalJs(`!!document.querySelector('.browser')`)) throw new Error('locked card opened the course');
await b.shot('locked-card-student');

// The header search must not offer a locked course as a clickable result.
await b.evalJs(`(() => {
  const i = document.querySelector('.head-field input');
  i.value = ${JSON.stringify(course)};
  i.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await new Promise((r) => setTimeout(r, 300));
const hits = await b.evalJs(`[...document.querySelectorAll('.head-results button')].map((x) => x.textContent.trim())`);
if (hits.some((t) => t.includes(course))) throw new Error('locked course offered by search: ' + JSON.stringify(hits));
console.log('OK search does not offer the locked course');

console.log('OK locked card is inert with 0/0 lessons and No access');
b.close();
```

- [ ] **Step 2: Run it to verify it fails**

Run it with the student cookie (Task 2 must be deployed first):

```bash
CS_COURSE=zz-catalog-empty \
CS_STUDENT=$(curl -s -i -X POST https://course-site.cspg.workers.dev/api/login -H 'content-type: application/json' \
  -d '{"email":"uitest-student@example.com","password":"UiTest-Pass-123!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p') \
node /tmp/opencode/check-locked-card.mjs
```
Expected: FAIL — the card exists (Task 2) but `disabled` is false and the CTA is `Start`.

- [ ] **Step 3: Add `locked` to the type**

In `src/app/api.ts`:

```ts
export interface CourseData { title: string; description: string; locked?: boolean; sections: Section[] }
```

- [ ] **Step 4: Render and guard the locked card**

In the card template in `src/app/course.ts`, add `[disabled]="c.locked"` to the `<button class="course-card">` and make the CTA conditional (keep the lesson line as it is):

```html
<button class="course-card" [disabled]="c.locked" (click)="openCourse(c)">
  ...
    <span class="card-cta">{{ c.locked ? 'No access' : (courseDone(c) ? 'Continue' : 'Start') }}</span>
```

Guard both ways a course can open:

- In the deep-link handler (~line 181), change `if (!course) return;` to `if (!course || course.locked) return;`.
- In `openCourse(c: CourseData)` (~line 283), add `if (c.locked) return;` as the first line.

Keep a locked course out of the header search. In `app.ts`, `courseHits` (~line 208) filters by title match; add `&& !c.locked` to that filter, so the search dropdown never offers a course the student cannot open.

- [ ] **Step 5: Keep a disabled card legible**

In `src/styles.css`, after the `.course-card .card-cta` rule (~line 169), override the global `button:disabled` dimming so the locked card's text stays readable:

```css
.course-card:disabled{opacity:1;cursor:default}
.course-card:disabled .card-cta{color:var(--muted)}
```

- [ ] **Step 6: Deploy and verify the test passes**

Run: `npm run deploy`, then rerun the command from Step 2.
Expected: PASS — `OK locked card is inert with 0/0 lessons and No access`, and no `.browser` after the click.

- [ ] **Step 7: Verify granting unlocks it, then commit**

Grant the course to the student and confirm the card fills in:

```bash
# as the test admin: set the student's courses to zz-catalog-empty
curl -s -X POST "$BASE/api/admin/users/<student-id>/courses" -H "cookie: s=$ADMIN" \
  -H 'content-type: application/json' --data-binary '{"courses":["zz-catalog-empty"]}'
```
Rerun the headless load and assert the card is **not** disabled and the CTA is `Start`. Then:

```bash
git add src/app/api.ts src/app/course.ts src/styles.css
git commit -m "feat(course): render a locked course card"
```

---

## Task 4: Docs

**Files:**
- Modify: `docs/CHANGELOG.md` — add a `### Added (course catalog and locked courses)` subsection under `## Unreleased`
- Modify: `docs/HANDOFF.md` — the course-list/access notes

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1–3.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the changelog entry**

Under `## Unreleased`, add a subsection covering: an empty top-level folder now appears as a course (so a new course is visible immediately); every course is sent to every signed-in user, and an ungranted course is marked `locked` with no sections so it reads `0/0 lessons` and cannot be opened until an admin grants it; `/api/order` keeps lesson paths private. Match the existing entry style (bold lead sentence, then the mechanism, then the verification).

- [ ] **Step 2: Update HANDOFF**

Add the two facts a future maintainer needs: (a) a course is a top-level folder and is listed even when empty, and (b) `/api/course` is a catalog — `locked` withholds sections, and lesson-level access is still enforced by `myCourses` on media/notes/comments/resources.

- [ ] **Step 3: Commit**

```bash
git add docs/CHANGELOG.md docs/HANDOFF.md
git commit -m "docs: course catalog and locked cards"
```

---

## Cleanup (do before calling the work done)

- Delete the throwaway users and courses:

```bash
# as the test admin, delete the zz-* courses through the file manager
curl -s -X POST "$BASE/api/admin/files/delete" -H "cookie: s=$ADMIN" -H 'content-type: application/json' --data-binary '{"path":"zz-catalog-empty"}'
curl -s -X POST "$BASE/api/admin/files/delete" -H "cookie: s=$ADMIN" -H 'content-type: application/json' --data-binary '{"path":"zz-catalog-lessons"}'
# delete the test student and the test admin rows from D1
npx wrangler d1 execute course-db --remote --command "DELETE FROM users WHERE email IN ('uitest-student@example.com','uitest-tmp@example.com')"
```
- Confirm the real owner `mbthunter007@gmail.com` is untouched and the real course still lists.

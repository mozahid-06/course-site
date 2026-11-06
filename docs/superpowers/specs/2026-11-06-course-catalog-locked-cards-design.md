# Course catalog + locked cards — design

Date: 2026-11-06
Status: APPROVED 2026-11-06 — ready for the implementation plan
Approach: 1 (server-driven catalog, locked cards)
Locked-card behaviour: `0/0 lessons`, tap does nothing, muted `No access` (owner-chosen)
Description on a locked card: shown (my call)

## Intent (why)

A course exists only as a top-level R2 folder, and the home list is built from the
lessons inside it. An empty course (a folder with only its `.keep` placeholder) has
nothing for the list to build from, so it does not appear at all — the owner creates
a course, and it is invisible until a lesson lands in it.

The owner wants a **catalog**: every course shows to everyone. An admin's brand-new
empty course should appear immediately (so it can be granted and then filled). A
student should see every course too, but a course they have not been granted is
**locked**: the card reads `0/0 lessons`, its tap does nothing, and no lesson data
reaches them. Once an admin grants the course, the card fills in and opens as today.

Today students are only *sent* the courses they are granted, so this is a deliberate
change to who can see a course title.

## Goals

- An empty top-level folder is a course and appears on the home screen for admins
  and students.
- Every course appears for every signed-in user; an ungranted course is returned to
  a student as `locked` with **no sections**, so it can never leak its lessons.
- A locked card shows `0/0 lessons`, a muted `No access` cue instead of
  `Start`/`Continue`, and is `disabled` — tapping it does nothing.
- Admins and granted students are unaffected: real sections, real progress,
  `Start`/`Continue`.
- The admin's grant UI can see and grant an empty course (it lists every course).

## Non-goals

- No "request access" flow — a locked card does not offer to ask for access.
- No change to how access is granted (Admin → Users → courses stays the only lever).
- No per-lesson preview or partial unlock inside a locked course; it cannot open.
- No change to the enrollment checks on media, notes, comments or resources.
- No change to ordering UI, uploads, auth, the players or the PDF toolbar.
- No new dependencies; reuse the existing tokens and card styles.

## Constraints

- Angular templates + the one global `src/styles.css`; no per-component styles.
- `listCourse()` is 60 s-cached and shared by `/api/course`, `/api/admin/courses`,
  the admin file manager and the lesson-access check; the change must not break
  those.
- Must survive the `max-width:760px` phone rules and both themes.
- Copy sentence case, product voice.

## The design

### 1. Worker — an empty folder is a course (`listCourse`, `worker/index.js`)

`listCourse()` derives courses from lesson files only. Register the top-level folder
for **any** key that has a `/`, before the "is this a lesson?" filter, so a course
exists even when its only object is `<Course>/.keep`:

```js
for (const key of keys) {
  const slash = key.indexOf('/');
  if (slash > 0) {
    const courseName = key.slice(0, slash);
    if (!courses.has(courseName)) courses.set(courseName, new Map());
  }
  // ... existing per-key lesson handling ...
}
```

The existing root-file guard (`parts.length < 2` → skip) still keeps stray root
objects from becoming courses; `_resources` stays skipped as a lesson, though its
parent course is now registered (correct). The YouTube loop already registers its
courses. Result: an empty course returns `{ title, description, sections: [] }`.

### 2. Worker — the catalog and the lock (`/api/course`)

Replace the enrollment *filter* with a per-course *lock*:

```js
if (path === '/api/course') {
  const w = new Set(/* watched ids */);
  const mine = await myCourses(env, u);           // null for an admin = everything
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
}
```

- An admin (`mine === null`) sees everything, unlocked, including empty courses.
- A granted student is `locked: false` with full sections.
- An ungranted student gets `locked: true`, `sections: []` — the title and the
  owner-written description still travel (they are course-level, not lesson data).
- The lesson-access checks elsewhere (`lessonAccess`, `/api/media`, `/api/notes`,
  comments, resources) already ask `myCourses`, so a locked course's lessons stay
  protected even by direct URL.

### 3. Worker — ordering must not leak lessons (`/api/order`)

The position map is used to sort both courses and, inside a course, its lessons.
Include a course-level row (`path` with no `/`) always, but a lesson-level row only
when the student is granted that course:

```js
for (const row of rows) {
  const key = String(row.path);
  const courseLevel = !key.includes('/');
  if (!mine || mine.has(key.split('/')[0]) || courseLevel) order[key] = Number(row.position);
}
```

This keeps the catalog sorted the same way for everyone without exposing a locked
course's folder/lesson paths.

### 4. Client — the locked card (`src/app/api.ts`, `course.ts`, `styles.css`)

`CourseData` gains `locked?: boolean` (absent/false = normal).

Card template: the button gets `[disabled]="c.locked"`, and the CTA becomes
conditional:

```html
<button class="course-card" [disabled]="c.locked" (click)="openCourse(c)">
  ...
  <span class="card-cta">{{ c.locked ? 'No access' : (courseDone(c) ? 'Continue' : 'Start') }}</span>
</button>
```

- `courseTotal()` is `0` for a locked course (empty sections), so the card reads
  `0/0 lessons` and the progress bar (`@if (courseTotal(c))`) is omitted — exactly
  the requested look.
- `openCourse()` gains an early `if (c.locked) return;` so a stray click or keyboard
  activation cannot open it, and the deep-link/`request` path (the hash route that
  looks a course up in `api.courses()`) skips locked courses too.
- The global `button:disabled{opacity:.5;cursor:not-allowed}` would dim the whole
  card; `.course-card:disabled{opacity:1}` keeps the title and description legible,
  and `.course-card:disabled .card-cta{color:var(--muted)}` mutes `No access`. `Disabled`
  still removes the hover state (`:hover:not(:disabled)` already excludes it).
- No new colours or components.

### 5. Search and the folder browser

Search and the browser read `api.courses()`; a locked course arrives with no
sections, so none of its lessons can be found or opened. The browser can only open
courses through `openCourse`/the guarded request path, so a locked course never
renders an empty folder.

## Approaches considered

- **A — Server-driven catalog with a `locked` flag (chosen).** The list the client
  sees is the one place that decides visibility, and lessons are withheld at the
  source; the UI is then a small conditional. Empty courses fall out of the same
  change.
- **B — Empty courses only; keep hiding other ungranted courses.** Smaller privacy
  change, but it only half-matches "shown to all students", and the owner asked for
  the catalog.
- **C — Client-side lock.** Impossible as the sole mechanism: the server never sends
  an ungranted (or empty) course, so there is nothing for the client to show. It
  would also put the lock in the wrong place for privacy.

## Decisions

1. **A course is a top-level folder**, empty or not; the `.keep` placeholder is
   enough to make it appear.
2. **Every course is sent to every signed-in user.** An ungranted one is `locked`
   with `sections: []`; lesson data is withheld server-side, not hidden in the UI.
3. **A locked card shows `0/0 lessons` and `No access`, and is disabled** (tap does
   nothing). No access-request flow.
4. **The course title and description stay visible** on a locked card (course-level
   blurb, not lesson content) — my call.
5. **`/api/order` exposes course-level positions for all, lesson-level only when
   granted.**
6. **No change to the enrollment model** — granting a course in Admin → Users is
   still the only way to unlock it, and it takes effect on the next `/api/course`.

## Rollout

1. Worker: `listCourse` registers empty top-level folders.
2. Worker: `/api/course` returns `locked` + withholds sections; `/api/order`
   course-level vs lesson-level.
3. `api.ts`: `CourseData.locked`.
4. `course.ts`: `[disabled]`, `No access` CTA, `openCourse` guard, request-path guard.
5. `styles.css`: `.course-card:disabled` legible/muted tweaks.
6. Docs: CHANGELOG (unreleased) + HANDOFF.
7. Verify: `npm run typecheck`, `npm run build`, `npm run check:scripts`; worker
   `curl` checks (create an empty course → it appears for admin; a student sees it
   `locked` with no sections and `0/0`; grant → the student sees the real sections;
   `/api/order` carries the course-level row); a headless pass (admin card is
   clickable; student locked card is disabled and reads `0/0 lessons` + `No access`;
   after granting, it opens). Then deploy.

## Open questions

- None blocking. Keeping the description visible on a locked card is the only
  judgement call; hiding it later is a one-line change.

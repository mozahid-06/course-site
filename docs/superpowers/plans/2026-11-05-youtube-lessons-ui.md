# YouTube Lessons from the Admin Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add, edit and delete YouTube lessons from the Admin panel (backed by D1), so no code file or redeploy is needed.

**Architecture:** A new D1 table `youtube_lessons` holds `(id, yt, created)`. `listCourse` reads it (seeded once from `worker/youtube.js`) instead of the module, so all existing lesson rules still apply. Three admin-only endpoints do the CRUD; a new `admin-youtube` Angular view sits beside Users/Files.

**Tech Stack:** Cloudflare Worker (plain JS, D1, R2), Angular 22 standalone components + signals.

**Spec:** `docs/superpowers/specs/2026-11-05-youtube-lessons-ui-design.md`

## Global Constraints

- Cloudflare Workers + R2 + D1 only; no new dependency; near-zero cost.
- **This repo has no test framework** (Worker is plain JS; the app has no tests). The TDD cycle is adapted: each task names the exact command and the expected output *before* the change, then runs it after. Worker checks use a local `wrangler dev` + `curl` (see `docs/HANDOFF.md` §8); the app uses `npm run typecheck` and `npm run build`. Do not add a test framework.
- Keep the Worker `/api` contract and the Angular `Api` service in sync (change both together).
- Follow existing patterns: lazy schema in `migrate()`, the `/api/admin/*` block, `invalidateCourse()` on course-affecting writes, `ChangeDetectionStrategy.Eager` on components.
- Lesson id shape is `<Course>/<Folder>/<Name>` (same as an R2 key). A real R2 file with the same id wins; a YouTube entry that clashes is hidden.
- Phase B (YouTube rows inside the Files folder tree) is **out of scope**.

## Review Focus

- A non-YouTube or empty link must be refused (`400`, nothing written), never stored as a broken lesson.
- Re-submitting the same path edits the link (one row, updated), never a duplicate.
- A path whose id exactly matches an existing R2 object is reported as `shadowed` and stays hidden from the listing.
- Empty course/lesson, or one containing `/`, is refused (`400`).
- A non-admin calling the endpoints gets `403`.

---

### Task 1: D1 storage and `listCourse` reads it

**Files:**
- Modify: `worker/index.js` (the `migrate()` function; the `listCourse` merge block at the section currently reading `YOUTUBE_LESSONS`)
- Modify: `worker/youtube.js` (doc comment only)

**Interfaces:**
- Consumes: `ytId(link) -> string | null` (already in `worker/index.js`), `YOUTUBE_LESSONS` (imported from `./youtube.js`), `invalidateCourse()`, `env.DB`, `env.RESOURCES`.
- Produces: table `youtube_lessons (id TEXT PRIMARY KEY, yt TEXT NOT NULL, created INTEGER NOT NULL)`; `listCourse` yields YouTube lessons as `{ id, title, kind: 'youtube', yt }`.

- [ ] **Step 1: Record the current behaviour (baseline)**

Run (after `npm run build`, with `.dev.vars` set and `npm run api` running):

```bash
curl -s -c /tmp/jar -X POST localhost:8787/api/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"longpassword1"}'
curl -s -b /tmp/jar localhost:8787/api/course
```

Expected now: an empty `[]` (no R2 objects, empty `YOUTUBE_LESSONS`). This is the "before" for Step 5.

- [ ] **Step 2: Create the table and seed it once, in `migrate()`**

Add, *before* the existing `enrollments` block in `migrate(env)` (so `listCourse` below sees the table):

```js
const hadYt = await env.DB.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table' AND name = 'youtube_lessons'").first();
await env.DB.prepare('CREATE TABLE IF NOT EXISTS youtube_lessons (id TEXT PRIMARY KEY, yt TEXT NOT NULL, created INTEGER NOT NULL)').run();
if (!hadYt.c) { // first run only: carry over anything in worker/youtube.js
  for (const [rawPath, link] of Object.entries(YOUTUBE_LESSONS)) {
    const parts = String(rawPath).split('/').map((s) => s.trim()).filter(Boolean);
    const yt = ytId(link);
    if (parts.length < 2 || !yt) continue;
    await env.DB.prepare('INSERT OR IGNORE INTO youtube_lessons (id, yt, created) VALUES (?, ?, ?)').bind(parts.join('/'), yt, Date.now()).run();
  }
}
```

The `hadYt` guard is what makes a later delete permanent (a deleted seed must not come back).

- [ ] **Step 3: Replace the `YOUTUBE_LESSONS` merge in `listCourse` with a D1 read**

Replace the block that loops over `Object.entries(YOUTUBE_LESSONS)` with:

```js
// YouTube lessons managed from the Admin panel (D1). The id is a path like an R2
// key (<Course>/<Folder>/<Name>); the first segment is the course.
for (const row of (await env.DB.prepare('SELECT id, yt FROM youtube_lessons').all()).results) {
  const parts = String(row.id).split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || !row.yt) continue;
  const id = parts.join('/');
  const courseName = parts[0];
  if (!courses.has(courseName)) courses.set(courseName, new Map());
  const secs = courses.get(courseName);
  if ([...secs.values()].some((list) => list.some((l) => l.id === id))) continue; // a real file wins a clash
  const sectionName = parts.slice(1, -1).join(' / ');
  if (!secs.has(sectionName)) secs.set(sectionName, []);
  secs.get(sectionName).push({ id, title: parts[parts.length - 1], kind: 'youtube', yt: row.yt });
}
```

- [ ] **Step 4: Relabel `worker/youtube.js` as an optional seed**

Change its top comment to say it is seeded into D1 on the first run only and that lessons are normally managed from **Admin panel → YouTube**. Leave the empty `YOUTUBE_LESSONS` object.

- [ ] **Step 5: Verify**

Run `node --check worker/index.js`, restart `npm run api`, then insert a row directly and re-check the API:

```bash
npx wrangler d1 execute course-db --local --command \
  "INSERT OR REPLACE INTO youtube_lessons (id, yt, created) VALUES ('Demo/Week 1/Hello','dQw4w9WgXcQ',$(date +%s000))"
curl -s -b /tmp/jar localhost:8787/api/course | python3 -m json.tool
```

Expected: `node --check` exits 0; `GET /api/course` contains `Demo` → section `Week 1` → `{ "id": "Demo/Week 1/Hello", "title": "Hello", "kind": "youtube", "yt": "dQw4w9WgXcQ" }`. Also confirm deleting that row and re-requesting (after the 60 s cache or a restart) does **not** re-seed it.

- [ ] **Step 6: Commit**

```bash
git add worker/index.js worker/youtube.js
git commit -m "feat(worker): store YouTube lessons in D1 and list them from there"
```

---

### Task 2: Admin CRUD endpoints

**Files:**
- Modify: `worker/index.js` (inside the `if (path.startsWith('/api/admin/'))` block, next to the `/api/admin/courses` handler)

**Interfaces:**
- Consumes: `ytId`, `invalidateCourse()`, `env.DB`, `env.RESOURCES`.
- Produces:
  - `GET /api/admin/youtube` → `[{ id, course, folder, lesson, yt }]`
  - `POST /api/admin/youtube` `{ course, folder?, lesson, link }` → `{ ok: true, id, yt, shadowed }`
  - `DELETE /api/admin/youtube` `{ id }` → `{ ok: true }`
  - Errors: `400` `{ error }` for a bad link / empty or slashed course or lesson / missing id; `403 { error: 'Admin only' }` is already provided by the surrounding admin gate.

- [ ] **Step 1: Write the three handlers**

Add, right after the `/api/admin/courses` handler:

```js
if (path === '/api/admin/youtube' && m === 'GET') {
  const rows = (await env.DB.prepare('SELECT id, yt FROM youtube_lessons ORDER BY id').all()).results;
  return json(rows.map((r) => {
    const parts = String(r.id).split('/').filter(Boolean);
    return { id: r.id, course: parts[0] || '', folder: parts.slice(1, -1).join(' / '), lesson: parts[parts.length - 1] || '', yt: r.yt };
  }));
}
if (path === '/api/admin/youtube' && m === 'POST') {
  const b = await req.json();
  const course = String(b.course || '').trim();
  const lesson = String(b.lesson || '').trim();
  const folder = String(b.folder || '').trim();
  const yt = ytId(b.link);
  if (!course || !lesson) return json({ error: 'Course and lesson name are required' }, 400);
  if (course.includes('/') || lesson.includes('/')) return json({ error: 'Course and lesson name cannot contain "/"' }, 400);
  if (!yt) return json({ error: 'That is not a YouTube link' }, 400);
  const parts = [course, ...folder.split('/').map((s) => s.trim()).filter(Boolean), lesson];
  const id = parts.join('/');
  await env.DB.prepare('INSERT INTO youtube_lessons (id, yt, created) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET yt = excluded.yt').bind(id, yt, Date.now()).run();
  invalidateCourse();
  const shadowed = !!(await env.RESOURCES.head(id));
  return json({ ok: true, id, yt, shadowed });
}
if (path === '/api/admin/youtube' && m === 'DELETE') {
  const b = await req.json();
  const id = String(b.id || '').trim();
  if (!id) return json({ error: 'Missing lesson' }, 400);
  await env.DB.prepare('DELETE FROM youtube_lessons WHERE id = ?').bind(id).run();
  invalidateCourse();
  return json({ ok: true });
}
```

- [ ] **Step 2: Verify the happy path and the returned fields**

Restart `npm run api`, then:

```bash
curl -s -b /tmp/jar localhost:8787/api/admin/youtube | python3 -m json.tool
curl -s -b /tmp/jar -X POST localhost:8787/api/admin/youtube -H 'content-type: application/json' \
  -d '{"course":"Physics","folder":"Week 1","lesson":"Welcome","link":"https://youtu.be/dQw4w9WgXcQ"}'
curl -s -b /tmp/jar localhost:8787/api/course | python3 -m json.tool
```

Expected: the POST returns `{"ok":true,"id":"Physics/Week 1/Welcome","yt":"dQw4w9WgXcQ","shadowed":false}`; `GET /api/admin/youtube` lists that row with `course:"Physics"`, `folder:"Week 1"`, `lesson:"Welcome"`; `GET /api/course` shows the lesson.

- [ ] **Step 3: Verify the refusals and the edit/delete behaviour**

```bash
# bad link -> 400, nothing written
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/jar -X POST localhost:8787/api/admin/youtube \
  -H 'content-type: application/json' -d '{"course":"Physics","lesson":"X","link":"https://example.com/x"}'
# slashed name -> 400
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/jar -X POST localhost:8787/api/admin/youtube \
  -H 'content-type: application/json' -d '{"course":"A/B","lesson":"X","link":"dQw4w9WgXcQ"}'
# edit: same path, new link -> one row, new yt
curl -s -b /tmp/jar -X POST localhost:8787/api/admin/youtube -H 'content-type: application/json' \
  -d '{"course":"Physics","folder":"Week 1","lesson":"Welcome","link":"M7lc1UVf-VE"}'
curl -s -b /tmp/jar localhost:8787/api/admin/youtube | python3 -m json.tool
# delete
curl -s -b /tmp/jar -X DELETE localhost:8787/api/admin/youtube -H 'content-type: application/json' -d '{"id":"Physics/Week 1/Welcome"}'
# shadow: a real R2 object with the exact id wins, and the POST says so
npx wrangler r2 object put "course-sourse/Demo/Lecture.mp4" --file ./README.md --local
curl -s -b /tmp/jar -X POST localhost:8787/api/admin/youtube -H 'content-type: application/json' \
  -d '{"course":"Demo","lesson":"Lecture.mp4","link":"dQw4w9WgXcQ"}'          # expect "shadowed":true
curl -s -b /tmp/jar localhost:8787/api/course | python3 -m json.tool          # Demo/Lecture.mp4 is kind "video", once
# non-admin -> 403
curl -s -b /tmp/jar -X POST localhost:8787/api/admin/users -H 'content-type: application/json' \
  -d '{"email":"stu@example.com","password":"longpassword1"}'                  # make a student
curl -s -c /tmp/stu -X POST localhost:8787/api/login -H 'content-type: application/json' \
  -d '{"email":"stu@example.com","password":"longpassword1"}'
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/stu -X POST localhost:8787/api/admin/youtube \
  -H 'content-type: application/json' -d '{"course":"X","lesson":"Y","link":"dQw4w9WgXcQ"}'   # expect 403
```

Expected: both refusals print `400`; the edit leaves a single `Physics/Week 1/Welcome` row with `yt:"M7lc1UVf-VE"`; the delete removes it from `/api/course`; the shadow POST returns `"shadowed":true` and `Demo/Lecture.mp4` appears once as `kind:"video"`; the student POST prints `403`. Remove the test object and student afterwards (`wrangler r2 object delete ... --local`, delete the user in the Admin panel or via D1).

- [ ] **Step 4: Commit**

```bash
git add worker/index.js
git commit -m "feat(worker): admin endpoints for YouTube lessons"
```

---

### Task 3: Admin panel "YouTube" view

**Files:**
- Modify: `src/app/api.ts` (add the interface and three methods near the other admin calls, ~lines 88-99)
- Create: `src/app/admin-youtube.ts`
- Modify: `src/app/admin.ts` (import; `view` type; header toggle; render branch; subtitle)
- Modify: `src/styles.css` (only if a class is missing; reuse the `adm-*` classes from `admin.ts`/`admin-files.ts`)

**Interfaces:**
- Consumes: `Api.req`, `Api.adminCourses()` (from Task 2's Worker endpoints), `.adm-*` styles.
- Produces:
  - `Api.listYoutubeLessons(): Promise<YoutubeLesson[]>`
  - `Api.addYoutubeLesson(course, folder, lesson, link): Promise<{ ok: boolean; id: string; yt: string; shadowed: boolean }>`
  - `Api.deleteYoutubeLesson(id): Promise<unknown>`
  - `interface YoutubeLesson { id: string; course: string; folder: string; lesson: string; yt: string }`
  - Component `<app-admin-youtube>`.

- [ ] **Step 1: Add the Api contract**

In `src/app/api.ts`, add next to `AdminUser`:

```ts
export interface YoutubeLesson { id: string; course: string; folder: string; lesson: string; yt: string }
```

and next to the other admin methods:

```ts
listYoutubeLessons(): Promise<YoutubeLesson[]> { return this.req<YoutubeLesson[]>('admin/youtube'); }
addYoutubeLesson(course: string, folder: string, lesson: string, link: string): Promise<{ ok: boolean; id: string; yt: string; shadowed: boolean }> {
  return this.req('admin/youtube', { course, folder, lesson, link });
}
deleteYoutubeLesson(id: string): Promise<unknown> { return this.req('admin/youtube', { id }, 'DELETE'); }
```

- [ ] **Step 2: Create `src/app/admin-youtube.ts`**

Component, `ChangeDetectionStrategy.Eager`, selector `app-admin-youtube`. Signals: `lessons`, `courses`, `loading`, `busy`, `error`, `notice`, and form fields `course`, `folder`, `lesson`, `link`, plus `editing = signal<string | null>(null)`. Methods:

```ts
async ngOnInit(): Promise<void>   // loads listYoutubeLessons() + adminCourses(); sets loading
edit(l: YoutubeLesson): void      // fills the form from the row, editing.set(l.id)
reset(): void                     // clears the form and editing
async save(): Promise<void>       // calls addYoutubeLesson(...); on shadowed:true notice
                                  // 'Saved, but a file already uses that path so it will not show';
                                  // on error shows the server's error; then reloads the list
async remove(l: YoutubeLesson): Promise<void>  // confirm() then deleteYoutubeLesson(l.id) and reload
```

Template (reuse `adm-*` classes; match the Add-users form styling):

- A heading row: "YouTube lessons" plus a one-line hint: *Watch a YouTube video as a lesson — nothing is uploaded.*
- A form: `Course` (text input with `<datalist>` of `courses()`), `Folder` (optional; `/` nests), `Lesson name`, `YouTube link`; a Save button (label "Add lesson" / "Save changes" while `editing()`), and a Cancel button while editing. A `<p role="status">` for `error()`/`notice()`.
- A list/table of `lessons()`: each row shows the path (`{{ l.course }}{{ l.folder ? ' / ' + l.folder : '' }} / {{ l.lesson }}`), the video id `{{ l.yt }}`, an Edit button and a Delete button. Empty state: "No YouTube lessons yet."
- Inputs bind with `[value]`/`(input)` or `[(ngModel)]` — follow whichever `admin.ts` already uses for its forms (keep imports consistent; do not introduce a new forms import if the file avoids one).

- [ ] **Step 3: Wire it into `admin.ts`**

- `import { AdminYoutube } from './admin-youtube';` and add `AdminYoutube` to `imports`.
- `view` becomes `signal<'users' | 'files' | 'youtube'>('users')`; replace `toggleView()` with `protected setView(v: 'users' | 'files' | 'youtube'): void { this.view.set(this.view() === v ? 'users' : v); }`.
- Add a second header button next to Files, same `class="adm-ico wide"` pattern:

```html
<button type="button" class="adm-ico wide" [class.on]="view() === 'youtube'" [attr.aria-pressed]="view() === 'youtube'"
        [title]="view() === 'youtube' ? 'Back to users' : 'YouTube lessons'" (click)="setView('youtube')">
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 5 3-5 3z" /></svg>
  <span>YouTube</span>
</button>
```

- Update the Files button to call `setView('files')`.
- Make the subtitle a three-way choice: files → "Upload, rename, move and delete course files."; youtube → "Add YouTube videos as lessons — nothing is uploaded."; else the current users text.
- Render: `@if (view() === 'files') { <app-admin-files /> } @else if (view() === 'youtube') { <app-admin-youtube /> } @else { ...existing users markup... }`.

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck` → exit 0, and `npm run build` → exit 0.

Then a **manual check** (cannot be automated here; note it as unverified): `npm start`, open Admin, click **YouTube**, add `Physics / Week 1 / Welcome / https://youtu.be/dQw4w9WgXcQ`, confirm it appears and that the student view shows it; edit the link; delete it. Also confirm a non-admin never sees the Admin panel at all (existing gate).

- [ ] **Step 5: Commit**

```bash
git add src/app/api.ts src/app/admin-youtube.ts src/app/admin.ts src/styles.css
git commit -m "feat(admin): manage YouTube lessons from the Admin panel"
```

---

### Task 4: Docs

**Files:**
- Modify: `README.md` (the "YouTube lessons (no upload)" section; the API table row area)
- Modify: `docs/HANDOFF.md` (decision log; file map; API table; §4d; limitations if the wording changed)
- Modify: `docs/CHANGELOG.md` (Unreleased)

**Interfaces:**
- Consumes: everything above (names and behaviour must match).
- Produces: user-facing docs that describe the UI as the normal path.

- [ ] **Step 1: README**

Rewrite the "YouTube lessons (no upload)" section to lead with **Admin panel → YouTube** (form, Edit, Delete) and present `worker/youtube.js` as an optional first-run seed, not the normal path. Keep the rules (id shape, accepted links, real-file-wins, YouTube-only course, mark-complete/notes/comments).

- [ ] **Step 2: HANDOFF**

- Decision log: replace the two YouTube rows' wording so it says lessons live in D1 `youtube_lessons`, managed from the Admin panel; the file is a one-time seed.
- File map: add `src/app/admin-youtube.ts`; note `worker/youtube.js` is a seed.
- API table: add the three `/api/admin/youtube` rows.
- §4d: update to the UI flow and the endpoints; keep the verification record and add the new local curl evidence.
- Data model: add the `youtube_lessons` table line.

- [ ] **Step 3: CHANGELOG**

Under Unreleased, add a "Changed (YouTube lessons are now managed in the UI)" entry: D1-backed, Admin → YouTube tab, `worker/youtube.js` is a seed only, plus the three endpoints.

- [ ] **Step 4: Verify + commit**

Run `npm run typecheck` and `npm run build` (both exit 0) — docs must not have broken anything.

```bash
git add README.md docs/HANDOFF.md docs/CHANGELOG.md
git commit -m "docs: YouTube lessons are managed from the Admin panel"
```

---

## Final verification (whole branch)

- `node --check worker/index.js` and `node --check worker/youtube.js` → exit 0.
- Local `wrangler dev` curl pass covering every Review Focus line.
- `npm run typecheck` and `npm run build` → exit 0.
- Push to `main`; confirm the production Workers Build and CI succeed.
- Note as unverified: clicking through the new tab in a real browser.

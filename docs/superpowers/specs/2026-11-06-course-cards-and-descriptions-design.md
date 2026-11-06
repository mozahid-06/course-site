# Course cards + per-course descriptions — design

Date: 2026-11-06
Status: APPROVED 2026-11-06 — ready for the implementation plan
Approach: 1 (responsive card grid + description in D1), owner-selected
Shown: on the card **and** inside the course (owner-selected)

## Intent (why)

The home screen is the course list, and today each course is a dense 40 px row
(`.course-item`): glyph, title, a thin progress bar, `n/m lessons`, and a hover
`Start`/`Continue`. The owner wants two things:

1. The course list to read as a **card view** — courses should look like objects
   you can browse, not rows to scan.
2. A **description** the owner can write for each course, and edit from the file
   manager, so a student sees what a course is about before opening it.

The description has no home today: a course is just a top-level R2 folder, and
the course payload comes from the R2 listing plus D1 (`youtube_lessons`,
`content_order`). D1 is where course-scoped data already lives, so the
description goes there.

## Goals

- Home/courses becomes a responsive **grid of course cards**.
- Each card shows the course title, its **description** (when set), progress and
  the lesson count, and a `Start`/`Continue` cue; the whole card opens the course.
- The description is **stored in D1**, served in the course payload, and rendered
  both on the card and as a short intro at the top of the course.
- The file manager gets a **direct Description tool on each course row** (top-level
  folder) that opens a dialog with a textarea. No `⋮`.
- Keep the minimalist/compact look, both themes, and the existing row language
  everywhere else. No new dependencies.

## Non-goals

- No description for folders below the course root; courses only.
- No rich text / Markdown — plain text.
- No card thumbnails or cover images (courses are folders; there is nothing to
  show).
- No change to ordering, uploads, auth, progress, comments, notes, resources, the
  Video.js internals, the PDF toolbar or the Google sign-in flow.
- Not an information-architecture change: same screens, same routes.

## Constraints

- Angular templates + the one global `src/styles.css`; no per-component styles.
- The course list container keeps its `.list` class so the existing
  `main:has(.list)` scroll/padding rules keep applying.
- Must survive the `max-width:760px` phone rules.
- All copy sentence case, product voice.

## The design

### 1. Home / courses — card grid

The list container becomes `<div class="list cards">`, so the current
`main:has(.list)` padding/scroll and `.page-title`/`.empty` rules still target it.

```
.cards{
  display:grid;                                  /* overrides .list's flex */
  grid-template-columns:repeat(auto-fill,minmax(460px,1fr));
  gap:1.1rem; max-width:1240px; align-content:start;
}
.cards .page-title{grid-column:1/-1;margin-bottom:.4rem}
.cards .empty{grid-column:1/-1}
```

A card is still a `<button>` (keyboard + focus come for free):

```
.course-card{
  display:flex;flex-direction:column;gap:.8rem;
  min-height:186px;padding:1.25rem 1.4rem;text-align:left;color:inherit;
  background:var(--surface);border:1px solid var(--border);border-radius:12px;
  transition:border-color .12s,background .12s;
}
.course-card:hover:not(:disabled),.course-card:focus-visible{background:var(--hover);border-color:var(--primary)}
.course-card .card-head{display:flex;align-items:center;gap:.7rem}
.course-card .row-glyph{width:20px;height:20px}
.course-card .row-glyph svg{width:20px;height:20px;stroke-width:1.7}
.course-card .card-title{flex:1;min-width:0;font-size:17px;font-weight:600;line-height:1.35;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.course-card .card-desc{color:var(--muted);font-size:14px;line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.course-card .card-foot{margin-top:auto;display:flex;flex-direction:column;gap:.6rem}
.course-card .course-bar{width:auto;height:5px}             /* was a fixed 64px × 3px */
.course-card .card-meta-row{display:flex;align-items:center;justify-content:space-between;gap:.6rem}
.course-card .row-meta{font-size:13px}
.course-card .card-cta{color:var(--primary);font-weight:600;font-size:14px}
```

Card anatomy (top to bottom): a head row (20 px book glyph + title on a **single
line**, truncated with an ellipsis when it overflows), the description clamped to 3
lines (omitted when empty), then a footer pushed to the bottom — the progress bar
(only when the course has lessons) and a meta row with `n/m lessons` on the left and
`Start`/`Continue` on the right. The title is `flex:1;min-width:0` so it can shrink
and ellipsize inside the head flex row instead of wrapping.

The larger type and 186 px minimum height were tuned against the live tokens in a
static preview, with the grid at `minmax(460px,1fr)` so a 1280 px window lands
**2-up** (the earlier `minmax(320px,1fr)` wrapped the title to two lines there); on
phones the existing `max-width:760px` rule collapses the grid to a single column.

`grid-auto-rows:1fr` is deliberately **not** used: the page title is a grid item
too, and a `1fr` auto-row inflates it, leaving a large gap under the title. Cards
still stretch to equal height within a row (grid's default `align-items:stretch`),
and `card-foot`'s `margin-top:auto` keeps the progress/count baseline aligned
across a row.

The old `.course-item` rules and the `.course-item` touch rules are removed.

### 2. Description inside the course

Under the breadcrumb, shown only at the course root (`v.path.length === 0`) when a
description exists:

```html
@if (!v.path.length && activeCourse()?.description) {
  <p class="course-intro">{{ activeCourse()!.description }}</p>
}
```

```
.course-intro{color:var(--muted);font-size:13.5px;line-height:1.5;max-width:70ch;white-space:pre-wrap}
```

`white-space:pre-wrap` keeps the author's line breaks.

### 3. Storage — a new `course_meta` table

Added to the `SCHEMA` array in `worker/index.js` (idempotent, created by
`ensureSchema` on first request — no separate migrate step):

```sql
CREATE TABLE IF NOT EXISTS course_meta (
  course TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
)
```

`course` is the top-level folder name — the same key the rest of D1 uses for a
course (`enrollments.course`, `content_order` path segments, `youtube_lessons`
ids' first segment).

`listCourse()` reads the whole table into a `Map` and attaches
`description: metas.get(courseName) || ''` to each course object it returns.
Because it is 60 s-cached, every write below invalidates the cache.

The `/api/course` endpoint adds `description: c.description || ''` to each course
in its response map.

### 4. API — read + one admin write

`CourseData` in `src/app/api.ts` gains `description: string`.

```ts
saveCourseDescription(course: string, description: string): Promise<unknown> {
  return this.req('admin/files/description', { course, description });
}
```

Worker route in `worker/files.js` (already inside the admin-only `/api/admin`
guard):

```
POST /api/admin/files/description   body: { course, description }
```

```js
const DESC_MAX = 2000;
async function setCourseDescription(env, rawCourse, rawDesc, hooks) {
  const course = cleanPath(rawCourse);
  if (course === null || !course || course.includes('/')) return bad('That is not a course name');
  const description = typeof rawDesc === 'string'
    ? rawDesc.replace(/\r\n/g, '\n').trim().slice(0, DESC_MAX)
    : '';
  await env.DB.prepare(
    'INSERT INTO course_meta (course, description) VALUES (?, ?) ' +
    'ON CONFLICT(course) DO UPDATE SET description = excluded.description'
  ).bind(course, description).run();
  hooks.invalidate();
  return json({ ok: true, course, description });
}
```

- Empty string is stored (and clears the description); the row is harmless.
- Trims to 2000 characters; `\r\n` normalised to `\n`.
- No bucket-existence check: the route is admin-only and the UI offers the tool
  only on live rows; a stale dialog writing a row for a just-deleted course is
  harmless and is cleaned up by the delete path below.

### 5. Lifecycle — rename and delete carry the description

- **Course rename** (`moveEntry`, `worker/files.js`): when
  `!from.includes('/') && !to.includes('/')` (a top-level folder = a course),
  push `UPDATE OR REPLACE course_meta SET course = ? WHERE course = ?` alongside
  the existing `enrollments` update.
- **Course delete** (`deleteEntry`): where it already does
  `if (!single && !p.includes('/'))` for `enrollments`, also
  `DELETE FROM course_meta WHERE course = ?`.

Both run in the same `statements` batch as the surrounding D1 cleanup, so they
roll back with it and retry with it.

### 6. File manager — the editor

- Extend the existing `Ask` dialog with an optional `lines?: number`. When set,
  the dialog renders a `<textarea [rows]="a.lines">` bound to `askValue` instead of
  the single-line `<input>`. One dialog pattern, no new modal.
- Add a **Description tool** to the tools cell of a top-level folder row only
  (`!row.path.includes('/')`), next to Rename: a lines glyph, title `Description`,
  `aria-label="Edit description for <name>"`.
- `askDescription(course)` prefills from the already-loaded student payload —
  `api.courses().find(c => c.title === course)?.description ?? ''` — and its `run`
  calls `api.saveCourseDescription(course, value)`. `runAsk` already calls
  `api.init()` and reloads the listing afterwards, so the card and the row stay in
  sync.

Copy:

- Title: `About “<course>”`
- Hint: `Shown on the course card and at the top of the course. Leave it empty to remove it.`
- Label: `Description`
- Rows: 5
- Confirm: `Save`

### 7. Accessibility / quality floor

- Cards are real buttons: keyboard focusable, 2 px indigo focus ring inherited
  from the global rule.
- Progress bars stay `aria-hidden`; the visible `n/m lessons` text carries the
  meaning.
- The Description tool has a `title` and an `aria-label`.
- Touch: the tool is always visible on touch (existing `.files-tool` rule); cards
  are comfortably larger than a 44 px target.
- Both themes use existing tokens (`--surface`, `--border`, `--hover`,
  `--primary`, `--muted`); no new colours.

## Approaches considered

- **A — Card grid + description in D1 (chosen).** One obvious home per course;
  description reaches the card and the course intro through the existing course
  payload; rename/delete bookkeeping is two small additions to existing batches.
- **B — Full-width stacked cards + D1.** Same storage/editor, bigger cards. Uses
  more vertical space and reads like a feed; rejected by the owner in favour of a
  grid.
- **C — Card grid + description as an R2 sidecar** (e.g. `<Course>/_about.txt`).
  No schema change, and the text travels with the folder on rename/move — but it
  appears in the bucket listing (needs filtering) and the move/rename code must
  carry it deliberately anyway. More edge cases than a D1 row; rejected.

## Decisions

1. **Course only.** Descriptions apply to top-level folders (courses), not
   sub-folders.
2. **D1, not R2.** `course_meta(course, description)`, upserted; empty string
   clears it.
3. **Plain text, 2000 characters**, line breaks preserved (`pre-wrap`), `\r\n`
   normalised.
4. **Shown on the card (clamped to 3 lines) and at the course root** as an intro;
   not repeated at every folder depth.
5. **Edited from a per-row tool**, consistent with the file manager's direct-action
   pattern (no `⋮`), reusing the existing dialog.
6. **The whole card is the click target**; `Start`/`Continue` is a visual cue, not
   a separate control.
7. **No description on a course row in the file manager** (the tool pre-fills from
   the payload; the row stays a single line, like the rest of the manager).

## Rollout

1. Schema: add `course_meta` to `SCHEMA` in `worker/index.js`.
2. Worker: `listCourse` attaches `description`; `/api/course` includes it.
3. Worker: `setCourseDescription` + the `POST /api/admin/files/description` route;
   rename/delete carry `course_meta`.
4. `api.ts`: `CourseData.description` + `saveCourseDescription`.
5. `course.ts` + `styles.css`: card grid, card anatomy, course intro; remove the
   old `.course-item` rules and phone overrides.
6. `admin-files.ts`: `Ask.lines` textarea + Description tool + `askDescription`.
7. Docs: README, CHANGELOG (unreleased), HANDOFF.
8. Verify: `npm run typecheck`, `npm run build`, `npm run check:scripts`; then a
   headless pass — set a description as the test admin, confirm the card and the
   course intro render it, rename the course and confirm it carries over, delete it
   and confirm the `course_meta` row is gone, and check light/dark + phone widths.
   Then deploy.

## Open questions

- None blocking. The owner may later want a description on sub-folders or a
  longer/richer field; both are additive to this design.

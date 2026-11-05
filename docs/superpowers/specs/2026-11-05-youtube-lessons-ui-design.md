# YouTube lessons from the Admin panel — design

Date: 2026-11-05
Status: awaiting approval

## Intent (why)

Today a YouTube lesson is added by editing `worker/youtube.js` and redeploying.
The owner does not want to touch code for content work. The goal is to add,
edit and remove YouTube lessons from the Admin panel, like users and files,
with no redeploy.

Approved phase plan: **Phase A now** (a dedicated Admin tab). **Phase B later**
(show YouTube rows inside the existing Files folder tree).

## Goals

- Add / edit / delete a YouTube lesson entirely in the browser.
- No redeploy; a change is reflected on the next `GET /api/course`.
- A YouTube lesson keeps behaving like a file lesson: progress, comments,
  private notes, resources, enrollments (already true — the lesson id is the
  full path in both cases).
- Add a YouTube lesson to an existing course or a brand-new one.

## Non-goals (this phase)

- No YouTube rows inside the Files folder browser (Phase B).
- No bulk import / paste-a-list.
- No YouTube Data API integration (no titles fetched from YouTube; the lesson
  name is what the admin types).
- No change to how students watch lessons.

## Anti-goals

- Do not make the code file the required path again.
- Do not break the existing "a real file with the same key wins" rule.
- Do not add a runtime dependency or cost (stays on the D1/KV-free free tier).

## Constraints

- Cloudflare Workers + R2 + D1 only; near-zero cost.
- Keep the Worker `/api` contract and the Angular `Api` service in sync.
- Follow existing patterns: `SCHEMA`/`migrate()` lazy schema, the
  `/api/admin/*` block, the Admin `users | files` view toggle, `invalidateCourse()`.

## Approaches considered

- **A — A dedicated Admin tab (chosen).** New `youtube_lessons` table + admin
  CRUD endpoints + a small `admin-youtube` view next to Users/Files. Small,
  isolated, matches the current panel. Leaves the file manager untouched.
- **B — Rows inside the Files view.** YouTube lessons appear beside uploaded
  files in the folder tree. Most intuitive, but the file manager is the most
  complex screen and would have to handle lessons with no object. Deferred to
  Phase B.
- **C — A now, B later (chosen by the owner).**

## The how (decided)

### Data (D1)

```sql
CREATE TABLE IF NOT EXISTS youtube_lessons (
  id TEXT PRIMARY KEY,   -- full lesson path "Course/Folder/Name" (same shape as an R2 key)
  yt TEXT NOT NULL,      -- the YouTube video id (parsed when the lesson is added)
  created INTEGER NOT NULL
);
```

Created in `migrate()` using the existing once-only `sqlite_master` check (the
same pattern as `enrollments`). On first creation the table is seeded from
`worker/youtube.js` (`YOUTUBE_LESSONS`), so nothing already in that file is
lost. After that, **D1 is the source of truth**; the file is only an optional
first-run seed and never needs editing again.

### `listCourse`

Replace the `YOUTUBE_LESSONS` merge with `SELECT id, yt FROM youtube_lessons`
and keep the current logic: split the id on `/`, skip fewer than two segments,
create the course if missing, skip if a real file already has that id, and push
`{id, title, kind:'youtube', yt}`. `ytId()` stays (it parses the link on write).

### Endpoints (admin only, in the `/api/admin/` block)

| Endpoint | Body | Effect |
| --- | --- | --- |
| `GET /api/admin/youtube` | — | `[{id, course, folder, lesson, yt}]`, sorted |
| `POST /api/admin/youtube` | `{course, folder?, lesson, link}` | Parses `link` with `ytId`, validates course/lesson, upserts by path, returns `{ok, id, yt, shadowed}`; `shadowed:true` when an R2 file already uses that id (it will not show) |
| `DELETE /api/admin/youtube` | `{id}` | Removes the row |

All three call `invalidateCourse()` on write so the change shows at once.
`folder` may contain `/` to nest (joined with ` / ` for the section title).
Re-submitting the same path edits the link (upsert); a path change is a delete
plus an add.

### Admin UI

- `admin.ts`: `view` becomes `'users' | 'files' | 'youtube'`; the header gets a
  second toggle button (Files, YouTube), each returning to Users when clicked
  while active. Render `<app-admin-youtube />` for the new view.
- New `src/app/admin-youtube.ts`: an "Add lesson" form — Course (text with a
  `<datalist>` of `api.adminCourses()`), Folder (optional), Lesson name, YouTube
  link — and a list of existing lessons (path, video id, Edit, Delete). Edit
  fills the form; Delete confirms. A `shadowed` reply shows a short warning.
- `src/app/api.ts`: `listYoutubeLessons()`, `addYoutubeLesson()`,
  `deleteYoutubeLesson(id)`.

### Docs

README "YouTube lessons" section becomes UI-first (code file noted as an
optional seed); HANDOFF §4d, file map, API table and decision log updated;
CHANGELOG entry. `public/_headers` and `yt-player.ts` are unchanged.

## Verification plan

- `node --check` the Worker; `npm run typecheck`; `npm run build`.
- Local `wrangler dev` + curl: add a lesson (watch link) → it appears in
  `GET /api/course` with `kind:'youtube'`; add one whose id matches a real R2
  object → `shadowed:true` and it is skipped in the listing; delete → gone;
  `GET /api/admin/youtube` lists what was added; a non-admin gets `403`.
- A real browser pass over the new tab is not possible here; note it as
  unverified.

## Left to the builder

- Exact markup/CSS classes for the new view (reuse `admin-files` styling).
- Whether the seeded `worker/youtube.js` stays long-term or is retired once the
  UI has been used (owner's call later).

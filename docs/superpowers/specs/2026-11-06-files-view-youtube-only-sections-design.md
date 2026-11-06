# Files view: show YouTube-only sections — design

Date: 2026-11-06
Status: approved

## Intent (why)

The student course view and **Admin → Course files** disagreed: the course view
listed a section `ক্লাস করার নিয়ম`, the file view did not. The owner wants the
file view to show **everything the course view shows**, so any section, folder
or lesson can be managed (positioned, renamed, deleted) from one place.

Root cause: the two screens read different stores. The course view
(`listCourse` in `worker/index.js`) builds sections from R2 keys **and**
`youtube_lessons` rows; the file view (`listFolder` in `worker/files.js`)
builds folders from R2 prefixes only. A section whose only content is a YouTube
lesson has no R2 prefix, so it never appears in the file view.

## Goals

- A section that exists only because of YouTube lessons (e.g.
  `ক্লাস করার নিয়ম`) appears in **Course files** as a folder row, even though it
  holds no uploaded objects.
- Opening it shows its YouTube lesson(s) — the client already does this through
  `ytRows()`.
- Its position number is editable, and a number edit renumbers the whole folder
  without the duplicate positions that caused the earlier ordering glitch.
- **Delete** on such a folder removes the section *and* its `youtube_lessons`
  rows (and its `content_order` row), like any other folder.

## Non-goals

- The four sections that have **no files and no YouTube lessons** (`💬 Whatsapp
  Group`, `📝ক্লাস রুটিন`, `Environmental Studies`, `Business Communication`) are
  left alone. They appear in neither view today; surfacing `content_order`-only
  rows is a separate change if the owner asks.
- No change to the student course view or to `listCourse`.
- No change to the YouTube lesson add/edit/delete endpoints.

## Anti-goals

- Do not bring back duplicate position numbers. The fix must include the new
  folder in the same renumbering as the real folders.
- Do not list a folder twice when an R2 prefix and a YouTube lesson describe the
  same section.
- Do not change how real R2 folders/files behave.

## Constraints

- Cloudflare Workers + R2 + D1; no new endpoints; near-zero cost.
- The file manager already loads **all** YouTube lessons client-side
  (`listYoutubeLessons()`), so no client data model change is needed.
- Real folders remain the source of truth when both exist (`shadowed` rule).

## Approaches considered

- **A — Derive the missing folders in `worker/files.js` (chosen).** `listFolder`
  and `siblings` add "virtual" child folders derived from `youtube_lessons`
  ids, skipping any that already exist in R2. One place, and it makes position
  edits and delete work.
- **B — Synthesize the rows client-side in `admin-files.ts`.** Rejected:
  `setEntryPosition` calls the worker's `siblings()`, which would not know the
  virtual folder, so its number box would 404 ("That item no longer exists").

## The how (decided)

### A shared helper in `worker/files.js`

Add `virtualChildDirs(env, parent)` returning the set of folder paths that are
**direct children** of `parent` implied by `youtube_lessons.id` values:

- Only ids that have at least two segments under `parent` imply a folder
  (`<parent>/<seg>/…`); a lesson directly in `parent` is not a folder.
- The path is `parent ? parent + '/' + seg : seg`.
- `_resources` is skipped, matching the R2 listing.

No new query shape: it reuses the `SELECT id FROM youtube_lessons` read already
present in `siblings()`.

### `listFolder`

- After collecting the R2 `dirs`, add to `seen` and `dirs` any
  `virtualChildDirs(env, prefix)` path that is not already an R2 dir.
- Positions and the `order` map then include them automatically, because the
  `dirs`/`files` loops already read `positions`.

### `siblings`

- Add the same virtual directories as `rank: 0` folder entries (skipping ones
  already `seen`), so `setEntryPosition` finds them and renumbers the folder
  1..N including them.

### `deleteEntry`

Today a YouTube-only folder answers "Not found": `keys` (R2) and `lessons`
(student-data tables) are both empty, so the guard returns 404 before the
existing `DELETE FROM youtube_lessons` statement runs. Fix:

- Count the folder's YouTube rows too (`SELECT COUNT(*) … WHERE id = ? OR
  (id >= ? AND id < ?)`) and treat a non-zero count as "something is here",
  so the delete proceeds. The existing cleanup statements already remove the
  rows and the `content_order` rows.

### Client

No change expected. `rows()` already renders `listing.dirs` as folder rows;
`open()` loads any path; `ytRows()` shows the YouTube lessons inside; and
`removeRow()` routes folder deletes through `deleteEntry`. Confirm during
verification.

## Verification plan

- `node --check worker/files.js` and `npm run typecheck`, `npm run build`.
- Live, with a throwaway admin (delete it afterwards):
  - `GET /api/admin/files?prefix=4th Semester Full Cours ( Computer )/` now
    includes `ক্লাস করার নিয়ম` at its saved position (1).
  - Opening it lists the lesson `Vedio`.
  - Setting a position on it renumbers the folder with **unique** numbers.
  - Deleting a YouTube-only test folder removes the folder, its
    `youtube_lessons` row and its `content_order` row (test on a scratch folder,
    not the real section, unless the owner wants it gone).
- Browser pass over Course files to read the rendered rows after `/api/order`
  settles.

## Left to the builder

- Whether to hide Rename/Move on a virtual folder (they act on R2 objects and
  have no meaning there). Default: leave the buttons; Move on a folder with no
  objects is a no-op, and out of scope to change.
- Exact helper naming and where it sits in `files.js`.

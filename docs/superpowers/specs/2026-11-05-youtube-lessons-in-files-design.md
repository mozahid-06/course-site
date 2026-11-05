# YouTube lessons inside the Files view — design (Phase B)

Date: 2026-11-05
Status: approved

## Intent (why)

Phase A put YouTube lessons behind a separate **Admin → YouTube** tab. The owner
wants them where the content actually lives: inside the **Files** view. The
folder you are currently browsing *is* the path — there is no separate course
or folder field to fill in.

## Goals

- Manage YouTube lessons from the Files view: a **YouTube** toolbar button adds
  one to the current folder; existing lessons appear as rows in the listing.
- No free-typed course/folder: the current folder (`path()`) is the lesson's
  parent, and the name typed in the dialog is the last path segment — exactly
  how **New folder** already behaves.
- One place to manage them: the separate tab and `admin-youtube.ts` go away.
- A YouTube lesson keeps behaving like a file lesson (progress, comments, notes,
  resources, enrollments) — unchanged from Phase A.

## Non-goals

- No worker / D1 changes; the endpoints and table from Phase A stay as they are.
- No renaming/moving a YouTube lesson through the file manager in this pass
  (add, edit the link, delete only).
- No bulk import, no YouTube Data API (titles are typed).
- No change to how students watch lessons.

## Anti-goals

- Do not break "a real file with the same key wins" (`shadowed` still warns).
- Do not add a runtime dependency or cost.
- Do not leave two places that manage the same lessons.

## Constraints

- Cloudflare Workers + R2 + D1, near-zero cost; no new endpoints.
- Follow the Files view's existing patterns (toolbar actions, `openAsk` dialog,
  toasts, `load()`), and keep the Worker `Api` methods in `api.ts` in sync.

## Approaches considered

- **A — Fold everything into Files (chosen).** Toolbar button + rows in the
  current folder; delete the tab and `admin-youtube.ts`. One place.
- **B — Keep the tab as a global manager *and* add rows in Files.** Rejected:
  two places managing one thing, which is what "and everything" argues against.

## The how (decided)

### Rows in the listing

- The component fetches `listYoutubeLessons()` alongside `listFiles(path())`
  (client-side merge, **no worker change**) and keeps the ones whose parent
  folder equals the current `path()`: `id.slice(0, id.lastIndexOf('/')) === path()`.
- They render in the same `files-list` as files, with the YouTube icon, the
  lesson name, and `video · <yt id>` as the meta. Sorted with the files.
- Each row has **Edit** (change the link, pre-filled) and **Delete** (confirm).
- The empty-folder message shows only when there are no dirs, no files **and**
  no YouTube lessons.

### Toolbar button + dialog

- A **YouTube** button sits next to Upload / New folder.
- It opens a small dialog (reusing `.adm-dialog` / `.field`) with **Lesson
  name** and **YouTube link** only. On save the id is
  `join(path(), name)`; a name containing `/` is refused, like New folder.
- Edit reuses the same dialog with the name fixed and the link pre-filled: it
  posts the same path with the new link (the Phase A upsert-by-path).
- The dialog reports the `shadowed` reply as a warning toast, otherwise "Done".
- On save/delete: toast, `api.init()` (course tree is stale), `load()`.

### Removing the tab

- Delete `src/app/admin-youtube.ts`.
- `admin.ts`: `view` returns to `'users' | 'files'`; remove the YouTube header
  button/`AdminYoutube` import; restore the plain Files toggle.
- `api.ts` methods (`listYoutubeLessons`, `addYoutubeLesson`,
  `deleteYoutubeLesson`) and the worker endpoints stay.

### Docs

- README "YouTube lessons" section: managed from **Admin → Files → YouTube**.
- HANDOFF §4d, file map, API table notes and the decision log updated.
- CHANGELOG entry.

## Verification plan

- `node --check` the Worker (untouched, sanity), `npm run typecheck`,
  `npm run build`.
- Local `wrangler dev` + curl: the Phase A endpoint checks still pass (used by
  the view); add in a nested folder shows only there; edit changes the link;
  delete removes it; `shadowed` still warns.
- A real browser pass over the Files view is not possible here; note it.

## Left to the builder

- Exact markup/CSS for the YouTube rows and the two-field dialog (reuse
  `files-row` / `files-tool` / `field`).
- Whether the YouTube rows sort with the files or come after them (default:
  with the files, by name).

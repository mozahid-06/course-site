# PDF uploads in a video lesson's Resources tab — design

Date: 2026-11-05
Status: proposed

## Intent (why)

A video lesson's **Resources** tab currently holds external links only. The owner
wants to attach a PDF (slides, question paper, handout) directly to a video lesson,
kept separate from lessons, and have a student click it to read it in the app's PDF
viewer.

## Goals

- Admins can **upload a PDF** from the Resources tab of a video or YouTube lesson.
- The PDF is stored **with the course**, not as a lesson: it never appears in the
  course list, never gains progress/comments, and is not a browsable "PDF lesson".
- Students see the PDF in the same resource list as links and **click to open it in the
  same PDF viewer PDF lessons use**, including private annotations and notes.
- Link resources keep working exactly as today.
- Deleting a resource deletes the stored PDF and its annotations too.

## Non-goals

- No PDF editing, replacement, versioning, thumbnails, or download/print buttons.
- No resources tab on PDF lessons (Resources stays video/YouTube-only, as today).
- No direct-to-R2 presigned upload; no chunked upload UI in the Resources panel.
- No new dependency: reuse `ngx-extended-pdf-viewer` and `app-pdf-viewer`.

## Access and annotating (same as PDF lessons)

- Admins: upload, delete, and open every resource PDF.
- Students: can list and open a resource PDF only while enrolled in the course that
  holds the video lesson — the same rule that lets them open a PDF lesson.
- `GET /api/lesson/<lesson>/resources` and `GET /api/media/<key>` both enforce this;
  the media route is the same one PDF lessons use.
- Viewing is read-only with no download/print/open-file controls, matching PDF lessons.
- **Private annotations:** the resource viewer is the same `app-pdf-viewer` component,
  so highlight/draw/text notes, the notes bar, autosave, hide/show and delete-notes all
  work exactly as on a PDF lesson and stay private to each user. Notes are keyed by the
  resource PDF's file key in the existing `pdf_notes` table; the notes endpoint's
  course-access check already matches the PDF-lesson rule, so no new notes API is needed.

## Storage layout

Reserved folder at the course root:

```
<Course>/_resources/<uuid>.pdf
```

- Separate from the lesson tree, so the PDF cannot become a lesson.
- The UUID filename avoids collisions and unsafe names; the display title lives in D1.
- `listCourse()` skips any key with a `_resources` path segment.
- The admin file manager hides `_resources` folders (it is an internal area).
- A course rename moves the folder with the course; the same move updates the stored
  file keys. Section/lesson moves leave the objects in place (keys stay valid).

## Data model

Add to `resources` (migration via `pragma_table_info`, same pattern as `users`):

| Column | Type | Notes |
| --- | --- | --- |
| `kind` | `TEXT NOT NULL DEFAULT 'link'` | `link` or `pdf`; existing rows become `link` |
| `file_key` | `TEXT` | R2 key for `pdf`; null for links |

`url` keeps its meaning for links and is empty for PDFs. The API returns
`url = file_key` for PDFs so the client has one field to open.

## API

- `GET /api/lesson/<lesson>/resources` — unchanged access check; each row gains
  `kind`, and PDF rows return their file key in `url`.
- `POST /api/admin/lesson/<lesson>/resources/pdf` — multipart form:
  `file`, optional `title`, optional `note`.
  - Admin only; `lessonAccess` must be `ok` for the video lesson.
  - Must be a `.pdf`, start with `%PDF-`, **≤ 25 MB**.
  - Title defaults to the file name without `.pdf`; title ≤ 120, note ≤ 300.
  - Same 100-resource-per-lesson cap as links.
  - Stores the object, then inserts the row; if the insert fails, removes the object.
- `DELETE /api/admin/resources/:id` — loads the row first; deletes the R2 object and
  that PDF's `pdf_notes` rows when `file_key` is present, then the row.
- Serving reuses `GET /api/media/<key>`: it already supports PDFs, range requests,
  `private` caching, and the course-access check.

## Cleanup and moves

- Deleting a lesson/section/course: before removing rows, collect `file_key`s for the
  resources attached to the deleted lesson keys; delete those objects and their
  `pdf_notes` rows as well.
- Course rename: add one SQL update each for `resources.file_key` and
  `pdf_notes.lesson` to the existing move transaction so both follow the moved folder.
  Section/lesson moves need no change because notes and files keep their keys.

## UI

### Admin form

The add form gets a two-way switch: **Link | PDF**.

- Link: the current title/URL/note fields and **Add resource**.
- PDF: title (optional, auto-filled from the chosen file), file picker (`.pdf`),
  optional note, **Upload PDF**. Client checks type and 25 MB before sending; button
  shows `Uploading…` and is disabled while the request runs.

### Student list

- Link rows: unchanged (title opens the URL in a new tab).
- PDF rows: document icon, title button, `PDF` as the meta line instead of a host.
  Clicking opens the viewer.

### Viewer

The resource modal reuses `app-pdf-viewer` itself, lazily loaded the first time a PDF is
opened:

- Fixed full-window backdrop with a header (title + Close) around the viewer.
- Identical PDF.js behaviour to a PDF lesson: streaming, 1 MiB ranges, page-fit or
  page-width on phones, dark/light theme, paging/zoom/find/rotate/sidebar/presentation,
  no download/print/open-file buttons.
- Identical private annotations: highlight/draw/text editors, the notes bar, autosave,
  hide/show and delete-notes. Notes are private per user.
- One small `app-pdf-viewer` input (`fullWindow`, default true) hides its redundant
  "Full window" button when the viewer already fills the modal; everything else is the
  same component.
- Escape and backdrop click close; focus moves to Close and returns to the row.

## Verification (no test framework)

- `npm run typecheck` and `npm run build`.
- Local Worker: upload a PDF to an HLS video lesson and a YouTube lesson; confirm the
  object key and row; open as admin and as an enrolled student; range requests load
  pages; **add annotations as a student, reload, and confirm they persist; a second
  student sees their own blank notes**; link resources still work; delete removes row,
  object and annotations; wrong type, >25 MB, non-admin, and 101st resource are
  rejected.
- Remember the existing trap: the local `wrangler dev` process keeps a stale asset
  manifest when `dist/` is rebuilt; restart it before testing new lazy chunks.
- Production: deploy, upload one PDF to a real video lesson, open it and annotate it as
  a student.

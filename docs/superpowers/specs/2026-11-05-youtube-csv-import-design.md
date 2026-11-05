# YouTube CSV import inside the Files view — design

Date: 2026-11-05
Status: proposed

## Intent (why)

Adding YouTube lessons one at a time is fine for one video, but a course often
already has dozens on YouTube. The owner wants to add a whole batch at once from
a file — concretely, `~/Downloads/youtube_links.csv`, to fill the **`atiar`**
course.

## Goals

- In the existing Files → **YouTube** dialog, import many lessons from **one CSV
  file**.
- **One format only: CSV.** ("stuck with one formation … multitype file hard to
  maintain" — no JSON/TSV/TXT.)
- Parsed in the browser; nothing is uploaded to R2; **no Worker change** (N
  client-side `POST`s to the existing endpoint).
- Every imported lesson lands in the **current folder** — the same rule as the
  single add.
- Preview before adding: add the valid rows, list the rejected ones.

## Non-goals

- No Worker / D1 / endpoint changes; no new columns.
- No multi-folder or multi-course import (no path column in the file).
- No YouTube Data API and no automatic titles — names come from the file.
- No rename UI for lessons (unchanged: change-link / delete).

## The format (one format: CSV)

RFC-4180 CSV: `"` quotes with `""` escapes, commas and newlines inside quotes,
LF or CRLF, and an optional UTF-8 **BOM** (stripped). Columns are **positional
and detected**, so extra columns are simply ignored.

Rules:

1. Parse every row into cells.
2. Drop the first row if it looks like a header (it contains no YouTube **URL** —
   a bare video id is not enough here, because a header word such as `Youtube` is
   at least six id-like characters and would otherwise read as one).
3. Find the **link column**: the column whose cells are most often YouTube links.
4. The **name column** is the column immediately to the left of the link column
   (or to the right, when the link is column 0).
5. For each remaining row: `name = cells[nameCol].trim()`,
   `link = cells[linkCol].trim()`. A row with no name or no valid YouTube link is
   **rejected with a reason**; the rest still import.

This handles both a clean `name,link` file and the owner's file.

### Note on the owner's `~/Downloads/youtube_links.csv`

The header declares four columns (`No,Date,Title,URL`), but `Date` is an
**unquoted** `Oct 31, 2026`, so every data row really has **five** fields.
Detecting the link column by content (URL shape) and taking the column to its
left lands exactly on `Title` and `URL`, ignoring the numeric `No` and the split
`Date`. Verified against the file:

- 42 data rows, **42 valid**, 0 rejected
- 0 names containing `/`, 0 empty names, 0 duplicate names
- link column = index 4, name column = index 3

A positional "column 2 is the title" guess would have imported the string
`" 2026"` as every lesson name — which is why detection is by content.

## The how (decided)

### Dialog

- The dialog keeps the single **Lesson name** + **YouTube link** fields, so a
  one-off add is still one line.
- Adds an "**or import a CSV**" row: a file input (`accept=".csv,text/csv"`) and,
  once a file is chosen, a preview.
- Preview shows `N lessons found`, the first few names, and a list of rejected
  rows with reasons.
- The primary button reads **Add N lessons** when a file is loaded, otherwise
  **Add lesson**.
- The file is read with `File.text()`; `parseYoutubeCsv` turns it into
  `{ rows, rejected }`.
- On confirm: for each valid row,
  `await api.addYoutubeLesson(course, folder, name, link)` — the existing method,
  with `course`/`folder` split out of `path()` — counting added / updated /
  `shadowed` and collecting any server errors. Then one summary toast,
  `api.init()`, `load()`.

### Parser module

- New pure module `src/app/youtube-csv.ts` exporting
  `ytId(link)` (mirrors the Worker's regex) and
  `parseYoutubeCsv(text): { rows: { name; link; yt }[]; rejected: { line; reason }[] }`.
- No Angular imports, so it can be unit-tested with plain Node.

### Duplicates

- The same name twice in the file, or a name already present, uses the existing
  upsert (last one wins / the link is updated). Reported in the summary.

## Anti-goals (do not break)

- "A real file with the same key wins" (`shadowed`) still warns.
- No runtime dependency, no cost.
- The single-add flow is unchanged.

## Verification plan

- Run `parseYoutubeCsv` under Node (type-stripping) over the real
  `~/Downloads/youtube_links.csv`: expect 42 rows with the exact names/ids.
- `npm run typecheck`, `npm run build`; grep the bundle for the new copy.
- `wrangler dev` + curl: replay the parsed rows as N `POST`s into a folder and
  confirm `/api/course` lists them.
- Production: import the 42 rows into the **`atiar`** course and confirm the
  count (`SELECT COUNT(*) … LIKE 'atiar/%'`). Production admin credentials are not
  held locally; if that blocks the API path, write the rows with
  `wrangler d1 execute course-db --remote` using the exact ids/yt the endpoint
  would produce, then re-check the listing.
- A real-browser click-through of the new file input is not possible here; note
  it, as with the previous pass.

## Left to the builder

- Exact markup/CSS for the file row and the preview list (reuse `field`,
  `files-error`, `adm-dialog` styles).
- How many preview rows to show before "…and N more".

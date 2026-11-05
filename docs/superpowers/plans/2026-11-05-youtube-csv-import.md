# YouTube CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin add many YouTube lessons at once by uploading a single CSV file of `name,link` rows into the folder they are browsing.

**Architecture:** A pure, dependency-free parser module (`src/app/youtube-csv.ts`) turns CSV text into validated `{ name, link, yt }` rows. The existing Files → YouTube dialog (`src/app/admin-files.ts`) gains a file input + preview, and on confirm loops the already-shipped `api.addYoutubeLesson(course, folder, name, link)` once per row. No Worker, D1, or endpoint change.

**Tech Stack:** Angular 22 (standalone components, signals) + TypeScript 6; Vitest is NOT used — the parser is checked with a throwaway Node script (Node 24 type-stripping). Cloudflare Workers / R2 / D1 unchanged.

**Spec:** `docs/superpowers/specs/2026-11-05-youtube-csv-import-design.md`

## Global Constraints

- **One format only: CSV.** No JSON/TSV/TXT parsing paths.
- **No Worker change.** The endpoint, D1 table, and `api.ts` methods stay exactly as shipped (`addYoutubeLesson(course, folder, lesson, link): Promise<{ ok; id; yt; shadowed }>`).
- The imported lessons go into the **current folder** (`path()`), same as the single add.
- Keep the Worker `Api` service and worker in sync — nothing to change here, but do not diverge.
- Follow existing Files-view patterns: signals, `toast()`, `busy()`, `load()`, `.adm-dialog` / `.field` markup.
- **Do not add a test framework.** Parser checks are a scratch script under `/tmp/opencode/`, not committed.
- Commit to `main` directly (owner consent); run `npm run typecheck` and `npm run build` before every commit.

## Review Focus

Inputs the spec implies but a happy-path test will not exercise; each gets a check in Task 1 unless noted.

1. A **quoted field containing a comma** in the name column (`"Doe, John",https://…`) must stay one field, not split.
2. A **UTF-8 BOM and CRLF** line endings must parse the same as plain LF.
3. A headerless file with the **link column first** (`https://…,Name`) must take the name from the column to its right.
4. A row with a **valid link but an empty name**, and a row with a **non-YouTube link**, are rejected individually while the other rows still import.
5. A file with **duplicate names** relies on the server upsert (last wins) — covered by Task 2's manual `wrangler dev` check, not the unit script.

---

### Task 1: The CSV parser (`src/app/youtube-csv.ts`)

**Files:**
- Create: `src/app/youtube-csv.ts`
- Scratch check (NOT committed): `/tmp/opencode/yt-csv-check.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function ytId(link: string): string | null`
  - `export interface CsvRow { name: string; link: string; yt: string }`
  - `export interface CsvReject { line: number; reason: string }`
  - `export function parseYoutubeCsv(text: string): { rows: CsvRow[]; rejected: CsvReject[] }`

- [ ] **Step 1: Write the failing check script**

Create `/tmp/opencode/yt-csv-check.mjs` (plain Node, imports the not-yet-written module so it fails first):

```js
import { readFileSync } from 'node:fs';
import { parseYoutubeCsv, ytId } from '/home/taxin/Work/course-site/src/app/youtube-csv.ts';

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const same = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

// 1. quoted comma stays one field
same(parseYoutubeCsv('name,link\n"Doe, John",https://youtu.be/dQw4w9WgXcQ').rows.map(r => r.name), ['Doe, John'], 'quoted comma');
// 2. BOM + CRLF
same(parseYoutubeCsv('\uFEFFname,link\r\nA,https://youtu.be/dQw4w9WgXcQ\r\n').rows.map(r => r.name), ['A'], 'BOM+CRLF');
// 3. link column first -> name from the right
same(parseYoutubeCsv('https://youtu.be/dQw4w9WgXcQ,Name').rows, [{ name: 'Name', link: 'https://youtu.be/dQw4w9WgXcQ', yt: 'dQw4w9WgXcQ' }], 'link first');
// 4. per-row rejection: empty name and non-YouTube link
const bad = parseYoutubeCsv('name,link\n,https://youtu.be/dQw4w9WgXcQ\nOk,not-a-link\nGood,https://youtu.be/abcdefghijk');
same(bad.rows.map(r => r.name), ['Good'], 'only valid rows kept');
if (bad.rejected.length !== 2) fail(`expected 2 rejects, got ${bad.rejected.length}`);
// bare video id accepted
if (ytId('dQw4w9WgXcQ') !== 'dQw4w9WgXcQ') fail('bare id');

// the real file
const text = readFileSync('/home/taxin/Downloads/youtube_links.csv', 'utf8');
const real = parseYoutubeCsv(text);
if (real.rows.length !== 42) fail(`real file: expected 42 rows, got ${real.rows.length}`);
if (real.rejected.length !== 0) fail(`real file: expected 0 rejects, got ${real.rejected.length}`);
if (real.rows[0].name !== 'নেকলেস' || real.rows[0].yt !== 'c327zgGXrm0') fail(`real file row 0: ${JSON.stringify(real.rows[0])}`);
if (real.rows.some(r => r.name.includes('/'))) fail('real file has a slash in a name');
if (!process.exitCode) console.log('ALL CHECKS PASSED —', real.rows.length, 'rows');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node /tmp/opencode/yt-csv-check.mjs`
Expected: FAIL — `Cannot find module …/youtube-csv.ts`.

- [ ] **Step 3: Implement `src/app/youtube-csv.ts`**

Exact signatures as in Interfaces. Implementation notes (decisions the checks do not fix):
- `ytId` mirrors the Worker's `worker/index.js` `ytId` regex verbatim: `/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{6,})/`, else a bare `^[A-Za-z0-9_-]{6,}$`.
- A private `splitCsv(text)`: strip a leading `\uFEFF`, walk characters building cells — a `"` opens a quoted field, `""` is a literal quote, a comma ends a cell, `\n` (with optional preceding `\r`) ends a row.
- `parseYoutubeCsv`: drop empty rows; treat row 0 as a header iff no cell in it parses via `ytId`; over the data rows pick `linkCol` = the column index with the most `ytId` hits (ties → lowest index); `nameCol = linkCol > 0 ? linkCol - 1 : linkCol + 1`; per row reject (`rejected.push({ line, reason })`) when the name is empty, the name contains `/`, or the link is not a YouTube link, else push `{ name, link, yt }`. `line` is the 1-based source line (`idx + 1`, plus 1 when a header was dropped).

- [ ] **Step 4: Run it to verify it passes**

Run: `node /tmp/opencode/yt-csv-check.mjs`
Expected: `ALL CHECKS PASSED — 42 rows`.

- [ ] **Step 5: Typecheck, commit**

```bash
cd /home/taxin/Work/course-site
npm run typecheck
git add src/app/youtube-csv.ts
git commit -m "feat(admin): CSV parser for YouTube lesson batches"
```

---

### Task 2: Wire the import into the Files YouTube dialog

**Files:**
- Modify: `src/app/admin-files.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `parseYoutubeCsv`, `CsvRow`, `CsvReject` (Task 1); `api.addYoutubeLesson(course, folder, lesson, link)` (existing, unchanged).
- Produces: nothing downstream.

- [ ] **Step 1: Add the import state to `AdminFiles`**

Signals next to the existing `yt*` signals: `csvName = signal('')`, `csvRows = signal<CsvRow[]>([])`, `csvBad = signal<CsvReject[]>([])`. Import `parseYoutubeCsv` and the `CsvRow`/`CsvReject` types from `./youtube-csv`. Add computeds: `csvPreview = computed(() => this.csvRows().slice(0, 8))`; `ytCta = computed(() => this.busy() ? 'Working…' : this.csvRows().length ? \`Add ${this.csvRows().length} lesson${this.csvRows().length === 1 ? '' : 's'}\` : this.ytEditing() ? 'Save' : 'Add lesson')`; `csvBadSummary = computed(() => this.csvBad().length ? \`${this.csvBad().length} row${this.csvBad().length === 1 ? '' : 's'} skipped — ${this.csvBad().slice(0, 3).map(b => \`line ${b.line}: ${b.reason}\`).join('; ')}\` : '')`.

- [ ] **Step 2: Add `onCsv` and `importCsv` methods**

- `protected async onCsv(input: HTMLInputElement): Promise<void>` — read `input.files?.[0]`, reset `input.value = ''`, `const { rows, rejected } = parseYoutubeCsv(await file.text())`, set `csvName`, `csvRows`, `csvBad`, clear `ytError`.
- `protected async importCsv(): Promise<void>` — guard an empty `csvRows()` with `ytError.set('That file had no lessons. Each row needs a name and a YouTube link.')`. Split `this.path()` into `course = parts[0]`, `folder = parts.slice(1).join('/')`. Loop rows: `await this.api.addYoutubeLesson(course, folder, r.name, r.link)`, counting `added` and `shadowed` (from the reply) and pushing `r.name` to `failed` on throw. On finish: if `failed.length`, set `ytError` to `` `${failed.length} failed: ${failed.slice(0,3).join(', ')}` `` and stay open; else `closeYt()`, `toast(...)` a summary (`Added ${added}` plus shadowed detail), `void this.api.init()`, `await this.load()`. Always clear `busy()`.
- Extend `closeYt()` and `openYt()` to reset `csvName`/`csvRows`/`csvBad`.

- [ ] **Step 3: Add the file input + preview to the dialog template**

Inside the `@if (ytOpen())` dialog, after the existing Link field and only when `!ytEditing()`: a `.field` containing a `<span>…or import a CSV · name, link</span>` and `<input #csvPicker type="file" accept=".csv,text/csv" (change)="onCsv(csvPicker)" />`; then, when `csvName()`, a `<p class="adm-muted sm">` line (`{{ csvRows().length }} lessons found in {{ csvName() }}`), a `<ul class="yt-import">` rendering `csvPreview()` (with an `@if (csvRows().length > 8)` "…and N more" `li.more`), and the `csvBadSummary()` in a `<p class="files-error">`. Change the primary button to `(click)="csvRows().length ? importCsv() : saveYt()"` with label `{{ ytCta() }}`.

- [ ] **Step 4: Add the preview CSS**

In `src/styles.css`, next to the other `.files-*` rules:

```css
.yt-import{list-style:none;margin:.2rem 0 0;padding:0;max-height:11rem;overflow:auto;border:1px solid var(--line);border-radius:.5rem}
.yt-import li{padding:.35rem .6rem;border-top:1px solid var(--line);font-size:.85rem;overflow-wrap:anywhere}
.yt-import li:first-child{border-top:0}
.yt-import li.more{color:var(--mute)}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`, then
`grep -c "or import a CSV" dist/web/browser/main-*.js` (expect ≥1) and
`grep -o "\.yt-import{[^}]*}" dist/web/browser/*.css` (expect a match).
Then `wrangler dev` + curl replay: log in, `POST /api/admin/youtube` once per parsed row into `Demo/Course` and confirm `/api/course` lists them; re-post one row with a changed link and confirm the link updates (upsert). Kill the dev Worker and remove `.dev.vars` afterwards.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin-files.ts src/styles.css
git commit -m "feat(admin): import YouTube lessons from a CSV in the Files view"
```

---

### Task 3: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/CHANGELOG.md`

- [ ] **Step 1: README** — in the "YouTube lessons" section, document the batch: open a course folder, click **YouTube**, choose a **CSV** (`name,link` per row; extra columns and a header row are fine; the link column is detected by its URL), preview the count, then **Add N lessons**. Note it adds to the current folder and updates duplicates.
- [ ] **Step 2: HANDOFF** — add `src/app/youtube-csv.ts` to the file map; extend §4d with one sentence on the CSV import (client-side parse, N posts, no Worker change); add a decision-log row "One CSV format for batch import".
- [ ] **Step 3: CHANGELOG** — a "Added (YouTube CSV import)" entry under Unreleased.
- [ ] **Step 4: Commit** — `git commit -m "docs: YouTube lessons can be imported from a CSV"`.

---

### Task 4: Populate the `atiar` course and verify production

**Files:**
- Scratch (NOT committed): `/tmp/opencode/import-atiar.mjs`, `/tmp/opencode/import-atiar.sql`

**Interfaces:**
- Consumes: `parseYoutubeCsv` (Task 1).
- Produces: 42 rows in production D1 (`youtube_lessons`), ids `atiar/<name>`.

- [ ] **Step 1: Generate the SQL** with a scratch script that imports `parseYoutubeCsv`, reads `~/Downloads/youtube_links.csv`, builds ids `atiar/<name>` (single-quotes doubled), and prints one `INSERT INTO youtube_lessons (id, yt, created) VALUES (…, …, <now>) ON CONFLICT(id) DO UPDATE SET yt = excluded.yt;` per row to `/tmp/opencode/import-atiar.sql`.
- [ ] **Step 2: Apply it** — `npx wrangler d1 execute course-db --remote --file /tmp/opencode/import-atiar.sql`.
- [ ] **Step 3: Verify the count** — `npx wrangler d1 execute course-db --remote --json --command "SELECT COUNT(*) n FROM youtube_lessons WHERE id LIKE 'atiar/%'"` → `n = 42`.
- [ ] **Step 4: Note the cache** — the site course list refreshes within 60 s (a direct D1 write cannot call the Worker's `invalidateCourse()`); no commit needed for this task.

---

## Self-Review

- **Spec coverage:** format/CSV-only (Task 1), detection rules (Task 1), dialog + preview + current-folder + N posts + no Worker change (Task 2), docs (Task 3), `atiar` import (Task 4). All spec sections covered.
- **Step scan:** each step is one action with a check; the parser body is given as algorithm notes, not a transcript.
- **Type consistency:** `CsvRow`/`CsvReject`/`parseYoutubeCsv`/`ytId` names and shapes match between Task 1's Interfaces and Task 2's usage; `addYoutubeLesson` args match `api.ts`.
- **Review Focus:** the five items map to Task 1 checks 1–4 and Task 2 Step 5's duplicate-upsert replay.

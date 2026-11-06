# Resource PDF Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin upload a PDF into a video/YouTube lesson's Resources tab, store it outside the lesson tree, and open it in the same PDF viewer (with private annotations) students use for PDF lessons.

**Architecture:** Store each resource PDF at `<Course>/_resources/<uuid>.pdf` in R2 and record `kind`/`file_key` on the existing D1 `resources` row. The course listing and admin file manager skip `_resources`, so uploads never become lessons. The existing `GET /api/media/<key>` and `/api/notes/<key>` routes already enforce course access, so the viewer reuses `app-pdf-viewer` unchanged apart from hiding its redundant full-window button.

**Tech Stack:** Angular 22 standalone components/signals, Cloudflare Worker (ES modules), D1, R2, `ngx-extended-pdf-viewer` 31.

**Spec:** `docs/superpowers/specs/2026-11-05-resource-pdf-uploads-design.md`

## Global Constraints

- Do not add a test framework or a new dependency.
- Reuse `ngx-extended-pdf-viewer` through the existing `app-pdf-viewer` component.
- Resources remain available only on video and YouTube lessons.
- Resource PDFs must never appear in `/api/course` as lessons.
- Access rules must match PDF lessons: admins always; students only while enrolled in the course; media and notes both checked.
- Viewing is read-only: no download, print, or open-file buttons.
- PDF upload cap: 25 MB; title ≤ 120 characters; note ≤ 300 characters; max 100 resources per lesson (shared with links).
- Storage key: `<Course>/_resources/<uuid>.pdf`.
- The local `wrangler dev` process keeps a stale asset manifest after `ng build`; restart it before browser verification.
- Commits go directly to `main` (no PRs).

## Review Focus

- A resource PDF must never show up as a lesson (including after a cached course listing or an upload into a course whose folder uses mixed case).
- Deleting a resource, its video lesson, its section, or its course must remove the R2 object **and** its `pdf_notes`; the hidden `_resources` folder means the file manager cannot clean up leftovers.
- Notes must stay private per user and follow the resource PDF after a course rename; closing the modal must flush pending autosave.
- Upload must reject non-PDF content, oversized files, and non-admins before storing anything.
- A student outside the course must not be able to fetch the PDF or its notes by guessing the URL.

---

### Task 1: Schema, course-list skip, and resource API metadata

**Files:**
- Modify: `worker/index.js:86-90` (`migrate`)
- Modify: `worker/index.js:185-188` (`listCourse` key loop)
- Modify: `worker/index.js:564-603` (resource GET/POST)

**Interfaces:**
- Consumes: existing `resources` table and `lessonAccess`.
- Produces: `resources.kind` (`'link' | 'pdf'`), `resources.file_key` (nullable text), and a GET response where each row is `{ id, title, url, note, kind }` and PDF rows carry the R2 key in `url`.

- [ ] **Step 1: Add the two columns to `migrate()`**

After the existing `ver` column block, inside `migrate(env)`:

```js
const hasResKind = await env.DB.prepare("SELECT COUNT(*) c FROM pragma_table_info('resources') WHERE name = 'kind'").first();
if (!hasResKind.c) await env.DB.prepare("ALTER TABLE resources ADD COLUMN kind TEXT NOT NULL DEFAULT 'link'").run();
const hasResFile = await env.DB.prepare("SELECT COUNT(*) c FROM pragma_table_info('resources') WHERE name = 'file_key'").first();
if (!hasResFile.c) await env.DB.prepare('ALTER TABLE resources ADD COLUMN file_key TEXT').run();
```

- [ ] **Step 2: Skip `_resources` in `listCourse`**

In the `for (const key of keys)` loop, immediately after the `.ts` skip:

```js
if (key.split('/').includes('_resources')) continue; // resource PDFs are not lessons
```

- [ ] **Step 3: Return `kind` and the openable URL from `GET /api/lesson/<lesson>/resources`**

Replace the current SELECT + `json({ resources: rows })` with:

```js
const rows = (await env.DB.prepare('SELECT id, title, url, note, kind, file_key FROM resources WHERE lesson = ? ORDER BY created ASC').bind(key).all()).results;
const resources = rows.map((r) => ({
  id: r.id,
  title: r.title,
  url: r.kind === 'pdf' ? (r.file_key || '') : r.url,
  note: r.note,
  kind: r.kind === 'pdf' ? 'pdf' : 'link',
}));
return json({ resources });
```

- [ ] **Step 4: Make the link POST explicit about `kind`**

Change its INSERT to include `kind` and its response to include it:

```js
const res = await env.DB.prepare("INSERT INTO resources (lesson, title, url, note, created_by, created, kind) VALUES (?, ?, ?, ?, ?, ?, 'link')").bind(key, title, url, note || null, u.id, Date.now()).run();
return json({ resource: { id: res.meta.last_row_id, title, url, note: note || null, kind: 'link' } });
```

- [ ] **Step 5: Verify the Worker bundles and the migration runs**

Run:
```bash
npx wrangler deploy --dry-run --outdir /tmp/opencode/wrangler-dry
```
Expected: `--dry-run: exiting now` with no syntax errors.

Start (or restart) `npx wrangler dev --port 8787`, then:
```bash
curl -s -c /tmp/opencode/cj -X POST localhost:8787/api/login -H 'content-type: application/json' -d '{"email":"owner@example.com","password":"localdevpass1234"}'
npx wrangler d1 execute course-db --local --command "SELECT name FROM pragma_table_info('resources')"
```
Expected: the column list contains `kind` and `file_key`.

Add a link to a video lesson and read it back:

```bash
LESSON=$(curl -s -b /tmp/opencode/cj localhost:8787/api/course | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(l["id"] for c in d for s in c["sections"] for l in s["lessons"] if l["kind"]=="video"))')
ENC=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$LESSON")
curl -s -b /tmp/opencode/cj -X POST -H 'content-type: application/json' -d '{"title":"Test link","url":"https://example.com"}' "localhost:8787/api/admin/lesson/$ENC/resources"
curl -s -b /tmp/opencode/cj "localhost:8787/api/lesson/$ENC/resources"
```
Expected: the GET contains `"kind":"link"` and the original URL. Then delete that row with `DELETE /api/admin/resources/<id>`.

Inspect one course with `curl -s -b /tmp/opencode/cj localhost:8787/api/course` and confirm no lesson id contains `/_resources/`.

- [ ] **Step 6: Commit**

```bash
git add worker/index.js
git commit -m "feat(resources): add PDF columns and keep resource files out of lessons"
```

---

### Task 2: Admin PDF upload endpoint

**Files:**
- Modify: `worker/index.js:573-603` (inside the `/api/admin/` guard, before the existing link POST block)

**Interfaces:**
- Consumes: `lessonAccess`, `courseOf`, `resources.kind`/`file_key` from Task 1.
- Produces: `POST /api/admin/lesson/<encoded lesson>/resources/pdf`, multipart fields `file` (required), `title` (optional), `note` (optional), returning `{ resource: { id, title, url, note, kind: 'pdf' } }` where `url` is the R2 key.

- [ ] **Step 1: Add the multipart upload block**

Insert **before** the existing `if (path.startsWith('/api/admin/lesson/') && path.endsWith('/resources') && m === 'POST')` block:

```js
if (path.startsWith('/api/admin/lesson/') && path.endsWith('/resources/pdf') && m === 'POST') {
  const key = decodeURIComponent(path.slice('/api/admin/lesson/'.length, -'/resources/pdf'.length));
  const access = await lessonAccess(env, u, key);
  if (access !== 'ok') return accessError(access);
  if (Number(req.headers.get('content-length') || 0) > 26 * 1024 * 1024) return json({ error: 'PDFs must be 25 MB or smaller' }, 413);
  const form = await req.formData().catch(() => null);
  const file = form && form.get('file');
  if (!form || !(file instanceof File)) return json({ error: 'Choose a PDF file' }, 400);
  if (!/\.pdf$/i.test(file.name || '')) return json({ error: 'Choose a PDF file' }, 400);
  if (file.size > 25 * 1024 * 1024) return json({ error: 'PDFs must be 25 MB or smaller' }, 413);
  const head = String.fromCharCode(...new Uint8Array(await file.slice(0, 5).arrayBuffer()));
  if (head !== '%PDF-') return json({ error: 'That file is not a PDF' }, 400);

  const rawTitle = String(form.get('title') || '').trim();
  const note = String(form.get('note') || '').trim();
  let title = rawTitle || String(file.name).replace(/\.pdf$/i, '').trim() || 'PDF';
  if (title.length > 120) {
    if (rawTitle) return json({ error: 'Keep the title under 120 characters' }, 400);
    title = title.slice(0, 120);
  }
  if (note.length > 300) return json({ error: 'Keep the note under 300 characters' }, 400);

  const n = await env.DB.prepare('SELECT COUNT(*) n FROM resources WHERE lesson = ?').bind(key).first();
  if (n.n >= 100) return json({ error: 'This lesson already has 100 resources' }, 400);

  const fileKey = `${courseOf(key)}/_resources/${crypto.randomUUID()}.pdf`;
  await env.RESOURCES.put(fileKey, await file.arrayBuffer(), { httpMetadata: { contentType: 'application/pdf' } });
  try {
    const res = await env.DB.prepare("INSERT INTO resources (lesson, title, url, note, created_by, created, kind, file_key) VALUES (?, ?, '', ?, ?, ?, 'pdf', ?)").bind(key, title, note || null, u.id, Date.now(), fileKey).run();
    return json({ resource: { id: res.meta.last_row_id, title, url: fileKey, note: note || null, kind: 'pdf' } });
  } catch (e) {
    await env.RESOURCES.delete(fileKey).catch(() => {});
    throw e;
  }
}
```

- [ ] **Step 2: Verify successful upload and rejects**

Restart `wrangler dev` after `npm run build`, then pick a video lesson and URL-encode its key:

```bash
LESSON=$(curl -s -b /tmp/opencode/cj localhost:8787/api/course | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(l["id"] for c in d for s in c["sections"] for l in s["lessons"] if l["kind"]=="video"))')
ENC=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$LESSON")
TEST_PDF=$(find /usr/share -name '*.pdf' 2>/dev/null | head -1)
```

With a real PDF at `$TEST_PDF`:

```bash
curl -s -b /tmp/opencode/cj -F "file=@$TEST_PDF" -F "title=Slides" "localhost:8787/api/admin/lesson/$ENC/resources/pdf"
```
Expected: `{"resource":{...,"kind":"pdf","url":"<Course>/_resources/<uuid>.pdf"}}`. Open `http://localhost:8787/api/media/<that url>` while signed in and confirm `200` + `content-type: application/pdf`.

Reject checks:
```bash
printf 'not a pdf' > /tmp/opencode/fake.pdf
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/opencode/cj -F "file=@/tmp/opencode/fake.pdf" "localhost:8787/api/admin/lesson/$ENC/resources/pdf"
```
Expected: `400`. Also confirm a student cookie gets `403`, and a file over 25 MB gets `413`:
```bash
truncate -s 26M /tmp/opencode/big.pdf
curl -s -o /dev/null -w '%{http_code}\n' -b /tmp/opencode/cj -F "file=@/tmp/opencode/big.pdf" "localhost:8787/api/admin/lesson/$ENC/resources/pdf"
```
Expected: `413` (the size check runs before the magic-byte check).

- [ ] **Step 3: Commit**

```bash
git add worker/index.js
git commit -m "feat(resources): accept PDF uploads for video lessons"
```

---

### Task 3: Deleting a resource removes its PDF and annotations

**Files:**
- Modify: `worker/index.js:598-601` (the `DELETE /api/admin/resources/:id` branch)

**Interfaces:**
- Consumes: `file_key` from Task 2; existing `pdf_notes` table.
- Produces: `DELETE /api/admin/resources/:id` also deletes `<file_key>` from R2 and its `pdf_notes` rows; still returns `{ ok: true }` when the id is already gone.

- [ ] **Step 1: Replace the delete branch**

```js
if (mr && m === 'DELETE') {
  const id = Number(mr[1]);
  const row = await env.DB.prepare('SELECT file_key FROM resources WHERE id = ?').bind(id).first();
  await env.DB.prepare('DELETE FROM resources WHERE id = ?').bind(id).run();
  if (row && row.file_key) {
    await env.RESOURCES.delete(row.file_key).catch(() => {});
    await env.DB.prepare('DELETE FROM pdf_notes WHERE lesson = ?').bind(row.file_key).run();
  }
  return json({ ok: true });
}
```

- [ ] **Step 2: Verify**

Upload a PDF (Task 2), open it as a student and add one highlight so a `pdf_notes` row exists. Then:
```bash
curl -s -b /tmp/opencode/cj -X DELETE localhost:8787/api/admin/resources/<id>
npx wrangler d1 execute course-db --local --command "SELECT lesson FROM pdf_notes WHERE lesson LIKE '%/_resources/%'"
npx wrangler d1 execute course-db --local --command "SELECT id, file_key FROM resources WHERE id = <id>"
```
Expected: no notes row for that file key and no resource row. Requesting the old media URL returns `404`.

- [ ] **Step 3: Commit**

```bash
git add worker/index.js
git commit -m "feat(resources): delete stored resource PDFs and their notes"
```

---

### Task 4: File-manager hide, lesson-delete cleanup, and rename follow-through

**Files:**
- Modify: `worker/files.js:48-65` (`listFolder`)
- Modify: `worker/files.js:85-92` (`LESSON_ROWS`)
- Modify: `worker/files.js:110-192` (`moveEntry`)
- Modify: `worker/files.js:227-262` (`deleteEntry`)
- Modify: `worker/index.js:634-641` (`DELETE /api/admin/youtube`)

**Interfaces:**
- Consumes: `resources.file_key` and the `_resources` layout.
- Produces: `_resources` folders never appear in `GET /api/admin/files`; deleting a lesson/section/course (including a YouTube lesson) also deletes attached resource PDFs and their notes; a course rename or a lesson's cross-course move rewrites `resources.file_key` (annotations already follow because resource PDF keys satisfy `isLessonKey`).

- [ ] **Step 1: Hide the reserved folder**

In `listFolder`, skip it while collecting sub-folders:

```js
for (const p of r.delimitedPrefixes || []) {
  const full = p.replace(/\/$/, '');
  if (!full || full.split('/').pop() === '_resources') continue;
  dirs.push({ name: full.split('/').pop(), path: full });
}
```

- [ ] **Step 2: Make `file_key` follow a course rename**

Add to `LESSON_ROWS`:

```js
'UPDATE resources SET file_key = ? WHERE file_key = ?',
```

This runs for every lesson-key pair. During a course rename the resource PDF pair is `<Old>/_resources/x.pdf → <New>/_resources/x.pdf`, so the row follows. The existing `UPDATE OR REPLACE pdf_notes SET lesson = ?` already moves those annotations for the same reason.

- [ ] **Step 3: Delete attached PDFs with their lesson**

In `deleteEntry`, after `const lessons = new Set([...])` and before the empty-check, add:

```js
// Resource PDFs live outside the lesson keys, so deleting their lesson must take them too.
for (const lessonKey of [...lessons]) {
  const rows = await env.DB.prepare('SELECT file_key FROM resources WHERE lesson = ? AND file_key IS NOT NULL').bind(lessonKey).all();
  for (const row of rows.results || []) {
    if (!keys.includes(row.file_key)) keys.push(row.file_key);
    lessons.add(row.file_key);
  }
}
```

The pushed keys are deleted from R2 with the rest, and `LESSON_DELETES` removes their `pdf_notes` because `lessons` now contains them.

- [ ] **Step 4: Follow a lesson that moves to another course**

A resource PDF lives under its course, so a lesson moved to a different course must take its PDFs along. Add near the top of `worker/files.js`:

```js
const courseOf = (key) => String(key).split('/')[0];
```

In `moveEntry`, right after `const destKeys = new Set(pairs.map((p) => p.to));` and **before** the `targetObjects` check, append the attached PDFs:

```js
// A resource PDF belongs to a course folder, so a lesson that crosses courses needs its
// PDFs copied into the destination course's _resources folder too. Course renames already
// carry them as ordinary objects, so destKeys keeps this from adding duplicates.
for (const p of [...pairs]) {
  if (!isLessonKey(p.from) || !isLessonKey(p.to) || courseOf(p.from) === courseOf(p.to)) continue;
  const rows = await env.DB.prepare('SELECT file_key FROM resources WHERE lesson = ? AND file_key IS NOT NULL').bind(p.from).all();
  for (const row of rows.results || []) {
    const toKey = `${courseOf(p.to)}/_resources/${row.file_key.split('/').pop()}`;
    if (destKeys.has(toKey)) continue;
    pairs.push({ from: row.file_key, to: toKey });
    destKeys.add(toKey);
  }
}
```

The added pairs are copied and deleted like any other object, `LESSON_ROWS` rewrites `resources.file_key` and `pdf_notes.lesson`, and students in the destination course can open them.

- [ ] **Step 5: Delete a YouTube lesson's resource PDFs too**

YouTube lessons are D1 rows, so they never reach `deleteEntry`. Replace the `DELETE /api/admin/youtube` branch with:

```js
if (path === '/api/admin/youtube' && m === 'DELETE') {
  const b = await req.json();
  const id = String(b.id || '').trim();
  if (!id) return json({ error: 'Missing lesson' }, 400);
  const pdfs = (await env.DB.prepare('SELECT file_key FROM resources WHERE lesson = ? AND file_key IS NOT NULL').bind(id).all()).results;
  for (const row of pdfs) {
    await env.RESOURCES.delete(row.file_key).catch(() => {});
    await env.DB.prepare('DELETE FROM pdf_notes WHERE lesson = ?').bind(row.file_key).run();
  }
  await env.DB.prepare('DELETE FROM resources WHERE lesson = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM youtube_lessons WHERE id = ?').bind(id).run();
  invalidateCourse();
  return json({ ok: true });
}
```

- [ ] **Step 6: Verify**

- In the file manager, list a course that has uploaded PDFs; `_resources` must not appear.
- Delete a video lesson that has a resource PDF; the file disappears (media URL `404`), the `resources` row is gone, and `pdf_notes` for the file key is gone.
- Rename a course (`POST /api/admin/files/move` with `{from:"Old",to:"New",kind:"folder"}`), then check:
```bash
npx wrangler d1 execute course-db --local --command "SELECT lesson, file_key FROM resources WHERE file_key LIKE 'New/_resources/%'"
```
Expected: the row's `file_key` starts with `New/_resources/`, and the student's annotations still load when the PDF is opened from the renamed lesson.
- Move a video lesson to a different course (`{from:"Old/Section/video.mp4",to:"Other/Section/video.mp4",kind:"file"}`), create or use a student enrolled only in `Other`, and open the resource PDF: the media and notes requests return `200` and the annotation persists.
- Delete a YouTube lesson that has a resource PDF; its object URL returns `404` and no `pdf_notes`/`resources` rows remain for it or the file key.

- [ ] **Step 7: Commit**

```bash
git add worker/files.js worker/index.js
git commit -m "feat(files): hide resource PDFs and clean them up with their lessons"
```

---

### Task 5: Frontend API and the viewer's `fullWindow` input

**Files:**
- Modify: `src/app/api.ts:15` (`ResourceItem`)
- Modify: `src/app/api.ts:32-41` (`req`) and `:128-132` (resource methods)
- Modify: `src/app/pdf-viewer.ts:43-52` (full-window button) and `:130` (input)

**Interfaces:**
- Consumes: the Worker routes from Tasks 1-4.
- Produces:
  - `ResourceItem { id: number; title: string; url: string; note: string | null; kind: 'link' | 'pdf' }`
  - `Api.uploadResourcePdf(key: string, file: File, title?: string, note?: string): Promise<{ resource: ResourceItem }>`
  - `PdfViewer.fullWindow` input (`boolean`, default `true`)

- [ ] **Step 1: Extend the resource type and add an upload method**

```ts
export interface ResourceItem { id: number; title: string; url: string; note: string | null; kind: 'link' | 'pdf' }
```

Add a form-data helper next to `req`:

```ts
private async raw<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch('/api/' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Request failed', res.status);
  return data as T;
}
```

Add after `addResource`:

```ts
uploadResourcePdf(key: string, file: File, title?: string, note?: string): Promise<{ resource: ResourceItem }> {
  const form = new FormData();
  form.append('file', file);
  if (title) form.append('title', title);
  if (note) form.append('note', note);
  return this.raw(`admin/${this.lessonPath(key, 'resources')}/pdf`, { method: 'POST', body: form });
}
```

- [ ] **Step 2: Add the `fullWindow` input and hide the button when false**

In `PdfViewer`:

```ts
readonly fullWindow = input(true);
```

Wrap the existing full-window `<button>` (the first `notes-btn`) in:

```html
@if (fullWindow()) {
  <button type="button" class="notes-btn" (click)="toggleExpanded()" ...existing markup...>
    ...
  </button>
}
```

Leave `expanded` and the Escape handler as they are; with `fullWindow` false the button is gone and `expanded` stays false.

- [ ] **Step 3: Verify**

```bash
npm run typecheck
npm run build
```
Expected: both succeed. The PDF lesson page still shows the full-window button (default `true`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api.ts src/app/pdf-viewer.ts
git commit -m "feat(resources): expose PDF upload to the client"
```

---

### Task 6: Admin form, student PDF rows, and the modal viewer

**Files:**
- Modify: `src/app/lesson-resources.ts` (whole component)
- Modify: `src/styles.css:628-646` (resource styles) and `:535-539` (viewer styles)

**Interfaces:**
- Consumes: `Api.uploadResourcePdf`, `ResourceItem.kind`, `PdfViewer` with `fullWindow`.
- Produces: the complete Resources UI: Link | PDF switch for admins; PDF rows open a fixed full-window modal containing `app-pdf-viewer [key]="row.url" [fullWindow]="false"`.

- [ ] **Step 1: Update imports and signals**

```ts
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Api, Lesson, ResourceItem } from './api';
import { PdfViewer } from './pdf-viewer';
```

Add to the component:

```ts
protected readonly mode = signal<'link' | 'pdf'>('link');
protected readonly file = signal<File | null>(null);
protected readonly opened = signal<ResourceItem | null>(null);
private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
private readonly destroyRef = inject(DestroyRef);
private lastFocus: HTMLElement | null = null;
```

Register `PdfViewer` in the component's `imports`.

- [ ] **Step 2: Replace the admin form**

Inside `@if (isAdmin())`, use a submit handler that picks the right action:

```html
<form class="lr-form" (submit)="$event.preventDefault(); mode() === 'pdf' ? upload() : add()">
  <div class="seg lr-mode" role="group" aria-label="Resource type">
    <button type="button" [class.on]="mode() === 'link'" [attr.aria-pressed]="mode() === 'link'" (click)="setMode('link')">Link</button>
    <button type="button" [class.on]="mode() === 'pdf'" [attr.aria-pressed]="mode() === 'pdf'" (click)="setMode('pdf')">PDF</button>
  </div>
  <input type="text" placeholder="Title (e.g. Slides)" aria-label="Resource title" maxlength="120"
    [value]="title()" (input)="title.set($any($event.target).value)" />
  @if (mode() === 'link') {
    <input type="url" placeholder="https://..." aria-label="Resource link" maxlength="800"
      [value]="url()" (input)="url.set($any($event.target).value)" />
  } @else {
    <input #fileInput type="file" accept="application/pdf,.pdf" aria-label="PDF file" (change)="pick($event)" />
  }
  <input type="text" placeholder="Optional note" aria-label="Resource note" maxlength="300"
    [value]="note()" (input)="note.set($any($event.target).value)" />
  <button class="p" type="submit" [disabled]="saving()">
    {{ saving() ? (mode() === 'pdf' ? 'Uploading...' : 'Adding...') : (mode() === 'pdf' ? 'Upload PDF' : 'Add resource') }}
  </button>
</form>
```

- [ ] **Step 3: Render PDF rows differently**

In the `@for`, replace the icon and title block:

```html
<span class="lr-icon" aria-hidden="true">
  @if (r.kind === 'pdf') {
    <svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /><path d="M9.5 12.5h5M9.5 16h5" /></svg>
  } @else {
    <svg viewBox="0 0 24 24"><path d="M9.5 14.5 14.5 9.5" /><path d="M11 7l1.8-1.8a4 4 0 0 1 5.6 5.6L16.6 12.6" /><path d="M13 17l-1.8 1.8a4 4 0 0 1-5.6-5.6L7.4 11.4" /></svg>
  }
</span>
<div class="lr-body">
  @if (r.kind === 'pdf') {
    <button type="button" class="lr-title lr-open" (click)="open(r)">{{ r.title }}</button>
    <span class="lr-host">PDF</span>
  } @else {
    <a class="lr-title" [href]="r.url" target="_blank" rel="noopener noreferrer">{{ r.title }}</a>
    <span class="lr-host">{{ host(r.url) }}</span>
  }
  @if (r.note) { <p class="lr-note">{{ r.note }}</p> }
</div>
```

- [ ] **Step 4: Add the modal**

After the resource list / loading blocks, still inside the root `<div class="lr">`:

```html
@if (opened(); as r) {
  @defer (on immediate) {
    <div class="lr-viewer" role="dialog" aria-modal="true" [attr.aria-label]="r.title">
      <header class="lr-viewer-top">
        <span class="lr-viewer-title">{{ r.title }}</span>
        <button #closeBtn type="button" class="lr-viewer-close" aria-label="Close PDF" (click)="close()">Close</button>
      </header>
      <app-pdf-viewer [key]="r.url" [fullWindow]="false" />
    </div>
  } @placeholder {
    <div class="lr-viewer lr-viewer-loading" aria-live="polite">Loading PDF...</div>
  } @error {
    <div class="lr-viewer lr-viewer-loading" role="alert">
      Could not load the PDF. <button type="button" class="lr-link" (click)="close()">Close</button>
    </div>
  }
}
```

- [ ] **Step 5: Add the behaviour**

```ts
constructor() {
  effect(() => {
    const lesson = this.lesson();
    if (lesson.id === this.currentId) return;
    this.currentId = lesson.id;
    untracked(() => {
      this.title.set('');
      this.url.set('');
      this.note.set('');
      this.file.set(null);
      this.mode.set('link');
      this.error.set('');
      const input = this.fileInput()?.nativeElement;
      if (input) input.value = '';
      void this.load(lesson.id);
    });
  });

  // Focus the close button when the deferred modal has rendered.
  effect(() => {
    if (this.opened() && this.closeBtn()) this.closeBtn()!.nativeElement.focus();
  });

  // Escape closes the modal; the viewer's own Escape handler only acts when expanded.
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.opened()) { e.preventDefault(); e.stopPropagation(); this.close(); }
  };
  document.addEventListener('keydown', esc);
  this.destroyRef.onDestroy(() => {
    document.removeEventListener('keydown', esc);
    document.body.style.overflow = '';
  });
}

protected setMode(mode: 'link' | 'pdf'): void {
  this.mode.set(mode);
  this.error.set('');
}

protected pick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  this.file.set(file);
  if (file && !this.title().trim()) this.title.set(file.name.replace(/\.pdf$/i, '').slice(0, 120));
}

protected open(r: ResourceItem): void {
  this.lastFocus = document.activeElement as HTMLElement | null;
  this.opened.set(r);
  document.body.style.overflow = 'hidden';
}

protected close(): void {
  this.opened.set(null);
  document.body.style.overflow = '';
  this.lastFocus?.focus();
  this.lastFocus = null;
}

protected async upload(): Promise<void> {
  if (this.saving()) return;
  const file = this.file();
  this.error.set('');
  if (!file) { this.error.set('Choose a PDF file.'); return; }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { this.error.set('Choose a PDF file.'); return; }
  if (file.size > 25 * 1024 * 1024) { this.error.set('PDFs must be 25 MB or smaller.'); return; }
  this.saving.set(true);
  try {
    await this.api.uploadResourcePdf(this.lesson().id, file, this.title().trim() || undefined, this.note().trim() || undefined);
    this.title.set('');
    this.note.set('');
    this.file.set(null);
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
    await this.load();
  } catch (e) {
    this.error.set(e instanceof Error ? e.message : 'Could not upload that PDF.');
  } finally {
    this.saving.set(false);
  }
}
```

- [ ] **Step 6: Add the styles**

First scope the PDF lesson layout rules so the modal's viewer does not trigger them. In `src/styles.css`, make these exact replacements (keep every rule body unchanged; only the selector changes):

| Current selector | New selector |
| --- | --- |
| `.player-body:not(:has(app-pdf-viewer))` | `.player-body:not(:has(> app-pdf-viewer))` |
| `.player-body:not(:has(app-pdf-viewer))>:is(app-player,app-yt-player,app-lesson-panel)` | `.player-body:not(:has(> app-pdf-viewer))>:is(app-player,app-yt-player,app-lesson-panel)` |
| `.player-body:not(:has(app-pdf-viewer))>app-lesson-panel` | `.player-body:not(:has(> app-pdf-viewer))>app-lesson-panel` |
| `.player-body:not(:has(app-pdf-viewer))>.defer-fill` | `.player-body:not(:has(> app-pdf-viewer))>.defer-fill` |
| `.player-body:has(app-pdf-viewer)` (both occurrences) | `.player-body:has(> app-pdf-viewer)` |
| `.layout:has(app-pdf-viewer)` | `.layout:has(.player-body > app-pdf-viewer)` |

The resource modal's viewer is nested inside `app-lesson-panel`, so it no longer matches. Without this, opening the modal would collapse the video/panel layout behind it.

Then update the existing resource rules and append:

```css
.lr-form input:nth-of-type(3),.lr-form button.p{grid-column:1/-1}
.lr-mode{grid-column:1/-1;justify-self:start}
.lr-form input[type=file]{padding:.45rem .5rem;font-size:.82rem}
.lr-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
button.lr-open{padding:0;background:none;box-shadow:none;text-align:left;font:inherit;color:var(--acc);font-weight:650;border-radius:0;overflow-wrap:anywhere}
button.lr-open:hover:not(:disabled){background:none;box-shadow:none;text-decoration:underline}
.lr-viewer{position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;background:var(--bg)}
.lr-viewer-top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.55rem .8rem;border-bottom:1px solid var(--line);background:var(--panel)}
.lr-viewer-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
.lr-viewer-close{flex:none}
.lr-viewer>app-pdf-viewer{flex:1;min-height:0;height:auto}
.lr-viewer-loading{align-items:center;justify-content:center;gap:.6rem;color:var(--mute)}
```

The `.seg` styles already provide the switch look.

- [ ] **Step 7: Verify in the browser**

Run `npm run build`, then **restart** `npx wrangler dev --port 8787` (a running dev server keeps the old asset manifest) and open `http://localhost:8787`. Sign in as the owner and open a video lesson → Resources:

1. Switch to **PDF**, pick a real PDF, leave the title blank; confirm the auto-filled filename title and successful upload.
2. Click the row: the PDF opens in the full-window modal; paging/zoom/find work; no full-window button, download, print, or open-file button.
3. Draw a highlight, close the modal, reload the page, reopen: the highlight is still there.
4. Switch back to **Link** and add/remove a link; the old behaviour is unchanged.
5. Click Close, press Escape, and confirm both close the modal and focus returns to the row.

- [ ] **Step 8: Commit**

```bash
git add src/app/lesson-resources.ts src/styles.css
git commit -m "feat(resources): upload and open PDFs from a video lesson"
```

---

### Task 7: End-to-end verification, production smoke test, and handoff docs

**Files:**
- Modify: `docs/HANDOFF.md`
- Modify: `docs/CHANGELOG.md` if the file already has an unreleased section; otherwise leave it

**Interfaces:**
- Consumes: everything above.
- Produces: a shipped, verified feature and updated documentation.

- [ ] **Step 1: Run the static checks**

```bash
npm run typecheck
npm run build
npx wrangler deploy --dry-run --outdir /tmp/opencode/wrangler-dry
```
Expected: all succeed.

- [ ] **Step 2: Full local access matrix**

Restart `wrangler dev`, then verify in real browser sessions:

- Owner: upload to an HLS video lesson **and** a YouTube lesson; both appear in Resources; `/api/course` still lists only the original lessons.
- Enrolled student: opens both PDFs, adds a highlight, reloads, annotation persists; a link resource still opens in a new tab.
- Second enrolled student (or a second account added to the course): sees a blank document with no first student's annotations.
- Non-enrolled student: `/api/media/<resource key>` and `/api/notes/<resource key>` both return `403`.
- Delete one resource as owner: row, media URL, and its `pdf_notes` are gone.
- File manager: `_resources` is not listed anywhere; deleting the video lesson removes its resource PDF and notes.
- Negative checks: non-admin upload `403`; `.txt` renamed to `.pdf` `400`; 26 MB PDF `413`; 101st resource `400`; title over 120 `400`; note over 300 `400`.

- [ ] **Step 3: Deploy and smoke-test production**

```bash
npm run deploy
```

On `https://<your-site>.workers.dev`, sign in as owner, upload one PDF to a real video lesson, open it as an enrolled student, add a highlight, reload, confirm it persists, then remove the resource and confirm the file is gone. Record the deployed version id.

- [ ] **Step 4: Update the handoff docs**

Add to `docs/HANDOFF.md`:

- Resource PDFs live in `<Course>/_resources/` and are hidden from both the course listing and the file manager.
- `resources.kind`/`file_key`; uploads are capped at 25 MB and reuse `/api/media` + `/api/notes`.
- Deleting a resource/lesson/section/course cleans the object and annotations; course renames rewrite `file_key`.
- Known limits: no replacement/versioning, no PDF resources on PDF lessons, no direct-to-R2 resumable upload.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/HANDOFF.md docs/CHANGELOG.md
git commit -m "docs: record resource PDF uploads"
```

---

## Self-Review Notes

- Spec coverage: storage layout (Task 1/2), data model (Task 1), upload rules (Task 2), delete/rename cleanup (Tasks 3-4), admin form/student rows/viewer (Tasks 5-6), annotations (reused viewer + notes endpoint; verified in Tasks 2, 3, 6, 7), no tests/dependency changes (global constraints).
- Type consistency: `ResourceItem.kind`, `uploadResourcePdf(key, file, title?, note?)`, `PdfViewer.fullWindow`, and the media key in `url` are used identically in every task.
- Verification uses typecheck/build, `wrangler --dry-run`, D1 queries, curl, and real browser sessions instead of a new test framework, per the project constraint.

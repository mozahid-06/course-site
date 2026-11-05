# Defer the PDF viewer and admin panel — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the PDF viewer library and the admin panel out of the initial bundle into lazy chunks, without changing behaviour or first-open feel.

**Architecture:** Use Angular `@defer` blocks (standalone components, no router). The blocker is that `course.ts` statically imports `prefetchPdfAssets` from the same module as the viewer, which pins `ngx-extended-pdf-viewer` into the entry chunk; that import is replaced by an on-idle dynamic `import()` warm-up. The admin panel is deferred with no prefetch so students never fetch it.

**Tech Stack:** Angular 22.2 (`@defer`), TypeScript 6, `@angular/build` (esbuild). No test framework exists and none may be added; verification is `npm run typecheck`, `npm run build`, and build-output assertions.

**Spec:** `docs/superpowers/specs/2026-11-05-defer-pdf-viewer-and-admin-design.md`

## Global Constraints

- Free tier, zero cost. **No new dependencies.**
- **No test framework** exists and none may be added. Verify with `npm run typecheck`, `npm run build`, and the scratch build-output check.
- **No router.** Navigation stays signal-based.
- Components are standalone; use `@defer` only.
- `ChangeDetectionStrategy` stays `Eager` on existing components.
- No Worker / `Api` / endpoint changes.
- A real-browser click-through is not available in this environment; state that rather than claiming it.

## Review Focus

The failure modes the spec implies but the build assertions cannot catch — each has a step below.

1. **First PDF open before the idle warm-up finishes** — the `@placeholder`/`@loading` must show, then the viewer must mount; no blank pane. (Task 1)
2. **PDF reader tuning must still apply before the viewer initialises** — `pdf-viewer.ts` sets `pdfDefaultOptions.disableStream = false`, `disableAutoFetch = true`, `rangeChunkSize = 1MB` at module load. (Task 1)
3. **A non-admin must never fetch the admin chunk.** (Task 2)
4. **The admin panel still mounts after deferral**, including its Files → YouTube CSV dialog. (Task 3)
5. **Marking a lesson complete still updates both the player bar and the file list** (guard for the just-fixed snapshot bug while editing `course.ts`). (Task 1, Task 3)

---

### Task 1: Split the PDF viewer out of the initial bundle

**Files:**
- Modify: `src/app/course.ts` (import at line 5, defer block at ~lines 82–90, constructor idle warm-up at ~lines 121–123)
- Test: `/tmp/opencode/defer-check.mjs` (scratch, not committed)

**Interfaces:**
- Consumes: `prefetchPdfAssets(): void` exported from `src/app/pdf-viewer.ts` (unchanged); `PdfViewer` standalone component with `key = input.required<string>()` (unchanged).
- Produces: no new interface — `PdfViewer` moves to a lazy chunk.

- [ ] **Step 1: Write the build-output check**

Create `/tmp/opencode/defer-check.mjs`:

```js
import { readFileSync, readdirSync } from 'node:fs';
const dir = 'dist/web/browser';
const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
const entry = js.filter((f) => f.startsWith('main-'));
const lazy = js.filter((f) => !f.startsWith('main-'));
const read = (f) => readFileSync(`${dir}/${f}`, 'utf8');
const has = (files, needle) => files.some((f) => read(f).includes(needle));
const targets = [
  { id: 'pdf', name: 'PDF viewer (ngx-extended)', needle: 'ngx-extended' },
  { id: 'admin', name: 'admin CSV UI', needle: 'or import a CSV' },
].filter((t) => (process.argv[2] ?? 'all') === 'all' || t.id === process.argv[2]);
let ok = true;
for (const t of targets) {
  const inEntry = has(entry, t.needle);
  const inLazy = has(lazy, t.needle);
  console.log(`${t.name}: entry=${inEntry} lazy=${inLazy}`);
  if (inEntry) { console.log('  FAIL: still in the initial bundle'); ok = false; }
  else if (!inLazy) { console.log('  FAIL: not found in any lazy chunk'); ok = false; }
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/taxin/Work/course-site && node /tmp/opencode/defer-check.mjs pdf`
Expected: `FAIL` — `PDF viewer (ngx-extended): entry=true`.

- [ ] **Step 3: Break the static import and add the defer block**

In `src/app/course.ts`:

1. Line 5, drop `prefetchPdfAssets` from the import:
   `import { PdfViewer } from './pdf-viewer';`
2. Constructor idle warm-up (~lines 121–123) becomes a dynamic import so the module is a lazy chunk:
   `idle(() => { void import('./pdf-viewer').then((m) => m.prefetchPdfAssets()); });`
3. Wrap the viewer in a defer block inside the `l.kind === 'pdf'` branch:

```html
@if (l.kind === 'pdf') {
  @defer (on immediate) {
    <app-pdf-viewer [key]="l.id" />
  } @placeholder {
    <p class="empty">Loading viewer…</p>
  } @loading {
    <p class="empty">Loading viewer…</p>
  }
} @else if (l.kind === 'youtube') {
```

Keep `PdfViewer` in the component's `imports` — `@defer` resolves it from the lazy chunk.

- [ ] **Step 4: Confirm the reader tuning still runs at module load (Review Focus 2)**

Run: `grep -n "pdfDefaultOptions" src/app/pdf-viewer.ts`
Expected: the three assignments (`disableStream`, `disableAutoFetch`, `rangeChunkSize`) are still present and unchanged. They execute when the lazy module loads, before the component constructs.

- [ ] **Step 5: Build and re-run the check**

Run: `npm run build && node /tmp/opencode/defer-check.mjs pdf`
Expected: `PASS`. Also read the build output: the `ngx-extended-pdf-viewer` code must now be in a named lazy chunk (e.g. `chunk-*.js`), not in `main-*.js`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/course.ts
git commit -m "perf(course): load the PDF viewer as a lazy chunk"
```

---

### Task 2: Split the admin panel out of the initial bundle

**Files:**
- Modify: `src/app/app.ts` (template branch at line 131)
- Test: `/tmp/opencode/defer-check.mjs` (from Task 1)

**Interfaces:**
- Consumes: `Admin` standalone component (unchanged), imported in `app.ts` `imports: [Login, Course, Admin]`.
- Produces: no new interface — admin code moves to a lazy chunk.

- [ ] **Step 1: Run the check to verify it fails**

Run: `cd /home/taxin/Work/course-site && node /tmp/opencode/defer-check.mjs admin`
Expected: `FAIL` — `admin CSV UI: entry=true`.

- [ ] **Step 2: Defer the admin branch (no prefetch)**

In `src/app/app.ts`, replace line 131:

```html
@if (admin() && me.is_admin) {
  @defer (on immediate) { <app-admin /> }
} @else { <app-course /> }
```

No prefetch trigger: the block only renders for admins, and prefetching would fetch admin code for students. Keep `Admin` in `imports`.

- [ ] **Step 3: Build and re-run the check**

Run: `npm run build && node /tmp/opencode/defer-check.mjs admin`
Expected: `PASS`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/app.ts
git commit -m "perf(admin): load the admin panel as a lazy chunk"
```

---

### Task 3: Verify both splits, document, and push

**Files:**
- Modify: `docs/HANDOFF.md` (decision log §2, "added later" section)
- Modify: `docs/CHANGELOG.md` (Unreleased)
- Add (already written): `docs/superpowers/specs/2026-11-05-defer-pdf-viewer-and-admin-design.md`, `docs/superpowers/plans/2026-11-05-defer-pdf-viewer-and-admin.md`

**Interfaces:**
- Consumes: both Task 1 and Task 2 changes.
- Produces: nothing code-facing.

- [ ] **Step 1: Confirm both splits at once**

Run: `node /tmp/opencode/defer-check.mjs all`
Expected: `PASS` for both.

- [ ] **Step 2: Record the size change**

Run: `npm run build` and copy the `Initial total` line.
Expected: initial transfer **below the 214.98 kB baseline** (PDF library + admin code removed); the two new lazy chunks appear in the `Lazy chunk files` table. Record the before/after numbers in the commit message and in `docs/HANDOFF.md`.

- [ ] **Step 3: Local smoke (API boots; no browser click-through available)**

Run: `nohup npx wrangler dev --port 8787 >/tmp/opencode/wrangler-defer.log 2>&1 &` then `curl -s localhost:8787/api/me`.
Expected: a JSON response (not a 500), proving the Worker still boots. Note in the summary that the admin panel and PDF open could not be clicked through here (Review Focus 4, 5) — as in previous passes.

- [ ] **Step 4: Document**

- `docs/CHANGELOG.md`, under `## Unreleased` → new `### Changed (lazy loading)` entry: PDF viewer and admin panel are now lazy chunks via `@defer`; the PDF viewer's on-idle warm-up is a dynamic import; initial bundle drops from ~215 kB to the new figure.
- `docs/HANDOFF.md`: add a decision-log row ("Lazy-load the PDF viewer and admin panel | The app shipped one initial bundle; `@defer` splits the two heavy conditional chunks. The PDF viewer's static `prefetchPdfAssets` import had to be replaced by a dynamic import or nothing would split."), and a line in the "added later" area noting the file-map change (PDF viewer/admin code is lazy).

- [ ] **Step 5: Commit the docs and push**

```bash
git add docs/HANDOFF.md docs/CHANGELOG.md docs/superpowers/specs/2026-11-05-defer-pdf-viewer-and-admin-design.md docs/superpowers/plans/2026-11-05-defer-pdf-viewer-and-admin.md
git commit -m "docs: record the deferred PDF viewer and admin panel"
git push origin main
```

Expected: `origin/main` matches local `HEAD`.

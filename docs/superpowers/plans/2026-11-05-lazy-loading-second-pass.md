# Lazy loading, second pass — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer the lesson area, login and the course shell, and fold in the first pass's five review minors, so the initial bundle is shell + framework only.

**Architecture:** More `@defer (on immediate)` blocks (standalone components, no router) with layout-matched placeholders, `@error` fallbacks and `aria-live`. The PDF viewer stays its own block so opening a video never downloads the PDF library; the rest of the lesson content is one block so `player`/`yt-player`/`lesson-panel`/`discussion`/`lesson-resources` land in a single `lesson` chunk.

**Tech Stack:** Angular 22.2 (`@defer`), TypeScript 6, `@angular/build` (esbuild). No test framework exists and none may be added; verification is `npm run typecheck`, `npm run build`, and build-output assertions.

**Spec:** `docs/superpowers/specs/2026-11-05-lazy-loading-second-pass-design.md` (first pass: `docs/superpowers/specs/2026-11-05-defer-pdf-viewer-and-admin-design.md`)

## Global Constraints

- Free tier, zero cost. **No new dependencies.**
- **No test framework** exists and none may be added.
- **No router.** Navigation stays signal-based.
- Standalone components; `@defer` only. `ChangeDetectionStrategy` stays `Eager`.
- No Worker / `Api` / endpoint changes.
- A real-browser click-through is not available; state that rather than claiming it.

## Review Focus

1. **Cold lesson open** — the lesson placeholder must show, then content mount; no blank pane. (Task 1)
2. **Signed-in main path** — the course shell now loads via a chunk; the placeholder must appear immediately, not a blank frame. (Task 2)
3. **Login path** — the form appears after its chunk, and `ngAfterViewInit` (Google sign-in init) still runs on the lazily mounted component. (Task 2)
4. **Chunk-load failure** — `@error` shows a message, never an infinite "Loading…" or blank pane. (Task 1, Task 2)
5. **Non-admin isolation** — a student browsing courses fetches neither the admin chunk nor the lesson/PDF chunks. (Task 1, Task 2)
6. **Regression: marking a lesson complete** still updates the player bar and the file list while `course.ts` is edited. (Task 1)

---

### Task 1: Defer the lesson area; harden the PDF viewer block

**Files:**
- Modify: `src/app/course.ts` (`.player-body` block ~lines 81–92)
- Modify: `src/styles.css` (add `.defer-fill` near `.empty`, line 57)
- Test: `/tmp/opencode/defer-check.mjs` (scratch, not committed)

**Interfaces:**
- Consumes: `PdfViewer` (`key` input), `Player` (`key` input, `ended` output), `YtPlayer` (`yt` input), `LessonPanel` (`lesson` input) — all unchanged.
- Produces: the CSS class `.defer-fill` (used again in Task 2).

- [ ] **Step 1: Extend the build-output check**

Replace `/tmp/opencode/defer-check.mjs`:

```js
import { readFileSync, readdirSync } from 'node:fs';
const dir = 'dist/web/browser';
const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
const entry = js.filter((f) => f.startsWith('main-'));
const lazy = js.filter((f) => !f.startsWith('main-'));
const read = (f) => readFileSync(`${dir}/${f}`, 'utf8');
const has = (files, needle) => files.some((f) => read(f).includes(needle));
const targets = [
  { id: 'pdf', name: 'PDF viewer', needles: ['ngx-extended'] },
  { id: 'admin', name: 'admin panel', needles: ['or import a CSV'] },
  { id: 'lesson', name: 'lesson area', needles: ['lp-lock-long', 'dc-compose', 'youtube.com/embed'] },
  { id: 'login', name: 'login', needles: ['Could not load Google sign-in'] },
  { id: 'course', name: 'course shell', needles: ['This folder is empty'] },
].filter((t) => (process.argv[2] ?? 'all') === 'all' || t.id === process.argv[2]);
let ok = true;
for (const t of targets) {
  for (const needle of t.needles) {
    const inEntry = has(entry, needle);
    const inLazy = has(lazy, needle);
    console.log(`${t.name} [${needle}]: entry=${inEntry} lazy=${inLazy}`);
    if (inEntry) { console.log('  FAIL: still in the initial bundle'); ok = false; }
    else if (!inLazy) { console.log('  FAIL: not found in any lazy chunk'); ok = false; }
  }
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/taxin/Work/course-site && npm run build && node /tmp/opencode/defer-check.mjs lesson`
Expected: `FAIL` — `lesson area [lp-lock-long]: entry=true`.

- [ ] **Step 3: Add the `.defer-fill` style**

In `src/styles.css`, after `.empty{...}` (line 57):

```css
.defer-fill{flex:1;display:flex;align-items:center;justify-content:center;min-height:40vh;padding:1.5rem;color:var(--mute);text-align:center}
```

- [ ] **Step 4: Restructure `.player-body`**

In `src/app/course.ts`, replace the `@if (l.kind === 'pdf') { ... } @else if ... @else { ... }` region inside `<div class="player-body">` with: PDF keeps its own block; everything else is one block.

```html
<div class="player-body">
  @if (l.kind === 'pdf') {
    @defer (on immediate) {
      <app-pdf-viewer [key]="l.id" />
    } @placeholder {
      <div class="defer-fill" aria-live="polite">Loading viewer…</div>
    } @loading {
      <div class="defer-fill" aria-live="polite">Loading viewer…</div>
    } @error {
      <div class="defer-fill" role="alert">Could not load the viewer. Check your connection and try again.</div>
    }
  } @else {
    @defer (on immediate) {
      @if (l.kind === 'youtube') {
        <app-yt-player [yt]="l.yt || ''" />
      } @else {
        <app-player [key]="l.id" (ended)="finish(l)" />
      }
      <app-lesson-panel [lesson]="l" />
    } @placeholder {
      <div class="defer-fill" aria-live="polite">Loading lesson…</div>
    } @loading {
      <div class="defer-fill" aria-live="polite">Loading lesson…</div>
    } @error {
      <div class="defer-fill" role="alert">Could not load the lesson. Check your connection and try again.</div>
    }
  }
</div>
```

Keep `Player`, `YtPlayer`, `PdfViewer`, `LessonPanel` in the component `imports`.

- [ ] **Step 5: Build and re-run the check**

Run: `npm run build && node /tmp/opencode/defer-check.mjs lesson`
Expected: `PASS`, and the build output shows a `lesson` lazy chunk; `youtube.com/embed` is no longer in `main-*.js`.

- [ ] **Step 6: Regression — the PDF and admin splits still hold (Review Focus 6)**

Run: `node /tmp/opencode/defer-check.mjs pdf && node /tmp/opencode/defer-check.mjs admin`
Expected: `PASS` for both. `git diff` shows no change to `activeCourse`/`lesson` computed logic.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/course.ts src/styles.css
git commit -m "perf(course): defer the lesson area and harden the defer blocks"
```

---

### Task 2: Defer login and the course shell; harden the admin block

**Files:**
- Modify: `src/app/app.ts` (template branches at ~lines 131–134)
- Test: `/tmp/opencode/defer-check.mjs`

**Interfaces:**
- Consumes: `Login`, `Course`, `Admin` standalone components (unchanged); `.defer-fill` from Task 1.
- Produces: no new interface — each becomes a lazy chunk.

- [ ] **Step 1: Run the check to verify it fails**

Run: `cd /home/taxin/Work/course-site && node /tmp/opencode/defer-check.mjs login && node /tmp/opencode/defer-check.mjs course`
Expected: `FAIL` for both (`entry=true`).

- [ ] **Step 2: Defer the three views**

In `src/app/app.ts`, replace the view branches (currently `@if (admin() && me.is_admin) { @defer (on immediate) { <app-admin /> } } @else { <app-course /> }` and `} @else if (api.me() === null) { <app-login /> }`):

```html
@if (admin() && me.is_admin) {
  @defer (on immediate) {
    <app-admin />
  } @placeholder {
    <div class="defer-fill" aria-live="polite">Loading admin panel…</div>
  } @error {
    <div class="defer-fill" role="alert">Could not load the admin panel. Check your connection and try again.</div>
  }
} @else {
  @defer (on immediate) {
    <app-course />
  } @placeholder {
    <div class="defer-fill" aria-live="polite">Loading your courses…</div>
  } @error {
    <div class="defer-fill" role="alert">Could not load your courses. Check your connection and try again.</div>
  }
}
```

and for the signed-out branch:

```html
} @else if (api.me() === null) {
  @defer (on immediate) {
    <app-login />
  } @placeholder {
    <div class="defer-fill" aria-live="polite">Loading…</div>
  } @error {
    <div class="defer-fill" role="alert">Could not load the sign-in form. Check your connection and try again.</div>
  }
}
```

Keep `Login`, `Course`, `Admin` in `imports`. No prefetch on any of them.

- [ ] **Step 3: Build and re-run the check**

Run: `npm run build && node /tmp/opencode/defer-check.mjs login && node /tmp/opencode/defer-check.mjs course`
Expected: `PASS` for both; the build shows separate lazy chunks. `api.init()` still runs — it is called in `App`'s constructor, which is unchanged.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/app.ts
git commit -m "perf(app): defer login and the course shell"
```

---

### Task 3: Verify everything, document, push

**Files:**
- Modify: `docs/CHANGELOG.md` (Unreleased)
- Modify: `docs/HANDOFF.md` (decision log, §4e, file map)
- Modify: `docs/superpowers/specs/2026-11-05-defer-pdf-viewer-and-admin-design.md` (`Status:` → `implemented`)
- Modify: `docs/superpowers/specs/2026-11-05-lazy-loading-second-pass-design.md` (`Status:` → `implemented`)
- Add: `docs/superpowers/plans/2026-11-05-lazy-loading-second-pass.md`

- [ ] **Step 1: Full check**

Run: `node /tmp/opencode/defer-check.mjs all`
Expected: `PASS` for pdf, admin, lesson, login, course.

- [ ] **Step 2: Record the size change**

Run: `npm run build` and copy the `Initial total` line.
Expected: below the 79.97 kB of the first pass; list the lazy chunks. Record before/after in the commit message and `docs/HANDOFF.md`.

- [ ] **Step 3: Worker boot smoke**

Create a throwaway git-ignored `.dev.vars` (`SESSION_SECRET`, `ADMIN_EMAIL=admin@example.com`, `ADMIN_PASSWORD=longpassword1`), start `npx wrangler dev --port 8787`, `curl -s localhost:8787/api/me` (expect `401`, not `500`), then kill it and delete `.dev.vars`. Note that a browser click-through is still unavailable (Review Focus 1–5).

- [ ] **Step 4: Document**

- `docs/CHANGELOG.md`: extend the `### Changed (lazy loading)` entry — the lesson area, login and the course shell are lazy chunks too; placeholders are layout-matched and each block has an `@error` fallback.
- `docs/HANDOFF.md`: extend the §4e bullet and the decision-log row with the second pass; note the file-map change.
- Set both design docs' `Status:` to `implemented`.

- [ ] **Step 5: Commit the docs and push**

```bash
git add docs/
git commit -m "docs: record the second lazy-loading pass"
git push origin main
```

Expected: `origin/main` matches local `HEAD`.

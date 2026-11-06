# Lesson Completion Status Circles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the course file browser, replace the lone "completed" tick with a two-state status circle — a filled green circle with a cut-out check when the lesson is done, an empty circle when it is not.

**Architecture:** A one-line pure helper decides the state (folder → none, lesson → empty/done); a template + CSS change draws it. Each non-folder row renders one inline `<svg>`; the check is cut from the filled circle with a single shared `<mask>`, so the check is genuinely transparent (the row background shows through) in both themes and on hover. Colour comes from the existing `--success` token.

**Tech Stack:** Angular 22 standalone component (new `@if` control flow), plain CSS in `src/styles.css`, `node --test` for the pure helper.

**Spec:** `docs/superpowers/specs/2026-11-06-lesson-completion-status-circles-design.md`

## Global Constraints

- Colour from the `--success` token only; no hard-coded colours in the rules.
- No image assets; one inline SVG per row.
- Folders never show a mark; the player "Mark as complete" button is unchanged.
- The mark is 20px, inside the existing 40px row.
- No change to how `done` is stored, fetched, or toggled.

## Review Focus

- **A folder row must show no status mark at all** (today it also shows none; the new code must not add one).
- **A not-done lesson row must show an empty circle** — a real, visible element, not nothing.
- **The cut-out check must stay transparent when the row is hovered** (the row background changes to `--hover`).
- **Both themes must be legible** (light `--success` `#15803D`, dark `#4ADE80`).
- **A long lesson name must still ellipsize**, with the mark staying visible at the right edge (no wrap, no overflow).

---

### Task 1: Two-state status mark in the file browser

**Files:**
- Create: `src/app/lesson-status.ts`
- Create: `src/app/lesson-status.test.mjs`
- Modify: `src/app/course.ts` (import; the `Row` type and row construction in `browserItems()` at lines ~228-281; the file-browser block at lines ~44-68)
- Modify: `src/styles.css` (the `.fb-done` rules at lines ~188-189)
- Modify: `package.json` (the `test` script)

**Interfaces:**
- Consumes: `browserItems()` rows of shape `{ id; path; name; kind: 'video'|'pdf'|'youtube'|'folder'; done: boolean }` (`course.ts:236`).
- Produces:
  - `src/app/lesson-status.ts` — `export type StatusMark = 'none' | 'empty' | 'done'` and `export function statusMark(kind: string, done: boolean): StatusMark`.
  - Each `browserItems()` row gains a `mark: StatusMark` field.
  - Each non-folder row renders `<span class="fb-done" [class.is-done]="item.mark === 'done'">` containing one `<svg>` with either a `.disc` circle (done) or a `.ring` circle (not done).

- [ ] **Step 1: Write the failing test**

Create `src/app/lesson-status.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { statusMark } from './lesson-status.ts';

test('a folder never gets a completion mark', () => {
  assert.equal(statusMark('folder', false), 'none');
  assert.equal(statusMark('folder', true), 'none');
});

test('a lesson is empty when not done and done when done', () => {
  assert.equal(statusMark('video', false), 'empty');
  assert.equal(statusMark('pdf', false), 'empty');
  assert.equal(statusMark('youtube', false), 'empty');
  assert.equal(statusMark('video', true), 'done');
  assert.equal(statusMark('pdf', true), 'done');
  assert.equal(statusMark('youtube', true), 'done');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test src/app/lesson-status.test.mjs`
Expected: FAIL — `Cannot find module './lesson-status.ts'` (or "does not provide an export named 'statusMark'").

- [ ] **Step 3: Create the helper**

Create `src/app/lesson-status.ts`:

```ts
/** A file-browser row's completion mark. Folders are containers, never completable. */
export type StatusMark = 'none' | 'empty' | 'done';

export function statusMark(kind: string, done: boolean): StatusMark {
  if (kind === 'folder') return 'none';
  return done ? 'done' : 'empty';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test src/app/lesson-status.test.mjs`
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire the mark into the row data**

In `src/app/course.ts`:

1. Add the import at the top with the other relative imports:
   `import { statusMark, type StatusMark } from './lesson-status';`
2. In `browserItems()`, extend the local `Row` type (line 236) to include `mark: StatusMark`.
3. Where a lesson row is set (line 253), set `mark: statusMark(l.kind, l.done)`.
4. Where a folder row is set (line 259), set `mark: 'none'`.
   (`index` is still added in the final `.map()`; nothing else changes.)

- [ ] **Step 6: Draw the mark in the template**

In the file-browser block of `src/app/course.ts`, add one shared mask just inside `<div class="browser">` (before the `@for`):

```html
<svg class="fb-defs" aria-hidden="true">
  <defs>
    <mask id="fb-check-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect width="24" height="24" fill="#fff" />
      <path d="m7 12.6 3.2 3.2L17 8" fill="none" stroke="#000" stroke-width="2.4"
        stroke-linecap="round" stroke-linejoin="round" />
    </mask>
  </defs>
</svg>
```

Then replace the existing completed-only mark (lines 61-63):

```html
@if (item.kind !== 'folder' && item.done) {
  <span class="fb-done" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg></span>
}
```

with a mark for **every** non-folder row:

```html
@if (item.mark !== 'none') {
  <span class="fb-done" [class.is-done]="item.mark === 'done'" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      @if (item.mark === 'done') {
        <circle class="disc" cx="12" cy="12" r="10" mask="url(#fb-check-cut)" />
      } @else {
        <circle class="ring" cx="12" cy="12" r="10" />
      }
    </svg>
  </span>
}
```

- [ ] **Step 7: Style the two states**

In `src/styles.css`, replace the two `.fb-done` rules (lines 188-189) with:

```css
.fb-defs{position:absolute;width:0;height:0;overflow:hidden}
.fb-done{flex:none;display:grid;place-items:center;color:var(--border)}
.fb-done.is-done{color:var(--success)}
.fb-done svg{width:20px;height:20px;display:block}
.fb-done .ring{fill:none;stroke:currentColor;stroke-width:1.8}
.fb-done .disc{fill:currentColor}
```

- [ ] **Step 8: Run the automated checks**

Run: `npm run typecheck && npm run build`
Expected: both succeed; `dist/web` is produced with no template errors.

- [ ] **Step 9: Update the test script**

In `package.json`, change the `test` script to also discover the new test (uses `--experimental-strip-types` so the `.ts` helper can be imported on the older Node floor in `engines`):

```json
"test": "node --experimental-strip-types --test worker/*.test.mjs src/app/*.test.mjs"
```

Run: `npm test`
Expected: PASS — the 2 existing Worker tests plus the 2 new helper tests.

- [ ] **Step 10: Visual check (acceptance)**

Serve the app (`npm start`) and, signed in as a student with at least one done and one not-done lesson, open a course. Confirm against the Review Focus list:
- a done lesson row shows a **solid green circle with the check cut out**;
- a not-done lesson row shows an **empty circle**;
- folder rows show **no** mark;
- the check stays correctly transparent while hovering the row;
- both light and dark themes are legible;
- a long lesson name still ellipsizes with the mark visible.

Capture a screenshot so the human partner can accept the look.

- [ ] **Step 11: Commit**

```bash
git add src/app/lesson-status.ts src/app/lesson-status.test.mjs src/app/course.ts src/styles.css package.json
git commit -m "feat(course): two-state lesson completion status circle"
```

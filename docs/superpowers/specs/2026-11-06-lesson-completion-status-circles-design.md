# Lesson completion status circles — design

**Date:** 2026-11-06
**Status:** Approved (short design; small change)

## Intent
The course file browser marks a completed lesson with a small green checkmark and
shows nothing at all for a lesson that is not complete. There is no per-row cue
for "not done", and the lone tick reads as a weaker signal than the work it
represents. Replace it with a clear two-state status mark so a glance down the
list shows what is finished and what is left.

## What the user asked for
- Completed lesson: a **filled green circle with the check cut out of it** (the
  check is transparent — the row background shows through).
- Not-completed lesson: an **empty circle** (a thin outline).
- The mark must be **clearly visible** (size matters).

## Goals
- Every lesson row carries the same status mark: green filled circle (done) or
  empty circle (not done).
- Both states look right in light and dark themes.
- The mark is comfortably visible in the row.
- No behaviour change beyond how the mark is drawn (same `done` flag, same
  toggling).

## Non-goals
- The player bar's "Mark as complete" button is unchanged (it keeps its tick
  and its "Completed / Mark as complete" label).
- Folders get no status mark (they are not completable).
- No change to how `done` is stored, fetched, or toggled.

## Constraints
- Use the existing `--success` colour token so the mark follows the theme.
- The browser renders inside whatever content background the page uses; the
  check must be a true knockout rather than a hard-coded background colour, so
  it stays correct on hover (`--hover`) and in both themes.
- No image assets — one inline SVG per row.

## Approaches
1. **Inline SVG, circle + masked check (chosen).** One `<svg>` per lesson row: a
   filled `<circle>` plus the same check path, with an SVG `<mask>` cutting the
   check out of the circle. True transparency, theme-agnostic, crisp at any
   size. Slightly more markup per row.
2. **CSS pseudo-element circle with a background-coloured check.** A round
   `span` plus the existing tick; the tick stroked in the row's background
   colour. Less markup, but "transparent" is faked with a guessed background
   colour, so it drifts on hover and needs per-theme maintenance. Rejected.
3. **A single SVG that draws either state.** One path switched by class. Fewer
   DOM nodes but harder to read and adjust; the two states differ enough that a
   branch in the template is clearer. Rejected.

## Design
- In `src/app/course.ts`, the file-browser row currently renders
  `@if (item.kind !== 'folder' && item.done) { <span class="fb-done">…tick…</span> }`.
  Change it to render the status mark for **every non-folder row**, with the
  mark bound to `item.done`.
  - **Done** — `class="fb-done is-done"`: green (`currentColor` =
    `var(--success)`) circle filled, check knocked out via `<mask>`.
  - **Not done** — `class="fb-done"`: an outlined circle, stroke in the muted
    grey (`--border`), no fill and no check.
- The mark is sized at **20px** (the type icon is 16px), vertically centred in
  the 40px row.
- Keep `aria-hidden="true"` on the mark; the row already carries the lesson
  name, and completion is announced by the player button. (If we later want the
  list to announce status, that is a separate change.)

## What's left to the builder
- Exact mask geometry can be tuned for crispness at 20px.
- Whether the empty circle's grey should be `--border` or a touch darker
  (`--muted`); start with `--border` and adjust if it reads too faint.

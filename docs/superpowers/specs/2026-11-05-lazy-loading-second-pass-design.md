# Lazy loading, second pass — design

Date: 2026-11-05
Status: implemented

## Intent (why)

The first pass split the PDF viewer and the admin panel out of the initial
bundle (initial JS transfer 214.98 kB → 79.97 kB). The owner wants the same
`@defer` treatment across the rest of the site, and the first pass's review left
five minor items to fold in.

## Goals

- Split the remaining conditional UI out of the initial bundle: the **lesson
  area** (`player`, `yt-player`, `lesson-panel`, `discussion`,
  `lesson-resources`), `login`, and the `course` shell.
- Fold in the first pass's review minors:
  1. Height-preserving placeholder/loading for the PDF viewer (the spec asked
     for it; a thin `<p>` causes a small layout shift on a cold open).
  2. `@error` blocks so a failed chunk fetch does not leave "Loading…" forever
     or a blank pane.
  3. A `@placeholder` for the admin defer (brief blank on first toggle).
  4. `aria-live="polite"` on the loading text.
  5. Mark the first design doc `implemented`.

## Non-goals

- No router (deep-linkable URLs remain a separate feature).
- No Worker / `Api` / endpoint change. No new dependencies.
- No styling redesign.

## Anti-goals (do not break)

- The main signed-in view must still feel immediate: an immediate trigger plus a
  layout-matched placeholder, not a blank frame.
- The PDF reader tuning (`pdf-viewer.ts` module-level `pdfDefaultOptions`) and
  the on-idle warm-up must keep working.
- A non-admin must still never fetch the admin chunk.
- No new cost.

## Approaches

- **(a) Minors only.** No further splitting; the rest is mostly framework.
- **(b) Minors + lesson area.** Split only what needs a lesson open.
- **(c) Minors + everything.** ⭐ Chosen. Also defer `login` and the `course`
  shell. The owner accepted that the main view renders after a chunk fetch.

## The how (decided)

- `course.ts`: one `@defer (on immediate)` around the lesson content inside
  `.player-body` (`app-player` / `app-yt-player` / `app-lesson-panel`), with a
  height-preserving `@placeholder`/`@loading` and an `@error`. `PdfViewer` keeps
  its own defer block (already written) with the same placeholder/error
  treatment.
- `app.ts`: `@defer (on immediate)` for `<app-login>` and `<app-course>`, each
  with a placeholder and `@error`; add a placeholder and `@error` to the existing
  `<app-admin>` defer. No prefetch on admin.
- **Height-preserving** placeholders: reuse the existing sizing so `.player-body`
  and the cards area do not change height when the real content mounts.
- `aria-live="polite"` on the loading/placeholder text.
- Update `docs/superpowers/specs/2026-11-05-defer-pdf-viewer-and-admin-design.md`
  `Status:` to `implemented`.

## Left to the builder

- Exact marker strings for the build-output check (strings unique to
  `lesson-panel`, `discussion`, `login` and `course`).
- Whether the lesson-area defer is one block around `.player-body` content or one
  per branch (must end up as a single `lesson` lazy chunk).
- Placeholder copy.

## Verification plan

- Extend the scratch build-output check: the lesson-area / login / course markers
  must be absent from `main-*.js` and present in lazy chunks; the PDF and admin
  assertions must still pass.
- `npm run typecheck`, `npm run build`; record initial transfer before/after.
- Worker boot smoke as before. A real-browser click-through is still not
  available; state that rather than claiming it.

# Defer the PDF viewer and admin panel — design

Date: 2026-11-05
Status: implemented

## Intent (why)

The site ships **everything in one initial bundle**. A student watching a single
YouTube lesson still downloads the whole PDF engine, and every user downloads
the admin panel, even though both are conditional. Angular's `@defer` exists for
exactly this ("don't load the whole site, load parts"), and — apart from `hls.js`
which is already dynamically imported — it is unused here.

Baseline (current `npm run build`):

- Initial total **1.38 MB raw / 214.98 kB transfer**
- `main-*.js` **1.33 MB raw** — contains `ngx-extended-pdf-viewer`, the admin
  panel, and everything else
- `chunk-*.js` (`hls`) 590 kB raw / 152 kB transfer — already lazy

## Goals

- Split the two heavy **conditional** chunks out of the initial bundle: the PDF
  viewer (`ngx-extended-pdf-viewer`) and the admin panel
  (`admin`, `admin-files`, `upload`, `youtube-csv`).
- No behaviour change and no new cost; stay on the free tier.
- Keep the first PDF open fast — preserve the current on-idle warm-up.

## Non-goals

- **No router.** Navigation stays signal-based (`admin()` in `app.ts`, `view()`
  in `course.ts`). Deep-linkable URLs are a separate feature with its own value.
- No login/course/player deferral (approach c) — diminishing returns.
- No UI-framework or styling change.

## Anti-goals (do not break)

- The PDF library must not be in the initial bundle or block first paint. An
  idle background warm-up, as today, is fine — the goal is to stop it riding in
  the initial download, not to stop warming it.
- A student (non-admin) must never fetch the admin chunk at all.
- First PDF open must not regress (no spinner where there wasn't one).
- `prefetchPdfAssets()` and the global `pdfDefaultOptions` tuning must still run
  before the viewer initialises.

## The trap that shapes this design

`course.ts` currently does
`import { PdfViewer, prefetchPdfAssets } from './pdf-viewer'` and calls
`prefetchPdfAssets()` on idle. `prefetchPdfAssets` lives **in the same module**
as the viewer, which imports `ngx-extended-pdf-viewer`. That static import pins
the whole library into the initial bundle — so a naive `@defer` on
`<app-pdf-viewer>` would change **nothing**. The static import has to go.

## Approaches

- **(a) PDF viewer only.** Smallest change, largest single win.
- **(b) PDF viewer + admin panel.** ⭐ Chosen. Captures the two genuinely heavy,
  genuinely conditional chunks without fragmenting the whole app.
- **(c) Everything conditional** (login, course, player, PDF, admin). Maximum
  splitting; more `@defer` boundaries and loading states for little extra gain.

## The how (decided)

### PDF viewer (`course.ts`)

- Wrap `<app-pdf-viewer [key]="l.id" />` in a `@defer` block so the library is a
  lazy chunk.
- **Remove** the static `prefetchPdfAssets` import. Replace the constructor's
  `idle(() => prefetchPdfAssets())` with an on-idle **dynamic**
  `import('./pdf-viewer')` warm-up, so the chunk is fetched in the background and
  the global `pdfDefaultOptions` still apply before the first open — same intent,
  but split.
- Give the block a minimal `@placeholder`/`@loading` (reuse existing styles) so
  there is no layout jump.

### Admin panel (`app.ts`)

- Wrap `<app-admin />` in `@defer`. Because the block only renders for admins
  (`@if (admin() && me.is_admin)`), use an immediate trigger on render and **no
  prefetch** — so non-admins never download admin code.
- `Admin` stays in `imports`; it is used only inside the defer block.

### Prefetch policy (my call)

- PDF viewer: warm on idle (dynamic import) — matches today's behaviour, keeps
  first open feel.
- Admin: no prefetch — the point is students never fetch it.

## Left to the builder

- Exact `@placeholder`/`@loading` markup (height-preserving), and whether admin
  uses `on immediate` vs `on interaction`.
- Whether `prefetch on idle` on the PDF block replaces the dynamic-import warm-up
  (it cannot, while the block sits inside the player `@if` — note this and keep
  the dynamic import).

## Verification plan

- Record initial raw/transfer before and after; confirm the PDF library and admin
  code move into named lazy chunks (inspect the `ng build` output and grep the
  chunks for `ngx-extended` and `yt-import`).
- Confirm `main` no longer contains `ngx-extended` / admin import strings.
- `npm run typecheck`, `npm run build`.
- Local `wrangler dev` smoke: open a PDF lesson and the admin panel; confirm both
  still work and only then fetch their chunks.
- Note: a real-browser click-through is not available here (as with previous
  passes); state that explicitly rather than claiming it.

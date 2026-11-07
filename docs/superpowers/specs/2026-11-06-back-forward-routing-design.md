# Back/forward navigation with the Angular Router — design

**Date:** 2026-11-06
**Status:** Implemented on `dev` (awaiting test-account review). **Update (2026-11-07):** the on-screen Back/Forward pair described below was replaced by a single **Back** button (`app-back-button`, formerly `app-nav-buttons`). The URL-per-screen history, deep links and native back/forward this spec is really about are unchanged; only the visible Forward control was dropped.

## Intent
The course screens are one in-memory stack (`course list → folder(s) → lesson`)
with no URL and no forward button. The address bar never changes, so the
browser's and the phone's own Back leave the site instead of stepping back one
screen. Give the app real history: a URL per screen, working native
back/forward, and an on-screen Back/Forward pair on desktop and phone.

## What the user asked for
- A Back and a Forward control on **both PC and phone**.
- The **browser's/phone's own** back-forward must move through the app too.
- "Fully use Angular" — do it the idiomatic Angular way.

## Goals
- Every course screen has a shareable URL; refresh and deep links work.
- Native back/forward and the phone back gesture move through the app.
- One on-screen Back/Forward pair in the lesson bar, sized for desktop and
  phone. (It was removed from the top header — the browser/phone already has
  its own controls there.)
- The admin panel gains a URL too (so Back leaves it), and its "Course files"
  sub-view is a URL instead of a `#files` hash.
- No visual or data-layer rewrite; login stays exactly as it is.

## Non-goals
- Back/Forward do **not** mean previous/next lesson. They only move through
  history.
- Login/auth is **not** routed (the root still gates on `api.me()`); no guards on
  the course screens.
- The player's "Mark as complete" button is unchanged.
- Admin does not get its own on-screen pair (it keeps the browser's buttons and
  its "Back to course" menu item).

## Constraints
- Angular 22; `@angular/router` was not installed, so it is a new dependency.
- The app is served by a Cloudflare Worker with a static-assets binding and
  `run_worker_first = ["/api/*"]`. Deep paths must reach the app, so the assets
  need an SPA fallback.
- The course component holds live state in `Api` signals; recreating it on every
  folder step would be wasteful, so all course URLs should stay on one route.

## Approaches
1. **Angular Router + clean path URLs (chosen).** Real routes, deep links,
   refresh, and `Location.back()/forward()` for the buttons.
2. **Angular Router + hash URLs.** Same router, no server change, but uglier and
   the admin `#files` hash would move anyway. Rejected.
3. **Angular `Location` only (no router).** Keep the signal view and mirror it
   to the URL by hand. Smallest, but we own parsing/serialising and lose route
   guards and lazy `loadComponent`. Rejected once the user asked for "full
   Angular".

## URL grammar
| URL | Screen |
| --- | --- |
| `/` | course list |
| `/course/<course>` | folder browser at the course root |
| `/course/<course>/folder/<a>/<b>` | folder browser inside the course |
| `/course/<course>/lesson/<a>/<b>` | lesson player (`<a>/<b>` is the lesson id without its leading course) |
| `/admin` | admin panel, Users |
| `/admin?tab=files` | admin panel, Course files |
| anything else | redirect to `/` |

The grammar lives in `src/app/course-route.ts`, free of Angular, so it has its
own unit tests (`course-route.test.mjs`).

## Design
- **Routes** (`app.routes.ts`):
  - `''` (full) → `Course`, and a **custom `UrlMatcher`** for `/course/...`.
    Angular cannot put `**` behind a prefix, and one matcher route keeps the
    `Course` instance alive as the student walks the folder tree. The matcher
    consumes every segment and hands back `course` + a single `tail` param
    (`folder/a/b` or `lesson/a/b`).
  - `/admin` → `Admin`, guarded by `canMatch` which awaits `Api.ready` (the
    first session check) and requires `me.is_admin`; a non-admin falls through
    to the catch-all.
  - `**` → redirect to `/`.
  - Course and admin load with **`loadComponent`**, preserving the old `@defer`
    code-splitting (`course`, `admin`, `admin-files`, `player` are lazy chunks).
- **`Api`** gains a `ready` promise (resolved after the first `init()`), so the
  admin guard never redirects while `me` is still `undefined`.
- **`App`** keeps the `@if (api.me())` gate and the header, and renders
  `<router-outlet>` where the admin/course toggle used to be. Login is
  untouched.
- **`Shell`** derives `admin`, `lessonOpen` and `headerVisible` from the router
  URL (via `toSignal` on `NavigationEnd`) instead of manual signals.
  `toggleAdmin()` navigates and remembers the return URL.
- **`NavHistory`** tags each history entry with a position in `history.state`.
  A popstate restores the tag; a fresh navigation becomes the next position.
  That is enough to disable Back at the start and Forward at the end without
  ever leaving the app. `NavButtons` reuses it and calls
  `Location.back()/forward()`.
- **`Course`** drops the `view` signal: `view` is now a `computed` from the
  route (`parseCourseTail`). `openCourse`/`onItemClick`/`goToBreadcrumb`/`home`
  and the header-search jump all `router.navigate(...)`.
- **`Admin`** drops the `hashchange` listener; `view` is a `computed` from
  `?tab=files`, and `showFiles`/`showUsers` navigate a query param.
- **Server:** add `not_found_handling = "single-page-application"` to
  `[assets]` in `wrangler.toml`, so deep links serve the app. `/api/*` still
  goes to the Worker first.
- **Styles:** a small `.nav-btns` row reusing `.icon-btn`, a disabled state, and
  the player bar's replaced Back button removed.

## Testing
- `npm test` (10 tests) includes the pure URL grammar: root/folder/lesson
  parsing, the URL builders, and a names-with-spaces/unicode round trip.
- `npm run typecheck` and `npm run build` are clean.
- A headless-Chromium pass against the real built bundle (mock API) verifies, on
  desktop and phone: URLs change per screen, the pair enables/disables
  correctly, on-screen Back/Forward work, **native** `history.back()`/
  `forward()` work, a deep folder URL renders, reloading a deep lesson URL
  still shows the lesson, and the admin panel round-trips `/admin` ↔
  `/admin?tab=files`. All 23 checks pass.

## Calls made
- Back/Forward mean **history only**, never previous/next lesson.
- In the lesson bar the pair **replaces** the old "Back to folder" button: in the
  normal flow history-back returns to exactly that folder. Consequence: a
  freshly deep-linked lesson has Back disabled until there is app history.
- Admin keeps the browser's own back/forward; no on-screen pair there.

## Risks
- The custom matcher and `parsed` tail assume folder/lesson names contain no
  slash (a course is one top-level folder), which the data model guarantees.
- A sufficient `not_found_handling` change is needed on the Worker; without it
  deep links return the API's 404 JSON.

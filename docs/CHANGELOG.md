# Changelog

## Unreleased
### Changed (lazy loading)
- The PDF viewer (`ngx-extended-pdf-viewer`) and the admin panel are now **lazy chunks** loaded with Angular `@defer`, so they are no longer in the initial bundle. The PDF viewer's on-idle warm-up is now a dynamic `import()` — a static `prefetchPdfAssets` import (same module as the viewer) was what pinned the library into the entry bundle. Initial JS transfer drops from ~215 kB to ~80 kB; the `pdf-viewer` chunk (~126 kB) is warmed on idle, while the `admin` chunk (~16 kB) is fetched only for admins.

### Added (YouTube CSV import)
- Add many YouTube lessons at once: in the Files → YouTube dialog, choose a **CSV** (`name,link` per row; a header row and extra columns like a `No,Date,Title,URL` export are accepted — the link column is detected by its YouTube URL and the name is the column to its left). The dialog previews the found and skipped rows, then **Add N lessons** adds them all into the current folder and updates any name that already exists. The file never leaves the browser; new pure module `src/app/youtube-csv.ts`; no Worker change.

### Changed (YouTube lessons are now managed in the UI)
- YouTube lessons now live in the D1 table `youtube_lessons` and are added, edited and deleted from **Admin panel → Files** — the **YouTube** button adds one to the folder you are in, and its lessons show as rows there (change link / delete) — no code edit, no redeploy. `listCourse` reads the table instead of a module. The separate Admin → YouTube tab and `src/app/admin-youtube.ts` were removed.
- Admin endpoints: `GET/POST/DELETE /api/admin/youtube`. `POST` parses the link (watch/`youtu.be`/`embed`/`shorts`/`live`/bare id), refuses anything else, upserts by path, invalidates the course cache, and returns `shadowed` when a real file already uses the path.
- `worker/youtube.js` is now only a one-time first-run seed for the table; a lesson deleted in the Files view does not come back.

### Added (YouTube lessons)
- Play a YouTube video as a lesson, with no upload: add it from **Admin panel → Files** (the **YouTube** button; `"<Course>/<Folder>/<Name>"` + any YouTube link, where the folder you are in is the path). The link may be a watch/`youtu.be`/`embed`/`shorts`/`live` URL or a bare video id.
- `listCourse` merges those entries into the bucket listing; a YouTube-only course is created automatically and can be granted to students. A real file with the same key wins; a bad link is skipped before anything is created.
- YouTube lessons use R2-key-shaped ids, so progress, discussion, private notes, resources and enrollments all work unchanged.
- New `src/app/yt-player.ts` (`<app-yt-player>`): a privacy-friendly `youtube.com/embed` iframe with the moving email watermark; `course.ts` and the header search show a YouTube icon.
- `public/_headers` allows `youtube.com` / `youtube-nocookie.com` in the report-only CSP `frame-src`; `styles.css` sizes the iframe like the video.

### Changed (Angular 22 upgrade)
- Upgraded Angular 21 → 22 and TypeScript 5.9 → 6.0. Angular 22 makes `OnPush` the default change detection strategy, so the `ng update` migration added `ChangeDetectionStrategy.Eager` to every existing component to keep behaviour unchanged. New components can use the OnPush default.
- Pinned the toolchain so local, CI and Workers Builds agree: `.nvmrc` (Node 24) and `engines.node`.
- Added a GitHub Actions check (`.github/workflows/ci.yml`): `npm ci`, `npm run typecheck`, `npm run build` on pull requests and pushes to `main`.
- Added a `typecheck` script (`tsc -p tsconfig.app.json --noEmit`).

### Removed (Angular 22 upgrade)
- `@angular/router`: it was listed in `package.json` but never used, so it is now dropped.

### Added (courses, notes, theme)
- Multi-course access: `enrollments` table, `GET /api/admin/courses`, `POST /api/admin/users/<id>/courses`, `courses` on add/bulk add, course checkboxes in the Admin panel. Existing students keep every current course on first deploy.
- Worker checks the course on `/api/course`, `/api/media/*` and `/api/notes/*`.
- Course cards home screen and a sidebar folder tree (open/close, done counts, search, remembers open folders, expands to the current lesson).
- Private PDF notes: `pdf_notes` table, `GET/PUT/DELETE /api/notes/<key>`, auto-save, Hide my notes, Reset to original, full-window mode, all viewer tools except download and print.
- Color palette (`#202734`, `#36415A`, `#B7D894`, `#E0F8C7`) for dark mode, with a derived light mode.

### Security (courses and notes)
- Download is locked off in the PDF viewer (`supportsDownloading=false`, buttons hidden, Ctrl/Cmd+S and +P blocked).
- Notes are scoped to the signed-in user in every query.

### Added (earlier)
- Admin panel (`src/app/admin.ts`): list users, add user (optionally admin), reset password, grant/remove admin, delete user.
- Admin endpoints: `GET/POST /api/admin/users`, `POST /api/admin/users/<id>/password|role`, `DELETE /api/admin/users/<id>`.
- First admin (Owner) seeded from Cloudflare secrets `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- Logo in *Curse of the Zombie* (bundled font, capitals only).
- Email and password validation on the server.
- Optional invite-only Google sign-in: `GET /api/config`, `POST /api/login/google`, `google_sub` column (auto-migrated), "Continue with Google" button, admin "Google only" users and a Google badge. Enabled by the `GOOGLE_CLIENT_ID` variable.
- Bulk user import in the Admin panel (paste or file; Google-only or generated passwords with CSV download) and `POST /api/admin/users/bulk`.
- `docs/PLAN-google-login.md`.

### Security
- Login lockout (8 failures per email+IP, 40 per IP, 15 min) stored in D1.
- Session versioning: password reset or role change signs the user out everywhere.
- CSRF origin check, security headers on API and pages, report-only CSP (`public/_headers`).
- Media gate: requires browser `Sec-Fetch-*` headers (blocks curl/yt-dlp/download managers and hotlinking); cap of 20 distinct lessons per student per hour; `Cross-Origin-Resource-Policy`.
- Slow-down for bulk downloading: video needs Range requests, 4 MB answers, per-student speed cap (`MAX_MBPS`, default 12 Mbit/s).
- Page printing disabled; `/api/me` no longer returns internal fields.
- New `docs/SECURITY.md`.

### Changed
- Full UI redesign (tokens, light/dark, cards, gradients) and a dedicated phone layout.
- "Mark as complete" updates instantly (optimistic), shows "✓ Completed", and Back returns to the same folder.
- PDF viewer fills the lesson area.
- Video uses the browser's native controls and fullscreen again.
- README and HANDOFF rewritten to match the code (course/folder structure, MP4 handling, API, limits).

### Removed
- `POST /api/setup` and the `SETUP_KEY` secret.
- The "Add student" dialog.
- The old `ALLOW_MP4` mention (the option no longer exists in the Worker).

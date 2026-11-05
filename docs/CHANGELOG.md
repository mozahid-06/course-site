# Changelog

## Unreleased
### Added (lesson resources)
- **PDF resources on video and YouTube lessons.** The Resources tab's admin form now switches **Link | PDF**: the PDF is uploaded with an optional note (title defaults to the file name, 25 MB cap, `%PDF-` checked) and listed like a link. A PDF row opens the shared in-app reader in a full-window modal, not a new tab. Resource PDFs are stored in `<Course>/_resources/<uuid>.pdf`, which `listCourse` and the file manager skip, so they never appear as lessons. They reuse `/api/media` and `/api/notes`, so enrollment checks and each student's private annotations are exactly those of a PDF lesson.
- Deleting a resource removes its PDF and notes; deleting a lesson, section, course or YouTube lesson removes the PDFs of its resources too. Renames rewrite `file_key`, and a cross-course lesson move copies the PDFs into the destination course's `_resources`. Schema: `resources.kind` (`link`/`pdf`) and `resources.file_key`.

### Fixed (PDF viewer)
- **Saved notes were not shown when a PDF was reopened.** `pagesLoaded` fires before PDF.js renders the annotation editor layer, and `addEditorAnnotation` silently skips notes when that layer does not exist. The viewer now restores each page's notes after that page's `annotationEditorLayerRendered` event (so notes on later pages restore on scroll), merges not-yet-rendered saved notes into every save so an edit cannot delete them, and uses a fresh viewer instance per PDF id so switching lessons cannot reuse another document's note state. Affects PDF lessons and resource PDFs.

### Added (players)
- **Picture-in-picture works on self-hosted lessons** (HLS and MP4): the skin's own PiP button enters and exits it, and playback keeps its position. YouTube lessons report PiP as unsupported (the adapter cannot hand an iframe to the browser), so the feature is self-hosted only.
- **Subtitles from tracks already embedded in the source video.** `tools/make-hls.sh` probes each source with `ffprobe` and converts every text subtitle track to WebVTT next to the playlist as `index.<lang>[.<n>].vtt` (`<lang>` lowercased from the stream tag, `und` when absent; duplicate languages get `.2`, `.3`). Extraction runs **before** the "already encoded" skip, so re-running the encoder on an existing lesson adds the `.vtt` files without re-encoding the video; the video encode now passes `-sn` so ffmpeg does not also write stray `index0.vtt` / `index_vtt.m3u8`. Bitmap subtitles (PGS/VobSub) are skipped.
- The Worker serves `.vtt` as `text/vtt` on the same protected `/api/media/*` route, attaches each folder's tracks to its `index.m3u8` lesson as `subtitles: [{ key, lang }]`, hides `.vtt` in the admin file list like `.ts`, and counts a lesson's subtitles as the same lesson in the per-user scrape cap.
- The app renders one `<track kind="subtitles">` per entry inside `<hlsjs-video>` / `<video>`, labelled with `Intl.DisplayNames` (`English`, `English (2)` for duplicates, `Undetermined` for `und`). **Captions are off by default**; the viewer turns them on from the skin's captions button (desktop) or Settings → Captions (phones, where the button is hidden below 512px). No new upload UI, no transcription, no cost.
- Verified in a real browser (local Worker + seeded HLS fixtures): tracks load with every `mode` `disabled`; selecting `English` paints the `Hello` cue over the video with the watermark and single control bar; `English (2)` and `Undetermined` are selectable; an HLS lesson with no `.vtt` shows no captions button and plays unchanged; at 390×844 the settings menu still lists and selects the track. Layout matrix 1920×950 / 1440×900 / 1366×768 / 900×800 / 390×844: no horizontal overflow, two columns at ≥1100px, single column below, player fits the viewport, no cue/watermark overlap.
- Bundles after this change: initial JS transfer **66.51 kB** (unchanged); `player` 640.87 kB raw / 162.97 kB transfer (was 640.00 / 162.81); `yt-player` 15.52 kB / 5.39 kB. `main-*.js` still contains no Video.js or hls.js code (`grep` count 0); its gzip moved 10001 → 10002 bytes only because it embeds the renamed lazy `course` chunk.
- **No resolution selector** and **no encoder quality change**: YouTube's IFrame API no longer lets a third-party embed set playback quality (`setPlaybackQuality` is a no-op, `setPlaybackQualityRange` is gone and the setters are no longer documented), and the only working quality menu is YouTube's own chrome, which this player deliberately hides. Self-hosted lessons stay a single full-resolution HLS rendition encoded with `-crf 23 -preset veryfast -b:a 128k`. YouTube captions already worked through the adapter and are unchanged by this work.

### Changed (players)
- Both lesson players are now **Video.js 10** web components on the **Default** skin. YouTube lessons render `<video-player><video-skin><youtube-video>` — the **Share** button and **"Watch on YouTube"** are gone; self-hosted lessons render `<hlsjs-video>` for HLS and a native `<video>` for MP4 (and other files) inside the same `<video-player><video-skin>` shell. The moving email watermark, the `@defer` lazy chunks and the Worker are unchanged.
- `hls.js` is no longer imported directly (`src/app/player.ts` has no player library code of its own); it stays a transitive dependency of `@videojs/hlsjs-video`, so HLS playback is unchanged.
- Bundles: initial JS transfer is **66.5 kB** (was 65.63 kB — the difference is the added player/layout CSS, not library code). Video.js core is a **shared lazy** chunk (367 kB raw / ~73 kB transfer); the `player` lazy chunk is 640 kB raw / ~163 kB transfer (carries hls.js); the `yt-player` lazy chunk is 15.5 kB raw / ~5.4 kB transfer. `main-*.js` contains no Video.js or hls.js code.
- Desktop sizing: the player is capped to the viewport height and centred (`max-width:calc((100vh - var(--head) - 6.25rem) * 16 / 9)`), so its control bar is no longer below the fold on wide or short windows. It was `width:100%` + `aspect-ratio:16/9`, which overflowed the fold on essentially every laptop/desktop. Mobile (≤760px) stays edge-to-edge full-bleed.
- Both lesson players now **auto-start with sound** (`autoplay`, no `muted`): the `<youtube-video>` element, the fallback embed (`autoplay=1`), and both self-hosted branches (`<hlsjs-video>` and `<video>`). Muted autoplay was rejected: the lesson should be audible immediately. A real click on the lesson card is a user gesture, and un-muted playback starts in Chrome. Because `autoplay` makes the player report "playing" before the first frame, the skin's own poster/control bar showed the YouTube thumbnail or a pause icon while the media was genuinely still loading. A dark `.media-cover` now sits above the media, buffering spinner and control bar (but below the moving watermark) and shows a **loading spinner** until playback actually progresses (`playing`, or `timeupdate` past 0.25s). If autoplay is blocked — no real progress within 4 s — the spinner becomes a real **Play lesson** button, so one tap starts playback with sound (never silently muted).
- Verified in a real browser (local Worker + R2): both players render the skin control bar and watermark, MP4 plays (`readyState 4`, `currentTime` advancing), HLS plays a visible frame, the `ended` output marks the lesson complete, and rapid lesson switching is clean. Un-muted autoplay was also verified with trusted (real) pointer input: YouTube, MP4 and HLS all start with `muted:false`, and the loading spinner hides only once `currentTime` moves (HLS under a throttled connection shows the spinner instead of the pause icon). When the browser blocks autoplay (no gesture), the spinner becomes a play button after 4 s and one tap starts the lesson with sound.

### Added (lesson layout)
- **Wide screens show the lesson panel beside the player, not below it.** At ≥1100px a video lesson is a two-column grid — player left, Discussion/Notes/Resources right, both viewport-height, the panel with its own scrollbar — so the panel no longer starts below the fold (at 1920×950 the height-capped video was 1408×792 and the panel began at y=945). Below 1100px, and for the PDF reader, the original single-column stack is kept.
- **A "back to top" button for every long section.** One floating button in the app shell appears once any long section is scrolled down, smooth-scrolls that section to the top and hides. It tracks any container marked `data-scroll-top` (the course/browser `main`, `.player-body`, the lesson panel on wide screens, the admin user drawer) plus the page itself (admin view). Marked sections are read via a capture-phase `document` scroll listener, so sections that scroll on their own are covered without a control inside each one.

### Changed (lazy loading)
- The PDF viewer (`ngx-extended-pdf-viewer`) and the admin panel are **lazy chunks** loaded with Angular `@defer`, so they are no longer in the initial bundle. The PDF viewer's on-idle warm-up is now a dynamic `import()` — a static `prefetchPdfAssets` import (same module as the viewer) was what pinned the library into the entry bundle.
- A second pass extends the same treatment across the site: the **lesson area** (`player`, `yt-player`, `lesson-panel` + discussion/resources), **login** and the **course shell** are lazy chunks too. Every deferred block has a layout-matched placeholder, an `@error` fallback and `aria-live`, so a slow or failed chunk shows a message rather than a blank pane.
- Initial JS transfer drops from ~215 kB to ~66 kB. The `pdf-viewer` chunk (~126 kB) is warmed on idle; `admin` (~16 kB), `course` (~3 kB) and `login` (~1.3 kB) load with their view; the lesson chunks load when a lesson opens.

### Fixed
- **YouTube lessons showed a blank black player.** `iframe[src]` is an Angular `RESOURCE_URL` binding, and Angular 22 refuses a plain string there — `DomSanitizer.sanitize(RESOURCE_URL, …)` throws NG0904 — so the `src` was never applied. `yt-player.ts` now binds a `SafeResourceUrl` made with `DomSanitizer.bypassSecurityTrustResourceUrl`. Found in a real-browser click-through; reproduced and fixed RED→GREEN against a seeded local lesson.

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

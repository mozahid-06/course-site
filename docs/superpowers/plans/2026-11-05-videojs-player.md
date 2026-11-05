# Video.js 10 Player Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both lesson players (YouTube and self-hosted HLS/MP4)
with Video.js 10 custom elements on the Default skin, so YouTube's Share and
"Watch on YouTube" buttons are gone and every lesson shares one player.

**Architecture:** Two existing Angular standalone components (`YtPlayer`,
`Player`) keep their selectors, inputs, outputs and the moving `.wm` email
watermark, but their templates wrap a Video.js `<video-player><video-skin>…`
shell instead of a hand-built `<video>`/`<iframe>`. Element registrations are
imported inside each component file, so all Video.js code lands in the existing
lazy lesson chunks and never in the entry bundle.

**Tech Stack:** Angular 22 (standalone, `CUSTOM_ELEMENTS_SCHEMA`), TypeScript 6,
`@videojs/html@10.3.0`, `@videojs/youtube-video@10.3.0`,
`@videojs/hlsjs-video@10.3.0` (HTML custom elements), Cloudflare Worker (unchanged).

**Spec:** `docs/superpowers/specs/2026-11-05-videojs-player-design.md`

## Global Constraints

- Package versions: `@videojs/html@^10.3.0`, `@videojs/youtube-video@^10.3.0`,
  `@videojs/hlsjs-video@^10.3.0`.
- Element imports, exactly (per `npx @videojs/cli agents init`):
  `@videojs/html/video/player`, `@videojs/html/video/skin`,
  `@videojs/html/media/youtube-video`, `@videojs/html/media/hlsjs-video`.
- Default skin element is `<video-skin>`; never depend on its internal classes.
- Initial JS transfer must stay at the recorded baseline (**65.63 kB** before,
  from `docs/CHANGELOG.md`); no Video.js code may appear in `main-*.js`.
- Keep the moving watermark: `.wm` span, `setInterval` every 15000 ms,
  `x()` = `5 + Math.random()*55`, `y()` = `8 + Math.random()*78`.
- Keep `Player`'s `ended` output and `course.ts`'s `(ended)="finish(l)"` wiring.
- Worker (`worker/*.js`), `Api` (`src/app/api.ts`) and all `/api/*` endpoints
  unchanged.
- `public/_headers` CSP is **report-only**; edits are hygiene, not enforcement.
- No test framework exists and none may be added; verification is
  `npm run typecheck`, `npm run build`, the built-output bundle check, and a real
  browser session (browser-use/CDP). No file may be committed until its task's
  verification step passes.
- Direct commit/push to `main` is authorised.

## Review Focus

Inputs/conditions the spec implies but no step is proved against; the task named
owns the test for each.

1. **Empty `yt` value** — `course.ts` passes `l.yt || ''`. `<youtube-video src="">`
   must render a stable empty player, not throw or show a broken frame (Task 1).
2. **Non-HLS, non-MP4 self-hosted key** (e.g. `.mkv`) — `isHls()` is false, so it
   falls through to native `<video>`; it must not crash (Task 2).
3. **Fullscreen on the native path** — the old `.vw:fullscreen` CSS must not
   fight the skin's own fullscreen; controls stay usable (Task 2).
4. **Fast lesson switching** (the `key` input changes while the player is
   mounted) — the media element must swap without a stale stream or a leak
   (Task 2).
5. **Watermark above the skin** — Video.js elements paint their UI; the `.wm`
   span must stay visible and must not block clicks/keyboard (Tasks 1 and 2).

---

### Task 1: Convert the YouTube player to Video.js `<youtube-video>`

**Files:**
- Modify: `package.json` (add `@videojs/html`, `@videojs/youtube-video`)
- Modify: `src/app/yt-player.ts`
- Modify: `src/styles.css` (`/* ===== Player / PDF ===== */` block, lines 135–149)
- Modify: `public/_headers` (report-only CSP `script-src`)

**Interfaces:**
- Consumes: `Api` (`this.api.me()?.email`), input `yt: string` (a bare 11-char
  YouTube id), `location.origin`.
- Produces: `YtPlayer` renders inside `.vw.yt` a
  `<video-player><video-skin><youtube-video>` shell plus the `.wm` span; keeps
  selector `app-yt-player` and input `yt` unchanged. Keeps an
  `@if (!supported)` fallback that renders the previous sanitized `<iframe>`.

- [ ] **Step 1: Capture the RED baseline (buttons present)**

Start the app against the Worker and open a seeded YouTube lesson in the real
browser (browser-use/CDP), then screenshot the **paused** player.
Expected (before): the frame shows YouTube **Share** and **Watch on YouTube**
(and a title/logo). This screenshot is the failing state the task removes.

- [ ] **Step 2: Install the packages**

Run: `npm install @videojs/html@^10.3.0 @videojs/youtube-video@^10.3.0`
Expected: `package.json` and `package-lock.json` change; install succeeds.

- [ ] **Step 3: Rewrite `src/app/yt-player.ts`**

Keep the class shape; replace the template and imports. The exact imports are
fixed above; the source object is the only non-obvious decision:

```ts
import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import '@videojs/html/video/player';
import '@videojs/html/video/skin';
import '@videojs/html/media/youtube-video';
import { Api } from './api';

@Component({
  selector: 'app-yt-player',
  changeDetection: ChangeDetectionStrategy.Eager,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="vw yt">
      @if (supported) {
        <video-player>
          <video-skin>
            <youtube-video [source]="source()" playsinline></youtube-video>
          </video-skin>
        </video-player>
      } @else {
        <iframe [src]="src()" title="YouTube video player" loading="lazy"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
      }
      <span class="wm" [style.left.%]="x()" [style.top.%]="y()">{{ email() }}</span>
    </div>
  `,
})
export class YtPlayer {
  // api, sanitizer, yt input, email, x, y, constructor timer and moveMark()
  // are unchanged from the current file.

  /** YouTube chrome (Share / Watch on YouTube) is hidden by default; set rel=0
   *  so the end screen cannot link away, and origin/enablejsapi so the skin can
   *  drive the IFrame API. */
  protected readonly source = computed(() => ({
    src: this.yt(),
    engine: { youtube: { rel: 0, iv_load_policy: 3, disablekb: 1, cc_load_policy: 0, origin: location.origin, enablejsapi: 1 } },
  }));

  /** Defensive fallback: if the Video.js element failed to register, the plain
   *  embed still plays. `src` is the current sanitized iframe URL. */
  protected readonly supported = typeof customElements !== 'undefined' && !!customElements.get('video-player');
}
```

Keep the existing `src` computed (the `bypassSecurityTrustResourceUrl` iframe
URL) solely for the fallback branch. Keep the existing step-3 doc comment above
`src` explaining the ANGULAR `RESOURCE_URL` fix.

- [ ] **Step 4: Update `src/styles.css`**

In the `/* ===== Player / PDF ===== */` block: keep `.vw` and `.wm` as-is except
**remove `overflow:hidden` from `.vw`** (the skin rounds itself; `overflow:hidden`
would clip its menus). Replace the `.vw video`/`.vw iframe`/`.vw:fullscreen`
sizing rules with a skin rule, and add the accent/border tokens:

```css
.vw{position:relative;background:#000;border-radius:var(--r);box-shadow:var(--shadow);
    --media-accent-color:var(--acc);--media-border-radius:var(--r);--media-font-family:inherit}
.vw video-player{display:block;width:100%}
.vw video-skin{display:block;width:100%;aspect-ratio:16/9}
.vw iframe{display:block;width:100%;aspect-ratio:16/9;border:0;background:#000}
```

(`.vw iframe` stays for the Task 1 fallback. The old `.vw video` and
`.vw:fullscreen video` rules are removed; the skin owns media sizing/fullscreen.)

- [ ] **Step 5: Allow the YouTube IFrame API in the report-only CSP**

In `public/_headers`, append ` https://www.youtube.com` to the `script-src`
list of `Content-Security-Policy-Report-Only`. `frame-src` already allows
`youtube.com`/`youtube-nocookie.com`; `img-src`/`media-src`/`worker-src` need no
change because no poster is set.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors. (If `[source]` or `[src]` is rejected as an unknown
property, confirm `schemas: [CUSTOM_ELEMENTS_SCHEMA]` is present.)

- [ ] **Step 7: Build and check the bundles**

Run: `npm run build`
Expected: build succeeds. In `dist/web/browser/`:
- Record the reported **initial JS transfer**; it must not exceed the 65.63 kB
  baseline and must not grow from the pre-task build.
- `grep -l "video-player" dist/web/browser/*.js` must **not** list `main-*.js`.
- A lazy chunk containing `youtube-video`/`video-player` exists and is loaded
  only when a lesson opens.

- [ ] **Step 8: Browser-verify (GREEN)**

Run the app against the Worker and open the same YouTube lesson; screenshot the
**paused** player.
Expected:
- `<video-player>`, `<video-skin>` and `<youtube-video>` are in the DOM.
- The embed iframe URL contains `controls=0` and `enablejsapi=1`.
- Screenshot shows the Video.js skin's control bar and **no Share button and no
  "Watch on YouTube"** (and no YouTube title/logo overlay).
- The moving `.wm` watermark is visible over the player.

Review-Focus checks: set an empty `yt` (or open a lesson whose `yt` is `''`) and
confirm the player renders an empty but stable frame (no exception). Confirm the
watermark does not intercept clicks on the skin (click the skin's play button
under the watermark's rectangle).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/app/yt-player.ts src/styles.css public/_headers
git commit -m "feat(player): use Video.js youtube-video for YouTube lessons"
```

---

### Task 2: Convert the self-hosted player to Video.js `<hlsjs-video>` / `<video>`

**Files:**
- Modify: `package.json` (add `@videojs/hlsjs-video`)
- Modify: `src/app/player.ts`
- Modify: `src/styles.css` (only if the skin needs media-specific sizing)

**Interfaces:**
- Consumes: `Api` (`this.api.me()?.email`, `this.api.mediaUrl(key)`), input
  `key: string`; Task 1's `.vw`/skin CSS and element imports already apply.
- Produces: `Player` renders inside `.vw` a `<video-player><video-skin>` shell
  whose media child is `<hlsjs-video>` when `key` ends with `.m3u8`, else native
  `<video>`; keeps selector `app-player`, input `key`, output `ended`, and the
  `.wm` watermark. No `hls.js` import remains in the component.

- [ ] **Step 1: Capture the baseline (self-hosted lesson plays, `ended` works)**

Open a self-hosted MP4 lesson and an HLS lesson; note that each plays and that
finishing fires "Mark as complete". This is the regression baseline.

- [ ] **Step 2: Install the package**

Run: `npm install @videojs/hlsjs-video@^10.3.0`
Expected: `package.json`/`package-lock.json` change; install succeeds.

- [ ] **Step 3: Rewrite `src/app/player.ts`**

```ts
import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import '@videojs/html/video/player';
import '@videojs/html/video/skin';
import '@videojs/html/media/hlsjs-video';
import { Api } from './api';

@Component({
  selector: 'app-player',
  changeDetection: ChangeDetectionStrategy.Eager,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="vw">
      <video-player>
        <video-skin>
          @if (isHls()) {
            <hlsjs-video [src]="src()" playsinline disablepictureinpicture
              [attr.controls]="supported ? null : ''"
              controlslist="nodownload noremoteplayback" (ended)="ended.emit()"></hlsjs-video>
          } @else {
            <video [src]="src()" playsinline disablepictureinpicture
              [attr.controls]="supported ? null : ''"
              controlslist="nodownload noremoteplayback" (ended)="ended.emit()"></video>
          }
        </video-skin>
      </video-player>
      <span class="wm" [style.left.%]="x()" [style.top.%]="y()">{{ email() }}</span>
    </div>
  `,
})
export class Player {
  // api, key input, ended output, email, x, y, constructor timer and moveMark()
  // are unchanged.

  protected readonly src = computed(() => this.api.mediaUrl(this.key()));
  protected readonly isHls = computed(() => this.key().endsWith('.m3u8'));
  /** Fallback: if the Video.js element did not register, fall back to native
   *  controls so the lesson still plays. */
  protected readonly supported = typeof customElements !== 'undefined' && !!customElements.get('video-player');
}
```

Delete the `effect()`, `viewChild`, `Hls` type import, the dynamic
`import('hls.js')` and the `hls` field — the element and the `[src]` binding
replace them. Do **not** set a `controls` attribute (the skin draws controls).

`api` stays `private`; only the computed signals are read from the template.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Confirm no remaining `from 'hls.js'` import anywhere in `src/`
(`grep -rn "hls.js" src/` returns nothing).

- [ ] **Step 5: Build and check the bundles**

Run: `npm run build`
Expected: build succeeds; initial JS transfer still at/below baseline; no
Video.js or hls.js code in `main-*.js`.

- [ ] **Step 6: Browser-verify (GREEN)**

Open the MP4 and HLS lessons.
Expected:
- `<video-player>`/`<video-skin>` present; MP4 renders native `<video>`, HLS
  renders `<hlsjs-video>`.
- Play/pause/seek/volume work through the skin; the moving watermark is visible
  and does not block the controls.
- Letting the MP4 finish fires `ended` and flips "Mark as complete".

Review-Focus checks: open an `.mkv` (or any non-`.m3u8`) key and confirm the
native `<video>` branch renders without error. Enter **fullscreen** from the
skin controls and confirm the controls remain usable and the skin is not clipped.
Switch between two lesson keys without leaving the lesson view and confirm the
new stream loads exactly once (no stale/duplicated request for the old key).
Confirm the MP4 request is answered **206** with a `content-range` header (the
Worker refuses an MP4 request that carries no `Range` header), and that the HLS
`.m3u8`/`.ts` requests succeed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/player.ts src/styles.css
git commit -m "feat(player): use Video.js hlsjs-video / native video for self-hosted lessons"
```

---

### Task 3: Docs, `hls.js` cleanup, and final bundle audit

**Files:**
- Modify: `package.json` (remove the now-unused direct `hls.js` dependency)
- Modify: `docs/HANDOFF.md` (decision log, §2)
- Modify: `docs/CHANGELOG.md` (Unreleased)
- Modify: `docs/superpowers/specs/2026-11-05-videojs-player-design.md` (Status)

**Interfaces:**
- Consumes: the built output from Task 2.
- Produces: repository docs that describe the new player stack; no runtime change.

- [ ] **Step 1: Remove the unused direct `hls.js` dependency**

Confirm nothing imports it directly: `grep -rn "hls.js" src/ worker/` returns
nothing. Then run: `npm uninstall hls.js`
Expected: `package.json`/`package-lock.json` drop `hls.js` (it remains a
transitive dependency of `@videojs/hlsjs-video`).

- [ ] **Step 2: Record the decision in `docs/HANDOFF.md` §2**

Add rows to the decision-log table: both lesson players are **Video.js 10**
custom elements on the Default skin, chosen to remove YouTube's Share / "Watch
on YouTube" chrome and to replace the hand-written `hls.js` player; note the
known limits (YouTube fullscreen shows YouTube's own chrome; no PiP on YouTube
media; the lazy lesson chunk grew).

- [ ] **Step 3: Add the `docs/CHANGELOG.md` entry**

Under `## Unreleased`, add a `### Changed (players)` section stating: YouTube
lessons now use `<youtube-video>` and self-hosted lessons `<hlsjs-video>` /
`<video>` inside `<video-player><video-skin>` (Video.js 10, Default skin); the
Share button and "Watch on YouTube" are gone; `hls.js` is no longer used
directly; the watermark, lazy chunks and Worker are unchanged. Include the final
lazy-chunk sizes and initial JS transfer recorded in Tasks 1–2.

- [ ] **Step 4: Mark the spec implemented**

Set `Status: implemented` in
`docs/superpowers/specs/2026-11-05-videojs-player-design.md`.

- [ ] **Step 5: Final audit**

Run: `npm run typecheck && npm run build`
Expected: both pass; re-confirm the initial JS transfer is at/below the 65.63 kB
baseline and that `main-*.js` contains no Video.js/hls.js code.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json docs/HANDOFF.md docs/CHANGELOG.md docs/superpowers/specs/2026-11-05-videojs-player-design.md
git commit -m "docs: record the Video.js 10 player switch"
```

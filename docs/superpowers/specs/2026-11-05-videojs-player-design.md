# Full switch to Video.js 10 — design

Date: 2026-11-05
Status: implemented

## Intent (why)

The owner's original ask was to remove the YouTube **Share** button and the
**"Watch on YouTube"** button so students are not pulled off the site. Verified
in a real browser on 2026-11-05:

- with the plain embed's native controls those buttons cannot be removed;
- `controls=0` removes them but also removes play/pause/seek;
- the reference site (`karigoripathsala.com`) removes them with **Plyr**
  (`controls=0` + Plyr's own controls + a poster), but **Plyr is deprecated**
  (security fixes only through Jan 2028), and the whole field is consolidating on
  **Video.js 10**.

The owner decided to go further and **replace both players** — the YouTube player
(`yt-player.ts`) and the self-hosted video player (`player.ts`) — with **Video.js
10**, using its **Default skin**, so every lesson shares one maintained player.

Video.js 10's `<youtube-video>` is documented as: *"The YouTube IFrame player
keeps its own chrome hidden by default, so it drops into a player skin like any
other media component."* That is the clean-UI behaviour we want, with no overlay
hacks, and the same library plays self-hosted HLS and MP4.

This supersedes the earlier Plyr-based design (Plyr is deprecated); that spec was
never adopted and its file was removed.

## Goals

- Replace `yt-player.ts` with Video.js 10 `<youtube-video>` (no Share / "Watch on
  YouTube").
- Replace `player.ts` with Video.js 10 `<hlsjs-video>` (HLS) and native `<video>`
  (MP4).
- One consistent look: the Video.js **Default** (`video-skin`) skin, tuned toward
  the site's tokens through the skin's public CSS custom properties.
- Keep: the moving email watermark; lazy loading; the `ended` output for
  self-hosted lessons; the Worker and `Api` untouched.

## Non-goals

- No Worker / `Api` / endpoint change.
- No change to how lessons are stored, listed, or imported.
- No self-hosting or re-encoding of YouTube videos (they stay on YouTube).
- Not building a custom skin from source (that path needs React or plain HTML;
  Angular uses the **packaged** Default skin plus its documented CSS properties).

## Anti-goals (do not break)

- Initial JS transfer must not grow: every Video.js import lives in the lazy
  lesson chunks (`player` / `yt-player`), never in `main-*.js`.
- The watermark keeps moving and stays above the player.
- PDF lessons and the discussion/resources panels are untouched.
- The Worker's media rules must still be satisfied by Video.js's requests
  (range-required MP4, per-user speed cap, lessons-per-hour cap). HLS `.m3u8`/`.ts`
  are already exempt from the range rule; ranges are only required for
  `mp4|webm|mkv|mov|avi|m4v`.
- No new cost.

## Approaches

- **(a) Plyr.** Replicates the reference site exactly, least code — but
  deprecated. Superseded.
- **(b) YouTube-only Video.js.** Smaller; leaves the hand-tuned self-hosted
  player alone.
- **(c) Full switch.** ⭐ Chosen. Both players on Video.js 10, Default skin.

## The how (decided)

- Add packages: `@videojs/html@10`, `@videojs/youtube-video@10`,
  `@videojs/hlsjs-video@10`.
- Register elements by importing, at the top of the lazy components so they are
  bundled into the lesson chunks:
  `@videojs/html/video/player`, `@videojs/html/video/skin`,
  `@videojs/html/media/youtube-video`, `@videojs/html/media/hlsjs-video`.
- Structure (from the CLI-generated plan):
  ```html
  <video-player>
    <video-skin>
      <!-- one media child -->
    </video-skin>
  </video-player>
  ```
  - **YouTube** (`yt-player.ts`): `<youtube-video [src]="yt()">` — a raw 11-char
    id or any YouTube URL both work. Optionally pass engine params via
    `source.engine.youtube` (`rel: 0`, `iv_load_policy: 3`, `disablekb: 1`,
    `origin`, `enablejsapi` — the last two are needed whenever the API drives it).
  - **Self-hosted** (`player.ts`): `@if (key ends with .m3u8) → <hlsjs-video
    [src]="api.mediaUrl(key)">` `@else → <video [src]="api.mediaUrl(key)">`.
    Native `<video>` is discovered automatically; no import needed for it.
- **Angular**: add `CUSTOM_ELEMENTS_SCHEMA` to both components (the tags are
  unknown custom elements to Angular's compiler). Property bindings set the
  elements' `src` property.
- **Skin styling**: set the documented CSS custom properties on the skin/wrapper
  toward the site tokens — `--media-accent-color`, `--media-border-radius`,
  `--media-scale-unit`, `--media-font-family` — from `styles.css`. Keep to the
  public properties; do not depend on internal classes.
- **Watermark**: keep the `.wm` span in the component wrapper, absolutely
  positioned above the player; the moving-mark logic is unchanged.
- **`ended`**: `player.ts` keeps its `ended` output, wired to the media element /
  `<video-player>` `ended` event.
- **Source changes**: a lesson change already recreates the component (it lives
  behind `@if`/`@defer` keyed by the lesson); also update `src` when the input
  changes.
- **Fallback**: after import, if `customElements.get('video-player')` is
  undefined (chunk/element failure), YouTube renders the previous plain `<iframe>`
  and the self-hosted MP4 branch renders a native `<video>` with its own controls.
  HLS has no cross-browser native fallback, so a missing HLS element surfaces as
  the `@defer` `@error` message in `course.ts`.
- **CSP** (`public/_headers`, report-only): add `https://www.youtube.com` to
  `script-src` (the IFrame API entry). No `i.ytimg.com` entry: `<youtube-video>`
  renders no poster, so no YouTube image host is needed. `frame-src` already
  allows YouTube; `media-src`, `worker-src`, `style-src` already allow what
  HLS/MSE needs.
- **Docs**: record the dependency + player swap in `docs/HANDOFF.md` §2; add a
  `docs/CHANGELOG.md` entry.

## Known limitations (state honestly)

- **YouTube fullscreen shows YouTube's own chrome** — the docs say fullscreen
  targets the iframe. The buttons return only while fullscreen.
- **No picture-in-picture on YouTube media** (reported unsupported).
- The Default skin's look is opinionated; only its documented CSS properties are
  supported. Deep changes would need the shadcn skin-source path (React/HTML
  only), which does not fit Angular.
- The lazy lesson chunk grows with Video.js; measure and record it.

## Left to the builder

- Exact `src` value passed to `<youtube-video>` (watch URL vs bare id) and which
  `engine.youtube` params to set.
- Whether to keep two components or fold both media paths into one.
- How the `.vw` wrapper (radius, `aspect-ratio`, fullscreen rules) reconciles with
  the skin; fullscreen selector changes.
- Lazy-chunk sizes before/after and the build-output marker proving Video.js is
  absent from `main-*.js`.

## Verification plan

- `npm run typecheck`, `npm run build`; record initial JS transfer and the
  `player` / `yt-player` chunk sizes; assert no Video.js code in `main-*.js`.
- Local `wrangler dev` with a seeded YouTube lesson and a self-hosted MP4 (and
  HLS if available); real browser (browser-use/CDP): the YouTube lesson shows the
  Default skin, **no Share and no "Watch on YouTube"**; play/pause/seek/
  volume/fullscreen work; the moving watermark is present; the self-hosted MP4
  plays through the same skin and fires `ended`, and the HLS lesson plays with a
  visible frame.
- The harness cannot sustain real YouTube playback (it stalls buffering), so
  verify the UI/DOM states and state the playback limitation honestly rather than
  claiming a watched video.
- Confirm the fallback path renders the plain embed / native video when the
  elements fail to register.

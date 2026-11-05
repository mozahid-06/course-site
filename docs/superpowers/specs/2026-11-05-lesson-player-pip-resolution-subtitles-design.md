# Lesson player: picture-in-picture and subtitles — design

Date: 2026-11-05
Status: approved (implemented; see docs/CHANGELOG.md)

## Intent (why)

The owner asked for three things in the lesson players:

1. **A resolution selector, from YouTube**, for YouTube lessons only — "its only
   for yt video, not my r2 videos, and grad the resolution from yt".
2. **A pop-up view**, picked in conversation as **picture-in-picture**.
3. **Subtitles**, picked as **"carry subtitle tracks already inside each video"**.

While investigating the first item we found, in the live app and in YouTube's
current docs, that YouTube **no longer allows a third-party embed to set
playback quality**:

- `getAvailableQualityLevels()` still returns e.g. `["hd720","medium","tiny","auto"]`
  and `getPlaybackQuality()` still returns `"hd720"`;
- `setPlaybackQuality()` exists but is a **no-op** (quality stayed `hd720`);
- `setPlaybackQualityRange()` is undefined, and `onPlaybackQualityChange` never
  fired;
- the current IFrame API reference documents `onPlaybackQualityChange` and
  `setPlaybackRate`, but **no longer documents `setPlaybackQuality`,
  `getPlaybackQuality`, or `suggestedQuality`**;
- reloading the embed with `suggestedQuality` or `vq` parameters did not change
  quality either.

The only way to expose a real Quality menu is to let **YouTube draw its own
controls**. We showed the owner exactly what that looks like on this lesson
(YouTube's bar: channel/title strip, YouTube logo, gear → Quality 720p, CC).
The owner chose to **keep our custom skin bar** and **drop the resolution
selector** rather than replace our bar on YouTube lessons.

So this design covers picture-in-picture and subtitles. The resolution selector
is intentionally **not built**.

## Goals

- **PiP:** make the skin's picture-in-picture button work on self-hosted lessons
  (MP4 and HLS).
- **Subtitles (self-hosted):** carry subtitle tracks embedded in the source
  video into the HLS output as WebVTT, serve them, and surface them through the
  skin's existing captions button/menu.
- **Subtitles (YouTube):** YouTube's captions are available through our skin's
  captions control. **Verified working** on a captioned video: the adapter
  exposes the track list, the skin's captions button appears, and the cues
  render over the video while our chrome and watermark stay in place. No new UI.
- Keep the moving email watermark, lazy-loaded players, and zero new cost.

## Non-goals

- **No resolution selector for YouTube.** The API to set quality is gone, and the
  only working menu is YouTube's own chrome, which the owner rejected in favour
  of the consistent custom bar.
- No multi-quality ladder for self-hosted HLS. R2 lessons stay a single
  full-resolution rendition, as they are today.
- **No change to the R2 encode's video settings.** The owner chose to keep the
  current `-crf 23 -preset veryfast -b:a 128k` encode. The encoder change here
  only adds subtitle extraction; the video is untouched.
- No upload UI for subtitle files. Subtitles come from tracks already inside the
  source videos.
- No auto-generated/transcribed subtitles (external service, cost).
- No re-encode of the video for existing HLS lessons (see limitations).

## Anti-goals (do not break)

- Initial JS transfer must not grow; all Video.js code stays in the lazy lesson
  chunks (`player`, `yt-player`), never in `main-*.js`.
- The moving watermark keeps moving and stays above the player in normal view.
- The loading cover still hides YouTube's thumbnail/title/red button while
  buffering, and still offers a real play button when autoplay is blocked.
- **YouTube lessons are otherwise unchanged**: same custom skin bar, same
  one-bar look, same learning experience. No second control bar.
- The Worker's media protections still hold: same-origin `Sec-Fetch-*`, per-user
  speed cap, lessons-per-hour scrape cap. `.vtt` must count toward the **same**
  lesson as its `index.m3u8`, not inflate the cap.
- PDF lessons, discussion/resources panels, and the two-column layout are
  untouched. The admin file manager changes only by hiding `.vtt` under the same
  rule that already hides `.ts`.
- No new cost, no new external service.

## Approaches

### Resolution (YouTube) — decided: not built

- **(a) Custom Video.js quality menu driven by YouTube's levels.** What the
  owner first pictured. **Not possible**: `setPlaybackQuality()` is a no-op and
  the setters are gone from the docs. It would be a control that looks real and
  does nothing.
- **(b) YouTube's native controls (`controls`).** Gives a real gear → Quality
  menu, but replaces our bar with YouTube's chrome (title strip, logo), so
  YouTube lessons stop looking like the rest of the site. **Rejected by the
  owner** after seeing it.
- **(c) Read-only current-resolution badge** (read `getPlaybackQuality()`,
  which still works). Honest but does not let the viewer choose. Not chosen.
- **(d) Do nothing.** ⭐ **Chosen.** Keep our bar everywhere; YouTube plays at
  its own adaptive quality. Revisit only if YouTube restores the API.

### Picture-in-picture

The skin already ships `<media-pip-button>`, and the button's availability does
**not** depend on the attribute (`getState()` derives it from
`document.pictureInPictureEnabled` plus `requestPictureInPicture`). The button is
therefore already rendered; `player.ts` sets `disablepictureinpicture`, so the
browser **refuses the request when clicked**. **Only sensible way: remove that
attribute.** (The earlier alternatives — theater overlay and open-in-new-window —
were offered and rejected by the owner.) YouTube reports PiP unsupported, so this
is self-hosted only. Acceptance is "enters PiP and exits cleanly", not "the
button appears".

### Subtitles (self-hosted)

- **(a) HLS-native subtitle renditions** (`#EXT-X-MEDIA:TYPE=SUBTITLES` in a
  master playlist). hls.js surfaces them and the skin's menu picks them up with
  no player change. But it forces `index.m3u8` to become a **master** playlist
  referencing a separate video playlist and subtitle playlists, which changes
  the "one HLS folder = `index.m3u8`" rule the Worker, admin, and scrape cap
  rely on. More moving parts.
- **(b) Sidecar WebVTT + `<track>` children.** ⭐ **Chosen.** The encoder extracts
  embedded tracks to `index.<lang>.vtt` next to `index.m3u8`; the Worker serves
  them and attaches them to the lesson; the player renders them as `<track>`
  children. `CustomMediaElement` clones light-DOM `<track>` children into the
  internal `<video>` (`#syncMediaChildren`), and `hlsjs-video` explicitly
  preserves sideloaded tracks across source loads (`withPreservedTextTracks`).
  `index.m3u8` stays a media playlist, so existing lesson semantics are intact.
  Smallest change that covers "tracks already inside each video".
- **(c) YouTube captions only / don't touch the encoder.** Rejected: it would do
  nothing for self-hosted lessons.

## The how (decided)

### Quality policy — no selector, always the best available

- **R2:** each lesson is a **single HLS rendition at the source resolution**, so
  the player has no lower variant to fall back to — it always plays that
  full-resolution rendition. The encode's video settings are unchanged
  (`-crf 23 -preset veryfast -b:a 128k`).
- **YouTube:** YouTube chooses the quality itself. The API to set it is gone, and
  in live testing the player was already at the **highest level that video
  offered** (`hd720`; that video had no 1080p). We keep hiding YouTube's chrome
  and add **no** no-op "force quality" code.

### 1. Picture-in-picture — `src/app/player.ts`

- Remove `disablepictureinpicture` from both the `<hlsjs-video>` and `<video>`
  branches. The already-rendered PiP button then enters and exits PiP correctly.
- Keep `controlslist="nodownload noremoteplayback"`.
- YouTube lessons: no change; the YouTube iframe is not PiP-capable through the
  adapter.

### 2. Subtitles — encoder, Worker, player

**`tools/make-hls.sh`** (runs on the owner's machine, output uploaded to R2):

- For each source video, probe subtitle streams (`ffprobe`). For each
  text-based subtitle stream, extract/convert to WebVTT next to the playlist:
  `hls/<Section>/<Lesson>/index.<lang>.vtt`, using the stream's `language` tag
  (fallback `und`). Example:
  `ffmpeg -i "$f" -map 0:s:<n> -c:s webvtt "$dest/index.<lang>.vtt"`.
- **Subtitle extraction runs before the existing `index.m3u8` skip guard.**
  Re-running the script on a source whose `index.m3u8` already exists therefore
  adds `.vtt` files **without re-encoding the video** (and overwrites them
  deterministically). If the original source file is gone, nothing can be
  recovered — the script only sees what is in `$src`.
- **Language tag contract:** normalise to lowercase and keep the full tag
  (`en`, `en-us`, `pt-br`, `zh-hans`), replacing characters outside
  `[a-z0-9-]` with `-`; fall back to `und`. On a collision, append `.2`, `.3`
  before `.vtt`. The Worker accepts
  `^index\.([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.\d+)?\.vtt$` and uses group 1 as both
  the `lang` and the `<track srclang>`.
- Sources with no subtitle stream produce no `.vtt` (feature is a no-op there).
- Bitmap subtitles (PGS/VobSub) cannot become WebVTT; skip them with a warning.
- Existing `index.m3u8` output and PDF copying are unchanged.

**`worker/index.js`:**

- `MEDIA_TYPES`: add `vtt: 'text/vtt'`.
- `serve` allowed-extension regex: add `vtt`. `.vtt` is **not** in `VIDEO_FILE`,
  so it does not need a `Range` header. `mediaRequestOk` already accepts
  `Sec-Fetch-Dest: track`.
- `lessonOf`: add `vtt` to the folder-stripping regex so a subtitle request
  counts against its own lesson in the scrape cap, not as a new lesson.
- `listCourse`: pre-pass the key list for
  `^(.+)/index\.([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.\d+)?\.vtt$`, then attach
  `subtitles: [{ key, lang }]` to the lesson built from that folder's
  `index.m3u8`. `.vtt` keys are otherwise ignored (they do not match
  `VIDEO_EXT`).

**`worker/files.js`:**

- `listFolder`: hide `.vtt` rows alongside `.ts`, so the admin file manager shows
  one HLS row per lesson. `.vtt` is not a lesson key.

**App:**

- `api.ts`: the lesson type gains an optional
  `subtitles?: { key: string; lang: string }[]`.
- `player.ts`: add a `subtitles` input and render one `<track kind="subtitles">`
  per entry **inside** the media element (`<video>` / `<hlsjs-video>`), with
  `src` from `api.mediaUrl(s.key)`, `srclang` from `lang`, and a human-readable
  `label` (e.g. `Intl.DisplayNames`). No `default`, so captions stay off until
  the viewer picks one; the skin's captions button appears whenever tracks
  exist.
- `course.ts`: pass the lesson's subtitles to `app-player`.
- **Scope:** subtitles are produced only for HLS lessons encoded by
  `tools/make-hls.sh`. Raw MP4/MKV lessons uploaded directly have no encoder
  step and therefore no `.vtt`; they play exactly as today.

### 3. YouTube lessons — unchanged, captions already work

- Keep the current `video-player` + `video-skin` + `youtube-video` structure and
  our custom control bar. No `controls` attribute, no YouTube chrome.
- **Captions work today with no code change.** Verified live on a captioned
  video:
  - `engine.getOption('captions','tracklist')` returns the languages
    (`English`/`en`, `German`/`de`);
  - the adapter mirrors them into `textTracks`, so the skin's captions button
    appears;
  - choosing a language sets the YouTube caption track, and the cues render over
    the video.
- `cc_load_policy: 0` keeps captions **off by default**; the viewer turns them on
  with our captions button. (Flip to `1` only if the owner wants them on
  automatically — see below.)
- A video with no caption tracks shows no captions button; there is nothing to
  display and we cannot invent captions.

## Known limitations (state honestly)

- **No resolution selector.** YouTube removed programmatic quality selection;
  a working menu would require YouTube's own chrome, which the owner rejected.
  YouTube lessons play at whatever quality YouTube picks (in testing it was
  already the highest the video offered). R2 lessons have a single rendition at
  the source resolution, so there is nothing to switch to.
- **Watermark in PiP:** the moving email is a DOM overlay, so it is not visible
  inside a picture-in-picture window (which shows only the video surface).
- **Subtitle extraction for existing HLS lessons** needs the **original source
  file** and a re-run of the script. The script now extracts subtitles before
  its "already encoded" skip, so a re-run adds `.vtt` without re-encoding the
  video. If the original file is gone, the subtitles cannot be recovered.
- **Raw MP4/MKV lessons get no subtitles.** Only the HLS pipeline extracts
  embedded tracks; directly uploaded files have no extraction step.
- **Bitmap subtitles** (PGS/VobSub) are skipped; only text subtitle tracks
  become WebVTT.
- **Phones:** the skin hides the captions **button** below ~512 px, but
  Settings → Captions remains. On phones, subtitles are reachable through the
  settings menu rather than a one-tap button.
- **YouTube captions are YouTube's.** They exist only when the video has them,
  and YouTube renders the cues itself, so we can neither style them nor add
  captions to a video that has none (that would need transcription).
- **PiP is self-hosted only**; YouTube does not support it through the adapter.
- The encoder needs `ffmpeg`/`ffprobe` (already required).

## Left to the builder

- Exact `<track>` label wording and whether labels come from
  `Intl.DisplayNames` in the app or a small map.
- Exact encoder details for unusual subtitle codecs and multi-language sources.
- Whether to show `.vtt` files in the admin file manager (design says hide,
  matching `.ts`).

## Verification plan

- `npm run typecheck`, `npm run build`; record initial JS transfer and the
  `player` / `yt-player` chunk sizes; assert no Video.js code in `main-*.js`.
- Encoder: run `tools/make-hls.sh` on a sample **with** an embedded subtitle
  track → `index.<lang>.vtt` exists and is valid WebVTT; on a sample **without**
  → no `.vtt`. Re-run it on a source whose `index.m3u8` already exists →
  the `.vtt` is added and `index.m3u8` is not rewritten.
- Worker (local `wrangler dev`, seeded lesson):
  - `listCourse` returns `subtitles` for the HLS lesson;
  - `GET /api/media/<lesson>/index.<lang>.vtt` returns `200`, `text/vtt`, and
    works without a `Range` header;
  - the admin file list shows one HLS row (no `.vtt`/`.ts`);
  - the scrape cap counts subtitle requests against the same lesson.
- Player, real browser (browser-use/CDP):
  - MP4 and HLS: clicking the PiP button **enters PiP and exits cleanly**; the
    button's mere visibility is not the test (it is already visible today).
  - HLS with a `.vtt`: on desktop, the captions button appears, the menu lists
    the language, and cues render on screen. At 390×844, subtitles are reachable
    through Settings → Captions.
  - YouTube: the skin bar is unchanged (one bar, no YouTube chrome); on a
    captioned video the captions button appears and its cues render over the
    video (already verified once; re-check after the change).
  - Layout at 1920×950, 1440×900, 1366×768, 900×800, 390×844; two-column layout
    intact; no horizontal overflow.
- Update `docs/CHANGELOG.md` and `docs/HANDOFF.md`, commit, and push to `main`.

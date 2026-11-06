# Lesson player PiP and subtitles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing picture-in-picture button actually work on self-hosted lessons, and carry each video's embedded subtitle tracks through the HLS pipeline into the Video.js skin's captions control.

**Architecture:** PiP is a one-attribute change in `src/app/player.ts`. Subtitles are sidecar `index.<lang>.vtt` files extracted by `tools/make-hls.sh`, served by the Worker as `text/vtt`, attached to the HLS lesson by `listCourse`, and rendered as light-DOM `<track>` children that `CustomMediaElement` clones into its internal `<video>`. YouTube lessons are untouched: their captions already flow through the adapter into the same skin.

**Tech Stack:** Angular 22 (standalone, signals, `@defer`), Cloudflare Worker (ES modules, R2, D1), Video.js 10 web components (`@videojs/html`, `@videojs/hlsjs-video`, `@videojs/youtube-video`), ffmpeg/ffprobe, bash.

**Spec:** `docs/superpowers/specs/2026-11-05-lesson-player-pip-resolution-subtitles-design.md`

## Global Constraints

- **No resolution selector and no encoder video-quality change.** Keep `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k`. R2 lessons stay a single full-resolution rendition.
- **YouTube lessons stay exactly as they are**: `<video-player><video-skin><youtube-video>`, our one control bar, no `controls` attribute, no YouTube chrome.
- **Subtitles are off by default.** No `default` on any `<track>`; no `cc_load_policy: 1`.
- **No auto-transcription and no upload UI.** Only tracks already inside the source video are carried.
- **Initial JS transfer must not grow.** Video.js stays out of `main-*.js`; only the lazy `player` chunk may change. Baseline to compare against: **66.5 kB** initial transfer at `593c928`.
- **`.vtt` is a sidecar, not a lesson.** It must not create a course lesson, must not inflate the scrape cap, and must be served without a `Range` header.
- **Worker media protections must still hold:** same-origin `Sec-Fetch-*`, `Sec-Fetch-Dest: track` accepted, cross-site/direct requests refused.
- **Moving watermark, loading cover, `@defer` lazy players, admin/PDF/panel/layout behaviour** are unchanged.
- **No new dependencies and no new cost.**
- **No test framework exists and none may be added.** Verification is `npm run typecheck`, `npm run build`, built-output checks, shell checks, and real-browser checks.
- **Direct commits and pushes to `main` are authorized.** Push triggers the Cloudflare deploy.

## Review Focus

1. **Two subtitle tracks with the same language** (e.g. two `eng` tracks): the encoder must write `index.eng.vtt` and `index.eng.2.vtt` (never overwrite one with the other), a re-run must produce the same two filenames, the Worker must attach both, and the player must render two selectable tracks with non-identical labels.
2. **Unknown or three-letter language tags** (`und`, `eng`, `EN-US`): the file name must still match the Worker regex, `srclang` must be a usable tag, and the label must fall back to something readable rather than `undefined` or empty.
3. **A lesson with no subtitles** (raw MP4, HLS encoded from a source without subtitle streams, YouTube video without captions): no empty captions button, no console error, playback unchanged.
4. **A `.vtt` request from outside the site or with no `Sec-Fetch-*` headers**: still `403`; and when a *student* opens a lesson, that lesson's `index.m3u8` and all its `.vtt` count as **one** distinct lesson for the scrape cap, not several.
5. **PiP requested without user activation** (programmatic `click()`, or a browser that refuses): no uncaught rejection, no broken player; a real click enters PiP, `exitPictureInPicture()` returns to the same playback position.

---

### Task 1: Enable picture-in-picture on self-hosted lessons

**Files:**
- Modify: `src/app/player.ts:22` (HLS branch), `src/app/player.ts:37` (native branch)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new; the existing `<media-pip-button>` in `video-skin` becomes functional.

- [ ] **Step 1: Remove `disablepictureinpicture` from both media branches**

Delete the `disablepictureinpicture` attribute line from the `<hlsjs-video>` element and from the `<video>` element. Change nothing else in the template (keep `controlslist="nodownload noremoteplayback"`, `playsinline`, `autoplay`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit code 0, no output.

- [ ] **Step 3: Build and confirm the attribute is gone from the output**

Run:
```bash
npm run build
grep -rn "disablepictureinpicture" src/app/player.ts || echo 'source clean'
grep -l "disablepictureinpicture" dist/web/browser/*.js || echo 'build clean'
gzip -c dist/web/browser/main-*.js | wc -c
```
Expected: `Application bundle generation complete.`; `source clean`; `build clean`; and the gzip byte count for `main-*.js` — **record this number**, it must be unchanged in Task 4.

- [ ] **Step 4: Verify PiP in a real browser (MP4 and HLS)**

Start `npx wrangler dev --port 8787` (serves `dist/web/browser`) and use browser-use/CDP at `http://localhost:8787`.

For an MP4 lesson and separately for an HLS lesson, after the lesson is playing:
```python
# locate the button in the skin's shadow root, then click with a *trusted* event
box = ev("""(()=>{const b=document.querySelector('video-skin').shadowRoot
  .querySelector('media-pip-button').getBoundingClientRect();
  return {x:Math.round(b.x+b.width/2), y:Math.round(b.y+b.height/2)}})()""")
cdp("Input.dispatchMouseEvent", type="mousePressed", x=box["x"], y=box["y"], button="left", clickCount=1)
cdp("Input.dispatchMouseEvent", type="mouseReleased", x=box["x"], y=box["y"], button="left", clickCount=1)
```
Expected: `document.pictureInPictureElement !== null`, and the picture-in-picture window shows the lesson's video. Then `await document.exitPictureInPicture()` → `document.pictureInPictureElement === null` and playback continues from the same time (within ~1 s).

- [ ] **Step 5: Verify the no-activation edge does not break the player (Review Focus 5)**

In the same page, call `document.querySelector('video-skin').shadowRoot.querySelector('media-pip-button').click()` (programmatic, no user activation), then wait 2 s.
Expected: `document.pictureInPictureElement === null`; the lesson still plays and the button still works on the next real click. The installed skin routes the click through an action wrapper that ignores the rejection (`@videojs/core/dom/media-actions.js` uses `ignoreRejection`), so no uncaught `NotAllowedError` should appear; if one does, catch it at the call site before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/app/player.ts
git commit -m "feat(player): enable picture-in-picture for self-hosted lessons"
```

---

### Task 2: Extract embedded subtitles to WebVTT in the encoder

**Files:**
- Modify: `tools/make-hls.sh:7-13`

**Interfaces:**
- Consumes: nothing.
- Produces: for a source `videos/<Section>/<Lesson>.mp4`, files `hls/<Section>/<Lesson>/index.<lang>[.<n>].vtt`. `<lang>` is the probe tag lowercased and reduced to `[a-z0-9-]`, or `und` when absent; the first duplicate gets no suffix and later duplicates get `.2`, `.3`, ….

- [ ] **Step 1: Add the extraction function and run it before the "already encoded" skip**

Replace the loop body so it reads exactly:

```bash
# Extracts embedded subtitle tracks to WebVTT next to the playlist. Runs before the
# "already encoded" skip so a re-run adds subtitles without re-encoding the video.
subs() {
  local f="$1" dest="$2" lang used n idx codec tag
  declare -A seen=()
  while IFS='|' read -r idx codec tag; do
    case "$codec" in
      hdmv_pgs_subtitle|dvd_subtitle|dvb_*|xsub) echo "  skip bitmap subtitle #$idx"; continue ;;
    esac
    lang="$(printf '%s' "$tag" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')"
    [ -n "$lang" ] || lang=und
    n=$(( ${seen[$lang]:-0} + 1 )); seen[$lang]=$n
    used="$dest/index.$lang.vtt"
    [ "$n" -gt 1 ] && used="$dest/index.$lang.$n.vtt"
    echo "  subtitle #$idx -> ${used#*/}"
    ffmpeg -nostdin -loglevel error -y -i "$f" -map "0:$idx" -c:s webvtt "$used"
  done < <(ffprobe -v error -select_streams s -show_entries stream=index,codec_name:stream_tags=language -of csv=p=0 "$f" | awk -F, '{print $1"|"$2"|"$3}')
}

find "$src" -type f \( -iname '*.mp4' -o -iname '*.mkv' -o -iname '*.mov' -o -iname '*.webm' \) -print0 |
while IFS= read -r -d '' f; do
  rel="${f#"$src"/}"; dest="$out/${rel%.*}"; mkdir -p "$dest"
  subs "$f" "$dest"
  [ -f "$dest/index.m3u8" ] && { echo "skip $rel"; continue; }
  echo "convert $rel"
  ffmpeg -nostdin -loglevel error -y -i "$f" -sn -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k \
    -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_filename "$dest/seg_%04d.ts" "$dest/index.m3u8"
done
```

`-sn` matters: without it, ffmpeg's automatic stream selection includes a subtitle stream on sources that have one, and the HLS muxer writes stray `index0.vtt` and `index_vtt.m3u8` files into the lesson folder.

- [ ] **Step 2: Build fixtures with and without subtitle tracks**

```bash
rm -rf /tmp/opencode/subtest && mkdir -p /tmp/opencode/subtest/videos/TestPlayerPip/'Week 1' /tmp/opencode/subtest/videos/TestPlayerPip/'Week 1'/NoSubs
cd /tmp/opencode/subtest
printf '1\n00:00:00,000 --> 00:00:20,000\nHello\n' > a.srt
cp a.srt b.srt
# two subtitle tracks, both tagged eng (the collision case)
ffmpeg -nostdin -loglevel error -y -f lavfi -i testsrc=size=160x90:rate=15 -f lavfi -i sine \
  -i a.srt -i b.srt -map 0:v -map 1:a -map 2:s -map 3:s \
  -c:v libx264 -preset ultrafast -c:a aac -c:s mov_text \
  -metadata:s:s:0 language=eng -metadata:s:s:1 language=eng -t 20 \
  videos/TestPlayerPip/'Week 1'/'Lesson 1.mp4'
# a source with no subtitle stream
ffmpeg -nostdin -loglevel error -y -f lavfi -i testsrc=size=160x90:rate=15 -f lavfi -i sine \
  -map 0:v -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 20 \
  'videos/TestPlayerPip/Week 1/NoSubs/Lesson 2.mp4'
ffprobe -v error -select_streams s -show_entries stream=index,codec_name:stream_tags=language -of csv=p=0 videos/TestPlayerPip/'Week 1'/'Lesson 1.mp4'
```
Expected probe output: `2,mov_text,eng` and `3,mov_text,eng`.

- [ ] **Step 3: Run the encoder and check the outputs**

```bash
bash /home/taxin/Work/course-site/tools/make-hls.sh videos hls
find hls -type f | sort
head -1 "hls/TestPlayerPip/Week 1/Lesson 1/index.eng.vtt"
head -1 "hls/TestPlayerPip/Week 1/Lesson 1/index.eng.2.vtt"
find "hls/TestPlayerPip/Week 1/NoSubs" -name '*.vtt' | wc -l
find hls \( -name 'index0.vtt' -o -name 'index_vtt.m3u8' \) | wc -l
```
Expected: exactly `index.m3u8`, `seg_0000.ts`…`seg_0003.ts` (4 segments), `index.eng.vtt`, `index.eng.2.vtt` for `Lesson 1`; both `.vtt` files start with `WEBVTT`; the NoSubs count is `0`; the stray-file count is `0`.

- [ ] **Step 4: Re-run the encoder and prove it is a no-op for the video (Review Focus 1)**

```bash
before=$(stat -c %Y "hls/TestPlayerPip/Week 1/Lesson 1/index.m3u8")
sleep 1
bash /home/taxin/Work/course-site/tools/make-hls.sh videos hls
after=$(stat -c %Y "hls/TestPlayerPip/Week 1/Lesson 1/index.m3u8")
[ "$before" = "$after" ] && echo 'm3u8 untouched'
find hls -name '*.vtt' | sort
```
Expected: `skip TestPlayerPip/Week 1/Lesson 1.mp4`; `m3u8 untouched`; the same two `.vtt` files, with **no** `index.eng.3.vtt` or other extra suffix.

- [ ] **Step 5: Commit**

```bash
git add tools/make-hls.sh
git commit -m "feat(tools): extract embedded subtitle tracks to WebVTT"
```

---

### Task 3: Serve and attach sidecar subtitles in the Worker

**Files:**
- Modify: `worker/index.js:150` (`MEDIA_TYPES`), `worker/index.js:274` (`lessonOf`), `worker/index.js:165-214` (`listCourse`), `worker/index.js:307` (`serve` allowed extensions)
- Modify: `worker/files.js:62`

**Interfaces:**
- Consumes: `index.<lang>[.<n>].vtt` files from Task 2.
- Produces: the course JSON lesson object gains `subtitles?: { key: string; lang: string }[]`, sorted by `lang` then `key`. `lang` is the regex group (no `.n` suffix).

- [ ] **Step 1: Add the MIME type and allow the extension**

In `worker/index.js`, add `vtt: 'text/vtt'` to `MEDIA_TYPES`, change the `serve` guard to
`/\.(m3u8|ts|pdf|mp4|webm|mkv|mov|avi|m4v|vtt)$/i.test(key)`, and change `lessonOf` to
`/\.(m3u8|ts|vtt)$/i.test(key)`.

- [ ] **Step 2: Attach `.vtt` files to their HLS lesson in `listCourse`**

Immediately after the `keys` collection loop, build the map:

```js
  // Sidecar subtitles: <Lesson>/index.<lang>[.<n>].vtt belongs to that folder's HLS lesson.
  const subtitleMap = new Map();
  for (const key of keys) {
    const m = /^(.+)\/index\.([a-z0-9]+(?:-[a-z0-9]+)*)(?:\.\d+)?\.vtt$/.exec(key);
    if (!m) continue;
    if (!subtitleMap.has(m[1])) subtitleMap.set(m[1], []);
    subtitleMap.get(m[1]).push({ key, lang: m[2] });
  }
```

Then replace the lesson push inside the main loop with:

```js
    const lesson = { id: key, title, kind: pdf ? 'pdf' : 'video' };
    if (file === 'index.m3u8') {
      const subs = subtitleMap.get(key.slice(0, key.lastIndexOf('/')));
      if (subs) lesson.subtitles = subs.sort((a, b) => NUM.compare(a.lang, b.lang) || NUM.compare(a.key, b.key));
    }
    secs.get(sectionName).push(lesson);
```

`.vtt` keys never reach this loop as lessons: they are neither `pdf` nor `VIDEO_EXT`.

- [ ] **Step 3: Hide `.vtt` rows in the admin file manager**

In `worker/files.js`, change the `.ts` skip to `/\.(ts|vtt)$/i.test(name)` and update the comment to say both are parts of the HLS lesson, not rows of their own.

- [ ] **Step 4: Seed local objects and restart the dev server**

```bash
mkdir -p /tmp/opencode/subs-seed
printf 'WEBVTT\n\n00:00.000 --> 00:05.000\nHello\n' > /tmp/opencode/subs-seed/index.en.vtt
printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n' > /tmp/opencode/subs-seed/index.m3u8
cd /home/taxin/Work/course-site
npx wrangler r2 object put "<bucket-name>/TestPlayerPip/Week 1/Lesson 1/index.m3u8" --file /tmp/opencode/subs-seed/index.m3u8 --local
npx wrangler r2 object put "<bucket-name>/TestPlayerPip/Week 1/Lesson 1/index.en.vtt" --file /tmp/opencode/subs-seed/index.en.vtt --local
npx wrangler r2 object put "<bucket-name>/TestPlayerPip/Week 1/Orphan/index.en.vtt" --file /tmp/opencode/subs-seed/index.en.vtt --local
npx wrangler r2 object put "<bucket-name>/TestPlayerPip/Week 1/Other/index.m3u8" --file /tmp/opencode/subs-seed/index.m3u8 --local
```
Restart `npx wrangler dev --port 8787` so the 60-second `listCourse` cache is empty.

- [ ] **Step 5: Check the course payload**

```bash
curl -sS -c /tmp/opencode/cj -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"localdevpass1234"}' \
  http://localhost:8787/api/login
curl -sS -b /tmp/opencode/cj http://localhost:8787/api/course | python3 -c '
import json,sys
for c in json.load(sys.stdin):
    if c["title"] != "TestPlayerPip": continue
    for s in c["sections"]:
        for l in s["lessons"]:
            print(s["title"], "|", l["id"], "|", l.get("subtitles"))
'
```
Expected: `{"ok":true}` from login; a `Week 1 | TestPlayerPip/Week 1/Lesson 1/index.m3u8 | [{'key': 'TestPlayerPip/Week 1/Lesson 1/index.en.vtt', 'lang': 'en'}]` row and a `Week 1 | TestPlayerPip/Week 1/Other/index.m3u8 | None` row. **No `Orphan` row** (a folder with only `.vtt` is not a lesson).

- [ ] **Step 6: Check the `.vtt` route, the protection, and the admin listing**

```bash
curl -sS -o /dev/null -D - -b /tmp/opencode/cj \
  -H 'sec-fetch-site: same-origin' -H 'sec-fetch-dest: track' \
  'http://localhost:8787/api/media/TestPlayerPip/Week%201/Lesson%201/index.en.vtt'
curl -sS -o /dev/null -w 'no-fetch-headers: %{http_code}\n' -b /tmp/opencode/cj \
  'http://localhost:8787/api/media/TestPlayerPip/Week%201/Lesson%201/index.en.vtt'
curl -sS -b /tmp/opencode/cj \
  'http://localhost:8787/api/admin/files?prefix=TestPlayerPip%2FWeek%201%2FLesson%201' | python3 -m json.tool
```
Expected: the first response is `200`, `content-type: text/vtt`, `content-disposition: inline` — with **no** `Range` request header sent. The second prints `no-fetch-headers: 403`. The admin listing shows only `index.m3u8` (no `.vtt`).

- [ ] **Step 7: Verify the scrape cap counts a lesson's subtitles with the lesson (Review Focus 4)**

```bash
curl -sS -b /tmp/opencode/cj -H 'content-type: application/json' \
  -d '{"email":"pip-test@example.com","password":"testpass1234","courses":["TestPlayerPip"]}' \
  http://localhost:8787/api/admin/users
curl -sS -c /tmp/opencode/cj2 -H 'content-type: application/json' \
  -d '{"email":"pip-test@example.com","password":"testpass1234"}' \
  http://localhost:8787/api/login
```
Add `MAX_LESSONS_PER_HOUR=1` for this run by restarting the dev server with
`npx wrangler dev --port 8787 --var MAX_LESSONS_PER_HOUR:1` (no `.dev.vars` edit), then with the student cookie:

```bash
for u in "TestPlayerPip/Week%201/Lesson%201/index.m3u8" \
         "TestPlayerPip/Week%201/Lesson%201/index.en.vtt" \
         "TestPlayerPip/Week%201/Other/index.m3u8"; do
  curl -sS -o /dev/null -w "$u -> %{http_code}\n" -b /tmp/opencode/cj2 \
    -H 'sec-fetch-site: same-origin' -H 'sec-fetch-dest: track' \
    "http://localhost:8787/api/media/$u"
done
```
Expected: `200`, `200`, `429`. After the check, restart the dev server **without** `--var` so the default cap is back.

- [ ] **Step 8: Commit**

```bash
git add worker/index.js worker/files.js
git commit -m "feat(worker): serve and attach sidecar WebVTT subtitles"
```

---

### Task 4: Show subtitles in the lesson player

**Files:**
- Modify: `src/app/api.ts:3-4` (add `Subtitle`, extend `Lesson`)
- Modify: `src/app/player.ts` (input, track list, template)
- Modify: `src/app/course.ts:97` (pass subtitles)

**Interfaces:**
- Consumes: `Lesson.subtitles?: { key: string; lang: string }[]` from Task 3.
- Produces: `export interface Subtitle { key: string; lang: string }`; `Player.subtitles = input<Subtitle[]>([])`.

- [ ] **Step 1: Add the shared type**

In `src/app/api.ts`:

```ts
export interface Subtitle { key: string; lang: string }
export interface Lesson { id: string; title: string; kind: 'video' | 'pdf' | 'youtube'; done: boolean; yt?: string; subtitles?: Subtitle[] }
```

- [ ] **Step 2: Add the input, the display label, and the `<track>` children**

In `src/app/player.ts`:

- import the type: `import { Api, Subtitle } from './api';`
- add `readonly subtitles = input<Subtitle[]>([]);`
- add these protected members:

```ts
  /** Same-origin URL for a sidecar track. */
  protected readonly mediaUrl = (key: string) => this.api.mediaUrl(key);

  /** Human language name; duplicates of the same language get a distinguishing ordinal. */
  protected readonly tracks = computed(() => {
    const seen = new Map<string, number>();
    return this.subtitles().map((s) => {
      const n = (seen.get(s.lang) ?? 0) + 1;
      seen.set(s.lang, n);
      const name = this.label(s.lang);
      return { ...s, label: n === 1 ? name : `${name} (${n})` };
    });
  });

  private label(lang: string): string {
    try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(lang) || lang.toUpperCase(); }
    catch { return lang.toUpperCase(); }
  }
```

- inside the `<hlsjs-video>` element **and** inside the `<video>` element, add:

```html
              @for (t of tracks(); track t.key) {
                <track kind="subtitles" [attr.src]="mediaUrl(t.key)" [attr.srclang]="t.lang" [attr.label]="t.label" />
              }
```

No `default` attribute: the skin lists the tracks and leaves them off until the viewer chooses one.

- [ ] **Step 3: Pass the lesson's subtitles through**

In `src/app/course.ts`, change the self-hosted player line to:

```html
                    <app-player [key]="l.id" [subtitles]="l.subtitles ?? []" (ended)="finish(l)" />
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both exit 0, `Application bundle generation complete.`

- [ ] **Step 5: Confirm the initial bundle did not grow**

```bash
gzip -c dist/web/browser/main-*.js | wc -c
grep -o "hlsjs\|video-player\|text/vtt" dist/web/browser/main-*.js | wc -l
```
Expected: gzip bytes **identical** to the number recorded in Task 1 Step 3 (`main-*.js` is not edited by this task), and `0` matches in `main-*.js`.

- [ ] **Step 6: Upload the real HLS fixture and verify in a real browser**

```bash
cd /home/taxin/Work/course-site
for f in /tmp/opencode/subtest/hls/TestPlayerPip/'Week 1'/'Lesson 1'/*; do
  npx wrangler r2 object put "<bucket-name>/TestPlayerPip/Week 1/Lesson 1/$(basename "$f")" --file "$f" --local
done
```
Restart `wrangler dev` (the build from Step 4 is already in `dist/web/browser`), reload the app at `http://localhost:8787`, open `TestPlayerPip` → `Week 1` → `Lesson 1`.

Expected, in order:
1. **Off by default:** every entry in `document.querySelector('hlsjs-video').textTracks` (or the internal `<video>`'s `textTracks`) has `mode === 'disabled'` on load, and no cue is painted.
2. **Captions button visible** in our skin (not `hidden`) because tracks exist. Real-click it (trusted CDP input on the button's box in `video-skin`'s shadow root), then click the item labelled `English`.
3. `textTracks` now has exactly one track with `mode === 'showing'`, and a screenshot shows the `Hello` cue over the video, with our watermark and our single control bar still present.
4. The second track (`index.eng.2.vtt`) is labelled `English (2)` (Review Focus 1) and can be selected the same way.

- [ ] **Step 7: Verify the no-subtitle and mobile edges (Review Focus 2 and 3)**

- Open `NoSubs/Lesson 2` (HLS with no `.vtt`): the captions button is `hidden`, `textTracks.length === 0`, playback is unchanged, and the console has no errors.
- Emulate 390×844, open `Lesson 1`: the captions **button** is hidden, but the skin's settings menu still lists the captions entry `English`; selecting it sets `mode === 'showing'`. If the installed skin differs from this expectation, record the actual menu path in the commit message.
- Seed a label edge by adding `index.und.vtt` (same content) to local R2 for `Lesson 1`, then restart and reload:

```bash
printf 'WEBVTT\n\n00:00.000 --> 00:01.500\nHallo\n' > /tmp/opencode/und.vtt
cd /home/taxin/Work/course-site
npx wrangler r2 object put "<bucket-name>/TestPlayerPip/Week 1/Lesson 1/index.und.vtt" --file /tmp/opencode/und.vtt --local
```

Expected: the captions menu lists a third entry reading `Undetermined` (or `UND` if `Intl.DisplayNames` does not translate it) and it remains selectable — never blank or `undefined` (Review Focus 2). The existing `eng` fixture already proves a three-letter tag (`eng`) renders as `English`.

- [ ] **Step 8: Commit**

```bash
git add src/app/api.ts src/app/player.ts src/app/course.ts
git commit -m "feat(player): show lesson subtitle tracks"
```

---

### Task 5: Confirm YouTube is unchanged, update docs, and ship

**Files:**
- Modify: `docs/CHANGELOG.md` (new `### Added (players)` section under `## Unreleased`)
- Modify: `docs/HANDOFF.md` (decision-log row, a new `#### 4g. PiP and subtitles (added later)` section, Known limitations, "Last updated" line)

**Interfaces:**
- Consumes: everything above.
- Produces: the shippable state on `main`.

- [ ] **Step 1: Verify YouTube lessons are untouched (and captions still work)**

Add a temporary captioned YouTube lesson, open it, then delete it:

```bash
curl -sS -b /tmp/opencode/cj -H 'content-type: application/json' \
  -d '{"course":"TestPlayerPip","folder":"Week 1","lesson":"YouTube Captions","link":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}' \
  http://localhost:8787/api/admin/youtube
```
In the browser, open that lesson and check: exactly **one** control bar (ours), **no** YouTube title strip/logo/Share/"Watch on YouTube", the moving watermark present, autoplay + loading cover behave as before, and — once the adapter reports its tracks — the captions button appears and selecting `English` paints the cue over the video (already verified once during design; re-check after the change).

```bash
curl -sS -b /tmp/opencode/cj -H 'content-type: application/json' -X DELETE \
  -d '{"id":"TestPlayerPip/Week 1/YouTube Captions"}' http://localhost:8787/api/admin/youtube
```

- [ ] **Step 2: Run the full layout matrix**

At 1920×950, 1440×900, 1366×768, 900×800 and 390×844, for a video lesson:
```js
document.documentElement.scrollWidth <= innerWidth
```
Expected: `true` at every size; the two-column layout at ≥1100 px; single column below; the player never taller than the viewport; no captions/watermark overlap after enabling subtitles.

- [ ] **Step 3: Re-run the compile and output gates**

```bash
npm run typecheck
npm run build
gzip -c dist/web/browser/main-*.js | wc -c
grep -l "hlsjs\|video-player" dist/web/browser/main-*.js || echo 'no Video.js in main'
ls -l dist/web/browser/*player*.js dist/web/browser/*yt-player*.js 2>/dev/null
```
Expected: typecheck and build clean; main gzip ≤ 66.5 kB; `no Video.js in main`; the `player`/`yt-player` chunk sizes are recorded in the commit message.

- [ ] **Step 4: Update the docs**

`docs/CHANGELOG.md`, under `## Unreleased`, add an `### Added (players)` section covering: PiP works on self-hosted lessons (MP4 + HLS) via the skin's own button; `tools/make-hls.sh` extracts embedded text subtitle tracks to `index.<lang>.vtt` (before the skip guard, `-sn` on the video encode); the Worker serves `.vtt` as `text/vtt`, attaches them to the HLS lesson, hides them in the admin list, and counts them with the lesson for the scrape cap; captions are off by default; YouTube captions already worked through our skin and are unchanged; no resolution selector and no encoder quality change. Include the measured bundle numbers and the browser checks.

`docs/HANDOFF.md`: add a decision-log row ("PiP and subtitle policy"), a `#### 4g. Picture-in-picture and subtitles (added later)` section with the file names/contracts, extend Known limitations with: no resolution selector; PiP unsupported on YouTube and the watermark absent in PiP; existing HLS lessons need the **original source** plus an encoder re-run to gain `.vtt`; raw MP4/MKV lessons get no subtitles; bitmap subtitles skipped; phones use Settings → Captions. Update the "Last updated after …" sentence.

- [ ] **Step 5: Commit and push**

```bash
git add docs/CHANGELOG.md docs/HANDOFF.md docs/superpowers/specs/2026-11-05-lesson-player-pip-resolution-subtitles-design.md docs/superpowers/plans/2026-11-05-lesson-player-pip-and-subtitles.md
git commit -m "docs: record PiP and sidecar subtitle support"
git push origin main
```
Expected: push succeeds; the Cloudflare deploy starts.

- [ ] **Step 6: Post-deploy smoke check**

After the deploy finishes, open `https://<your-site>.workers.dev`, load one self-hosted lesson, confirm the PiP button enters PiP, and confirm the console shows no errors. If the deployed course has no `.vtt` yet, record that as expected (the encoder must be re-run on the sources).

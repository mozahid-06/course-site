# Course Cards + Per-Course Descriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the course list into a responsive card grid and give each course an owner-written description, stored in D1 and edited from the file manager.

**Architecture:** A new D1 table `course_meta(course, description)` feeds a `description` field on the `/api/course` payload. `listCourse()` reads it; an admin route `POST /api/admin/files/description` writes it, and course rename/delete carry the row in the batches that already handle `enrollments`. The Angular course list renders a responsive grid of cards and shows the description as an intro at the course root; the file manager gains a per-course **Description** tool that reuses the existing dialog with a textarea.

**Tech Stack:** Cloudflare Worker + D1 + R2; Angular 22 standalone components + signals; one global `src/styles.css`; headless Chromium over CDP for verification.

**Spec:** `docs/superpowers/specs/2026-11-06-course-cards-and-descriptions-design.md`

## Global Constraints

- **No new dependency.** No test framework. Angular templates + the single `src/styles.css`; no per-component style files.
- **This repo has no test framework.** The TDD cycle is adapted: each task names the exact command and expected output *before* the change (red) and *after* it (green). Use `npm run typecheck`, `npm run build`, `npm run check:scripts`, `node --check worker/files.js`, a live `curl` smoke, and headless Chromium. Do not add a test framework.
- **Description is plain text**, trimmed, `\r\n` normalised to `\n`, capped at **2000** characters. Empty string clears it.
- **Descriptions are for courses only** — top-level folders (a path with no `/`), not sub-folders.
- **Card grid:** `repeat(auto-fill, minmax(460px, 1fr))` → 2-up on desktop, 1-up on phones; card `min-height:186px` at `1.25rem 1.4rem`; title on a single line, truncated with an ellipsis (`flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`), description clamped to 3 lines; course intro shown only at the course root (`path.length === 0`); whole card is the `<button>`. Sizes locked in from the approved static preview.
- **Do not touch** upload endpoints, Video.js internals, the watermark, or the Google sign-in flow (`renderButton` / callback / `loginGoogle`). The PDF.js toolbar is untouched.
- Direct commits and pushes to `main` are authorized. **Never sign out or modify the real owner account** (`you@example.com`); use the throwaway test admin.
- Follow the existing file-manager patterns: `.files-tool` buttons, the `.adm-dialog` / `.field` markup, `toast()`, `load()`, `ChangeDetectionStrategy.Eager`.

## Review Focus

1. **A description containing HTML or quotes must render as literal text.** A value like `<img src=x onerror=alert(1)>` or `"quotes" & <b>bold</b>` must appear verbatim in the card and the intro, with no element created from it (Angular interpolation escapes it; a bug would be binding by `innerHTML`).
2. **A very long / multi-line description must not break layout or storage.** 2100 characters are accepted and stored as exactly the first 2000; a value with `\n` keeps its line breaks (card clamps to 3 lines, intro uses `pre-wrap`).
3. **An empty course folder is not listed at all.** `listCourse` only builds a course from a PDF/video key or a YouTube row, so a folder holding only `.keep` has no card — a description set for it is stored but invisible until it has a lesson. This must not error.
4. **Renaming a course carries its description; renaming one without a description must not error.**
5. **Deleting a course removes its `course_meta` row**, so a later course with the same name starts with a clean (empty) description.

Each is pinned to the task that owns the code, below.

---

### Task 1: Worker — description storage, payload field, write route, lifecycle

**Files:**
- Modify: `worker/index.js` (`SCHEMA`; `listCourse()`; `/api/course`)
- Modify: `worker/files.js` (`setCourseDescription`; the route in `handleFiles`; `moveEntry`; `deleteEntry`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - D1 table `course_meta(course TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '')`.
  - `listCourse(env)` returns `{ title: string, description: string, sections: Section[] }` per course.
  - `GET /api/course` — each course object gains `description: string`.
  - `POST /api/admin/files/description` body `{ course: string, description: string }` → `{ ok: true, course: string, description: string }`; 400 `{ error }` when `course` is empty or contains `/`.

- [ ] **Step 1: Baseline (red) — the field and route do not exist yet**

Create the throwaway test admin and a cookie (never the real owner):

```bash
cd /home/taxin/Work/course-site
PASS=$(node -e 'const e=new TextEncoder();const b=x=>Buffer.from(x).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");(async()=>{const pw="UiTest-Pass-123!";const salt=crypto.getRandomValues(new Uint8Array(16));const k=await crypto.subtle.importKey("raw",e.encode(pw),"PBKDF2",false,["deriveBits"]);const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:100000},k,256);console.log(b(salt)+"."+b(bits));})();')
npx wrangler d1 execute course-db --remote --command "DELETE FROM users WHERE email='uitest-tmp@example.com'; INSERT INTO users (email, pass, is_admin) VALUES ('uitest-tmp@example.com', '$PASS', 1)"
COOKIE=$(curl -s -i -X POST https://<your-site>.workers.dev/api/login -H 'content-type: application/json' -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
echo "cookie=${COOKIE:0:12}..."
curl -s https://<your-site>.workers.dev/api/course -H "cookie: s=$COOKIE" | grep -c '"description"'   # expect 0
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/description -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d '{}'   # expect a Not found error
```

Expected now: `0`, and an error (`{"error":"Not found"}` / 404). Store `$COOKIE` for Step 4.

- [ ] **Step 2: Add the table to `SCHEMA` in `worker/index.js`**

After the `content_order` entry (line ~63) add:

```js
  // Owner-written course descriptions, keyed by the top-level folder name (the course).
  "CREATE TABLE IF NOT EXISTS course_meta (course TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '')",
```

`ensureSchema` batches `SCHEMA` on first request, so the table is created with no separate migration.

- [ ] **Step 3: Read the description in `listCourse()` and expose it in `/api/course`**

In `listCourse`, after the `positions` map (line ~235) add:

```js
  const descriptions = new Map(
    (await env.DB.prepare('SELECT course, description FROM course_meta').all()).results
      .map((r) => [String(r.course), String(r.description ?? '')]),
  );
```

Change the return object (line ~256) to:

```js
    return { title: courseName, description: descriptions.get(courseName) || '', sections };
```

In the `/api/course` handler (line ~457) add the field to each course:

```js
        return json((await listCourse(env)).filter((c) => !mine || mine.has(c.title)).map((c) => ({
          title: c.title,
          description: c.description || '',
          sections: c.sections.map((s) => ({
            title: s.title,
            lessons: s.lessons.map((l) => ({ ...l, done: w.has(l.id) })),
          })),
        })));
```

- [ ] **Step 4: Add the write route in `worker/files.js`**

Add the function near `createFolder` (before `handleFiles`):

```js
const DESC_MAX = 2000;
/** Sets (or clears) the description shown for a course, keyed by its top-level folder name. */
async function setCourseDescription(env, rawCourse, rawDescription, hooks) {
  const course = cleanPath(rawCourse);
  if (course === null || !course || course.includes('/')) return bad('That is not a course name');
  const description = typeof rawDescription === 'string'
    ? rawDescription.replace(/\r\n/g, '\n').trim().slice(0, DESC_MAX)
    : '';
  await env.DB.prepare(
    'INSERT INTO course_meta (course, description) VALUES (?, ?) ON CONFLICT(course) DO UPDATE SET description = excluded.description',
  ).bind(course, description).run();
  hooks.invalidate();
  return json({ ok: true, course, description });
}
```

In `handleFiles`, after the `/api/admin/files/order` route (line ~632) add:

```js
  if (path === '/api/admin/files/description' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    return setCourseDescription(env, b.course, b.description, hooks);
  }
```

- [ ] **Step 5: Carry the row through rename and delete**

In `moveEntry`, fold the `course_meta` rename into the existing `enrollments` block (line ~355):

```js
  if (!single && !from.includes('/')) {
    statements.push(env.DB.prepare('UPDATE OR REPLACE enrollments SET course = ? WHERE course = ?').bind(to, from));
    statements.push(env.DB.prepare('UPDATE OR REPLACE course_meta SET course = ? WHERE course = ?').bind(to, from));
  }
```

(`moveEntry` already refuses to move a course into another course, so a top-level `from` always has a top-level `to`.)

In `deleteEntry`, fold the `course_meta` delete into the existing `enrollments` block (line ~443):

```js
  // A deleted course must not keep granting access to nothing, nor keep a description.
  if (!single && !p.includes('/')) {
    statements.push(env.DB.prepare('DELETE FROM enrollments WHERE course = ?').bind(p));
    statements.push(env.DB.prepare('DELETE FROM course_meta WHERE course = ?').bind(p));
  }
```

- [ ] **Step 6: Static checks**

```bash
cd /home/taxin/Work/course-site
node --check worker/files.js
npm run typecheck
npm run check:scripts
```

Expected: all exit 0.

- [ ] **Step 7: Deploy**

```bash
cd /home/taxin/Work/course-site
npm run deploy
```

Expected: `Done. https://<your-site>.workers.dev`.

- [ ] **Step 8: Green — exercise the whole lifecycle with a throwaway course**

```bash
cd /home/taxin/Work/course-site
COOKIE=$(curl -s -i -X POST https://<your-site>.workers.dev/api/login -H 'content-type: application/json' -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
C='zz-desc-test'
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/folder -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"path\":\"$C\"}"; echo
curl -s -X POST https://<your-site>.workers.dev/api/admin/youtube -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"course\":\"$C\",\"folder\":\"\",\"lesson\":\"Intro\",\"link\":\"https://youtu.be/dQw4w9WgXcQ\"}"; echo
# Review Focus 3: an empty folder is not a course.
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/folder -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d '{"path":"zz-empty-test"}' >/dev/null
curl -s https://<your-site>.workers.dev/api/course -H "cookie: s=$COOKIE" | grep -c 'zz-empty-test'            # expect 0
# write + read
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/description -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"course\":\"$C\",\"description\":\"Line one\\nLine two & <b>x</b>\"}"; echo
curl -s https://<your-site>.workers.dev/api/course -H "cookie: s=$COOKIE" | grep -o 'zz-desc-test[^}]*' | head -c 200; echo
# Review Focus 2: the 2000-char cap.
LONG=$(node -e 'process.stdout.write("x".repeat(2100))')
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/description -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"course\":\"$C\",\"description\":\"$LONG\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("stored length:", JSON.parse(s).description.length))'
# Review Focus 4: rename carries the description.
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/move -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"from\":\"$C\",\"to\":\"zz-desc-test-2\",\"kind\":\"folder\"}"; echo
npx wrangler d1 execute course-db --remote --command "SELECT course, length(description) AS n FROM course_meta WHERE course LIKE 'zz-desc-test%'"
# Review Focus 5: delete removes the row.
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/delete -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d '{"path":"zz-desc-test-2"}'; echo
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/delete -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d '{"path":"zz-empty-test"}' >/dev/null
npx wrangler d1 execute course-db --remote --command "SELECT COUNT(*) AS left_rows FROM course_meta WHERE course LIKE 'zz-%'"
```

Expected: folder `{"ok":true}`; the YouTube add `{...}`; empty-folder grep `0`; the description write echoes `"description":"Line one\nLine two & <b>x</b>"`; the course read shows that description; the long write prints `stored length: 2000`; the 2-row `course_meta` select shows only `zz-desc-test-2` with `n = 2000`; both deletes `{"ok":true,...}`; `left_rows` `0`.

- [ ] **Step 9: Commit and push**

```bash
cd /home/taxin/Work/course-site
git add worker/index.js worker/files.js
git commit -m "feat(courses): store a per-course description

Add a course_meta table keyed by the course (top-level folder) and attach
its description to the /api/course payload. An admin route
POST /api/admin/files/description writes it (plain text, trimmed to 2000
chars, empty clears). Course rename updates the key and course delete
drops the row, in the same D1 batches that already handle enrollments.

Verified against the deployed Worker with a throwaway course: write/read,
the 2000-char cap, rename carries the row, delete removes it, and an empty
folder is not listed as a course."
git push origin main
```

---

### Task 2: Frontend — the card grid and the description display

**Files:**
- Modify: `src/app/api.ts` (`CourseData`)
- Modify: `src/app/course.ts` (course list markup; course intro)
- Modify: `src/styles.css` (`.cards`, `.course-card`, `.course-intro`; remove `.course-item`)

**Interfaces:**
- Consumes: `GET /api/course` now returns `description` per course (Task 1).
- Produces: `interface CourseData { title: string; description: string; sections: Section[] }`; card markup classes `.course-card`, `.card-head`, `.card-title`, `.card-desc`, `.card-foot`, `.card-meta-row`, `.card-cta`; `.course-intro`. Task 3 relies on `CourseData.description`.

- [ ] **Step 1: Baseline (red) — the bundle still ships rows**

```bash
cd /home/taxin/Work/course-site
npm run build >/dev/null 2>&1
grep -c "course-item" dist/web/browser/main-*.js   # expect >= 1
grep -c "course-card" dist/web/browser/main-*.js   # expect 0
```

- [ ] **Step 2: Add `description` to `CourseData`**

In `src/app/api.ts` (line 6):

```ts
export interface CourseData { title: string; description: string; sections: Section[] }
```

Only `api.ts` builds course objects (from the server, and by spreading in `setDone`), so no other literal needs the new field.

- [ ] **Step 3: Replace the course rows with cards in `src/app/course.ts`**

Replace the `@else` block in the template (lines ~125–144) with:

```html
        } @else {
          <div class="list cards">
            <h1 class="page-title">Courses</h1>
            @for (c of courseCards(); track c.title) {
              <button class="course-card" (click)="openCourse(c)">
                <span class="card-head">
                  <span class="row-glyph" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" /></svg>
                  </span>
                  <span class="card-title">{{ c.title }}</span>
                </span>
                @if (c.description) { <span class="card-desc">{{ c.description }}</span> }
                <span class="card-foot">
                  @if (courseTotal(c)) {
                    <span class="course-bar" aria-hidden="true"><i [style.width.%]="coursePercent(c)"></i></span>
                  }
                  <span class="card-meta-row">
                    <span class="row-meta">{{ courseDone(c) }}/{{ courseTotal(c) }} lessons</span>
                    <span class="card-cta">{{ courseDone(c) ? 'Continue' : 'Start' }}</span>
                  </span>
                </span>
              </button>
            } @empty {
              <p class="empty">No courses yet.</p>
            }
          </div>
        }
```

- [ ] **Step 4: Add the course intro under the breadcrumb**

In the `@if (v.kind === 'browser')` breadcrumb block (ends `</nav>` at line ~38), add after `</nav>`:

```html
            @if (!v.path.length && activeCourse()?.description) {
              <p class="course-intro">{{ activeCourse()!.description }}</p>
            }
```

`activeCourse()` already exists and tracks the open course live.

- [ ] **Step 5: Restyle in `src/styles.css`**

Replace the `.course-item` rules (lines ~153–159) with the grid and card rules:

```css
.list.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(460px,1fr));gap:1.1rem;max-width:1240px;align-content:start}
.cards .page-title{grid-column:1/-1;margin-bottom:.4rem}
.cards .empty{grid-column:1/-1}
.course-card{display:flex;flex-direction:column;gap:.8rem;min-height:186px;padding:1.25rem 1.4rem;width:100%;text-align:left;color:inherit;background:var(--surface);border:1px solid var(--border);border-radius:12px;transition:border-color .12s,background .12s}
.course-card:hover:not(:disabled),.course-card:focus-visible{background:var(--hover);border-color:var(--primary)}
.course-card .card-head{display:flex;align-items:center;gap:.7rem}
.course-card .row-glyph{width:20px;height:20px}
.course-card .row-glyph svg{width:20px;height:20px;stroke-width:1.7}
.course-card .card-title{flex:1;min-width:0;font-size:17px;font-weight:600;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.course-card .card-desc{color:var(--muted);font-size:14px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-line}
.course-card .card-foot{margin-top:auto;display:flex;flex-direction:column;gap:.6rem}
.course-card .course-bar{width:auto;height:5px}
.course-card .card-meta-row{display:flex;align-items:center;justify-content:space-between;gap:.6rem}
.course-card .row-meta{font-size:13px}
.course-card .card-cta{color:var(--primary);font-weight:600;font-size:14px}
.course-intro{color:var(--muted);font-size:13.5px;line-height:1.5;max-width:70ch;margin:.1rem 0 .4rem;white-space:pre-wrap}
```

Remove the two `.course-item` phone rules: line ~159 `@media(hover:none){.course-item .row-actions{opacity:1}}` and line ~513 `.course-item{padding:0 .4rem}`. Add `.cards{grid-template-columns:1fr;gap:.65rem}` to the `@media(max-width:760px)` block. Leave the `@media(max-width:560px){.course-bar{width:44px}}` rule — `.course-card .course-bar` has higher specificity and keeps the flexible bar.

- [ ] **Step 6: Static checks and the bundle flip**

```bash
cd /home/taxin/Work/course-site
npm run typecheck && npm run build && npm run check:scripts
grep -c "course-card" dist/web/browser/main-*.js   # expect >= 1
grep -c "course-item" dist/web/browser/main-*.js   # expect 0
```

- [ ] **Step 7: Deploy**

```bash
cd /home/taxin/Work/course-site
npm run deploy
```

- [ ] **Step 8: Build the headless harness (reused by Task 3)**

Write `/tmp/opencode/cdp.mjs`:

```js
// Minimal CDP driver for the live checks. Phone viewport (390x844).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export const BASE = 'https://<your-site>.workers.dev';
export const SHOTS = '/tmp/opencode/shots';

export async function connect(cookie = '') {
  mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn('/usr/bin/chromium', ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=9333','--user-data-dir=/tmp/opencode/chrome-profile','--window-size=390,844','about:blank'], { stdio: 'ignore' });
  process.on('exit', () => chrome.kill('SIGKILL'));
  let v; for (let i = 0; i < 60; i++) { try { v = await (await fetch('http://127.0.0.1:9333/json/version')).json(); break; } catch { await sleep(250); } }
  if (!v) throw new Error('no CDP');
  const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const events = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } else if (m.method) events.push(m.method); };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const goto = async (url) => { events.length = 0; await send('Page.navigate', { url }); for (let i = 0; i < 80; i++) { if (events.includes('Page.loadEventFired')) break; await sleep(100); } await sleep(400); };
  const waitFor = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await evalJs(`!!(${expr})`)) return true; await sleep(150); } return false; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  if (cookie) await send('Network.setCookie', { name: 's', value: cookie, domain: '<your-site>.workers.dev', path: '/', httpOnly: true, secure: true });
  return { send, evalJs, goto, waitFor, shot, close: () => { ws.close(); chrome.kill('SIGKILL'); } };
}
```

Write `/tmp/opencode/check-cards.mjs`:

```js
import { BASE, connect } from './cdp.mjs';
const cookie = process.env.CS_COOKIE;
const course = process.env.CS_COURSE;
const desc = process.env.CS_DESC;
const b = await connect(cookie);
await b.goto(BASE + '/');
if (!await b.waitFor(`document.querySelector('.course-card')`)) throw new Error('no cards rendered');
const cards = await b.evalJs(`[...document.querySelectorAll('.course-card')].map(c => ({ title: c.querySelector('.card-title')?.textContent.trim(), desc: c.querySelector('.card-desc')?.textContent.trim() ?? '', cta: c.querySelector('.card-cta')?.textContent.trim() }))`);
const mine = cards.find((c) => c.title === course);
if (!mine) throw new Error('throwaway card missing: ' + JSON.stringify(cards.map((c) => c.title)));
if (mine.desc !== desc) throw new Error('card description mismatch: ' + JSON.stringify(mine.desc));
if (!['Start', 'Continue'].includes(mine.cta)) throw new Error('bad cta: ' + mine.cta);
// Review Focus 1: the description is text, not markup.
if (await b.evalJs(`!!document.querySelector('.course-card .card-desc b, .course-card .card-desc img')`)) throw new Error('description rendered as markup');
// Open the course; the intro shows the description at the root.
await b.evalJs(`[...document.querySelectorAll('.course-card')].find(c => c.querySelector('.card-title')?.textContent.trim() === ${JSON.stringify(course)}).click()`);
if (!await b.waitFor(`document.querySelector('.course-intro')`)) throw new Error('no course intro');
const intro = await b.evalJs(`document.querySelector('.course-intro').textContent.trim()`);
if (intro !== desc) throw new Error('intro mismatch: ' + JSON.stringify(intro));
await b.shot('cards');
console.log('OK cards:', JSON.stringify(cards.map((c) => c.title)), '| intro:', JSON.stringify(intro.slice(0, 60)));
b.close();
```

- [ ] **Step 9: Green — cards and intro on the live site**

```bash
cd /home/taxin/Work/course-site
COOKIE=$(curl -s -i -X POST https://<your-site>.workers.dev/api/login -H 'content-type: application/json' -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
C='zz-cards-test'; DESC=$'First line\nSecond line <b>not bold</b> & "quoted"'
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/folder -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"path\":\"$C\"}" >/dev/null
curl -s -X POST https://<your-site>.workers.dev/api/admin/youtube -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"course\":\"$C\",\"folder\":\"\",\"lesson\":\"Intro\",\"link\":\"https://youtu.be/dQw4w9WgXcQ\"}" >/dev/null
node -e 'const d=process.argv[1];const c=process.argv[2];fetch("https://<your-site>.workers.dev/api/admin/files/description",{method:"POST",headers:{"content-type":"application/json",cookie:"s="+process.env.CS_COOKIE},body:JSON.stringify({course:c,description:d})}).then(r=>r.json()).then(r=>console.log("set:",r.ok))' "$DESC" "$C"
pkill -f "remote-deb""ugging-port=9333" 2>/dev/null; rm -rf /tmp/opencode/chrome-profile
CS_COOKIE="$COOKIE" CS_COURSE="$C" CS_DESC="$DESC" node /tmp/opencode/check-cards.mjs
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/delete -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"path\":\"$C\"}" >/dev/null
echo "cleaned"
```

Expected: `set: true`, then `OK cards: [...] | intro: "First line\nSecond line ..."`. A screenshot lands at `/tmp/opencode/shots/cards.png` — inspect it for the grid, the clamped description, and the intro. Then the throwaway course is deleted.

- [ ] **Step 10: Commit and push**

```bash
cd /home/taxin/Work/course-site
git add src/app/api.ts src/app/course.ts src/styles.css
git commit -m "feat(courses): show the course list as a card grid with descriptions

Replace the dense course rows with a responsive grid of cards: book glyph
and title, the owner-written description (clamped to 3 lines), then the
progress bar and a Start/Continue meta row. The description also renders
as an intro under the breadcrumb at the course root. CourseData gains the
description field the worker now sends.

Verified headlessly against the deployed Worker at phone size: the card
renders the description as text (no markup from an HTML-looking value), the
intro matches, and Start/Continue is present."
git push origin main
```

---

### Task 3: File manager — the Description tool and textarea dialog

**Files:**
- Modify: `src/app/api.ts` (`saveCourseDescription`)
- Modify: `src/app/admin-files.ts` (`Ask.lines`; the dialog textarea; the row tool; `askDescription`)

**Interfaces:**
- Consumes: `CourseData.description` (Task 2); `Api.courses()`; `POST /api/admin/files/description` (Task 1).
- Produces: `Api.saveCourseDescription(course: string, description: string): Promise<{ ok: true; course: string; description: string }>`; `Ask.lines?: number`.

- [ ] **Step 1: Baseline (red) — no description tool in the bundle**

```bash
cd /home/taxin/Work/course-site
npm run build >/dev/null 2>&1
grep -c 'title="Description"' dist/web/browser/main-*.js   # expect 0
```

- [ ] **Step 2: Add the `Api` method**

In `src/app/api.ts`, after `setFilePosition` (line ~170):

```ts
  /** Sets or clears the description shown for a course (its top-level folder name). */
  saveCourseDescription(course: string, description: string): Promise<{ ok: true; course: string; description: string }> {
    return this.req('admin/files/description', { course, description });
  }
```

- [ ] **Step 3: Let the shared dialog render a textarea**

In `src/app/admin-files.ts`, add an optional `lines` to `Ask`:

```ts
interface Ask {
  title: string;
  hint: string;
  label: string;
  confirm: string;
  danger: boolean;
  /** When set, the dialog renders a textarea with this many rows instead of one input. */
  lines?: number;
  run: (value: string) => Promise<unknown>;
}
```

In the ask dialog, replace the single `<input ... />` inside `@if (a.label)` (lines ~230–240) with:

```html
            @if (a.lines) {
              <textarea
                [rows]="a.lines"
                [value]="askValue()"
                (input)="askValue.set($any($event.target).value)"
                spellcheck="false"
              ></textarea>
            } @else {
              <input
                [value]="askValue()"
                (input)="askValue.set($any($event.target).value)"
                (keydown.enter)="runAsk()"
                autocomplete="off"
                spellcheck="false"
              />
            }
```

The global `textarea` rule in `styles.css` (line 63) already gives it the field look.

- [ ] **Step 4: Add the per-course Description tool**

In the `@else if (row.kind === 'folder')` tools branch (line ~179), before the Rename button, add — top-level folders only:

```html
                @if (!row.path.includes('/')) {
                  <button type="button" class="files-tool" title="Description" [attr.aria-label]="'Edit description for ' + row.name" (click)="askDescription(row.path)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16" /><path d="M4 11h16" /><path d="M4 16h10" /></svg>
                  </button>
                }
```

- [ ] **Step 5: Add `askDescription`**

Next to `askDelete` (line ~567):

```ts
  /** Course descriptions live in D1; the card, the intro and this dialog all read the same value. */
  protected askDescription(course: string): void {
    const current = this.api.courses().find((c) => c.title === course)?.description ?? '';
    this.openAsk({
      title: `About “${course}”`,
      hint: 'Shown on the course card and at the top of the course. Leave it empty to remove it.',
      label: 'Description',
      lines: 5,
      confirm: 'Save',
      danger: false,
      run: async (value) => { await this.api.saveCourseDescription(course, value); },
    }, current);
  }
```

`runAsk` already calls `api.init()` and `load()` after a successful save, so the card and the row refresh without further work.

- [ ] **Step 6: Static checks and the bundle flip**

```bash
cd /home/taxin/Work/course-site
npm run typecheck && npm run build && npm run check:scripts
grep -c 'title="Description"' dist/web/browser/main-*.js   # expect >= 1
```

- [ ] **Step 7: Deploy**

```bash
cd /home/taxin/Work/course-site
npm run deploy
```

- [ ] **Step 8: Green — drive the editor headlessly**

Write `/tmp/opencode/check-editor.mjs` (reuses `cdp.mjs` from Task 2):

```js
import { BASE, connect } from './cdp.mjs';
const cookie = process.env.CS_COOKIE;
const course = process.env.CS_COURSE;
const text = 'Edited from the file manager\nsecond line';
const b = await connect(cookie);
await b.goto(BASE + '/');
await b.waitFor(`document.querySelector('app-options-menu .icon-btn')`);
await b.evalJs(`document.querySelector('app-options-menu .icon-btn').click()`);
await b.waitFor(`[...document.querySelectorAll('[role=menu] button')].some(x => x.textContent.includes('Admin panel'))`);
await b.evalJs(`[...document.querySelectorAll('[role=menu] button')].find(x => x.textContent.includes('Admin panel')).click()`);
await b.waitFor(`document.querySelector('.admin')`);
await b.evalJs(`[...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Course files')?.click()`);
await b.waitFor(`document.querySelector('app-admin-files .files-row')`);
const opened = await b.evalJs(`(() => { const row = [...document.querySelectorAll('app-admin-files .files-row')].find(r => r.querySelector('.files-name')?.textContent.trim() === ${JSON.stringify(course)}); const btn = row?.querySelector('button[title="Description"]'); if (!btn) return false; btn.click(); return true; })()`);
if (!opened) throw new Error('no Description tool on the throwaway row');
await b.waitFor(`document.querySelector('.adm-dialog textarea')`);
await b.evalJs(`(() => { const ta = document.querySelector('.adm-dialog textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return ta.value; })()`);
await b.evalJs(`document.querySelector('.adm-dialog-foot button.p').click()`);
await b.waitFor(`document.querySelector('.toast')`);
await b.shot('editor');
const saved = await b.evalJs(`fetch('/api/course').then(r => r.json()).then(cs => cs.find(c => c.title === ${JSON.stringify(course)})?.description ?? null)`);
if (saved !== text) throw new Error('persisted mismatch: ' + JSON.stringify(saved));
console.log('OK editor:', JSON.stringify(saved));
b.close();
```

Run it:

```bash
cd /home/taxin/Work/course-site
COOKIE=$(curl -s -i -X POST https://<your-site>.workers.dev/api/login -H 'content-type: application/json' -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
C='zz-editor-test'
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/folder -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"path\":\"$C\"}" >/dev/null
curl -s -X POST https://<your-site>.workers.dev/api/admin/youtube -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"course\":\"$C\",\"folder\":\"\",\"lesson\":\"Intro\",\"link\":\"https://youtu.be/dQw4w9WgXcQ\"}" >/dev/null
pkill -f "remote-deb""ugging-port=9333" 2>/dev/null; rm -rf /tmp/opencode/chrome-profile
CS_COOKIE="$COOKIE" CS_COURSE="$C" node /tmp/opencode/check-editor.mjs
curl -s -X POST https://<your-site>.workers.dev/api/admin/files/delete -H "cookie: s=$COOKIE" -H 'content-type: application/json' -d "{\"path\":\"$C\"}" >/dev/null
echo "cleaned"
```

Expected: `OK editor: "Edited from the file manager\nsecond line"`. Inspect `/tmp/opencode/shots/editor.png` for the dialog and the toast.

- [ ] **Step 9: Clean up the test admin and commit**

```bash
cd /home/taxin/Work/course-site
pkill -f "remote-deb""ugging-port=9333" 2>/dev/null
npx wrangler d1 execute course-db --remote --command "DELETE FROM users WHERE email='uitest-tmp@example.com'"
npx wrangler d1 execute course-db --remote --command "SELECT COUNT(*) AS tmp FROM users WHERE email='uitest-tmp@example.com'"
git add src/app/api.ts src/app/admin-files.ts
git commit -m "feat(admin): edit a course description from the file manager

Top-level (course) rows get a direct Description tool (no overflow menu)
that opens the shared dialog with a textarea, pre-filled from the course
payload. Saving calls POST /api/admin/files/description; runAsk already
refreshes the course state and the listing, so the card and the row update.

Verified headlessly against the deployed Worker: opened Admin -> Course
files, set a description through the dialog, and read it back from
/api/course."
git push origin main
```

Expected: `tmp` is `0`; commit and push succeed.

---

### Task 4: Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/CHANGELOG.md`

**Interfaces:**
- Consumes: nothing at runtime — prose only.
- Produces: nothing for other files.

- [ ] **Step 1: README**

- In "Courses and access" (or the course-list description in "How the bucket maps to the site"), note the home screen is now a **grid of course cards**, each showing the description, progress and lesson count.
- Add a short paragraph (near "File manager"): a course can have a **description** written from **Admin panel → Files** — open the course list and click the **Description** tool on a course row; it shows on the card and as an intro at the top of the course. Plain text, up to 2000 characters; empty removes it.
- Update the `course.ts` line in "Project structure" (`Course list (rows)` → `Course list (cards)`), and mention the new field in the `api.ts` / `worker` rows if those are listed.

- [ ] **Step 2: HANDOFF**

- The file-map row for `src/app/course.ts`: "course list (dense rows)" → "course list (card grid with descriptions)".
- Add the `course_meta` table to any schema/table list, and the `POST /api/admin/files/description` route to the admin file-manager endpoints list.
- Decision log: add an entry — course descriptions live in D1 (`course_meta`), keyed by the course's top-level folder name, edited from a per-row tool in the file manager, and carried by rename/delete.

- [ ] **Step 3: CHANGELOG**

Under `## Unreleased`, add a new subsection (e.g. `### Added (course cards and descriptions)`) with two bullets: the course list is a responsive card grid; each course can carry an owner-written description (D1 `course_meta`, edited from the file manager, shown on the card and at the course root, plain text up to 2000 chars).

- [ ] **Step 4: Verify and commit**

```bash
cd /home/taxin/Work/course-site
npm run typecheck && npm run build
git add README.md docs/HANDOFF.md docs/CHANGELOG.md
git commit -m "docs: course cards and per-course descriptions"
git push origin main
```

Expected: both exit 0 (docs only); commit and push succeed.

---

## Self-review

- **Spec coverage:** card grid (§1) → Task 2 Steps 3, 5; course intro (§2) → Task 2 Step 4; D1 `course_meta` (§3) → Task 1 Step 2; payload field (§3) → Task 1 Step 3; write route (§4) → Task 1 Step 4; rename/delete lifecycle (§5) → Task 1 Step 5; file-manager editor (§6) → Task 3 Steps 3–5; accessibility (§7) → buttons/`aria-label` in Task 2 Step 3 and Task 3 Step 4; rollout/docs → Task 4. Covered.
- **Step scan:** every step names the file, the exact anchor, and the exact values (SQL, class names, copy). No "handle edge cases" left open; no function body written that the signature and test already determine.
- **Type consistency:** `CourseData.description` defined in Task 2 Step 2, consumed in Task 2 Step 3 and Task 3 Step 5; `saveCourseDescription` signature defined in Task 3 Step 2, called in Task 3 Step 5; `Ask.lines` defined and used in Task 3; `setCourseDescription` route matches the `Api` method's path and body.
- **Review Focus:** HTML-looking description → Task 2 Step 8 assertion (`card-desc b/img` is null) and Step 9 value; 2000-char cap + newlines → Task 1 Step 8 and Task 2 Step 5 (`pre-line`/`pre-wrap`); empty course not listed → Task 1 Step 8 (`zz-empty-test` grep 0); rename carries / no text needed → Task 1 Step 8; delete clears → Task 1 Step 8 (`left_rows` 0). Each is pinned to its owning step.
- **Proportion:** four tasks; the code blocks are the exact SQL, signatures and test assertions the implementer cannot invent; the CDP harness is boilerplate. No task restates another.

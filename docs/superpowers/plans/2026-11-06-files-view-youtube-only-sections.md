# Files view: show YouTube-only sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **Admin → Course files** list sections that exist only as YouTube lessons (so it matches the student course view), and let those rows be positioned and deleted.

**Architecture:** Derive the missing folders from `youtube_lessons.id` in `worker/files.js` (the ids are already R2-key shaped). Merge them into `listFolder()` (so they render) and into `siblings()` (so `setEntryPosition` sees them and renumbers them), and teach `deleteEntry()` to count a folder's YouTube rows so a YouTube-only folder can be deleted instead of answering "Not found".

**Tech Stack:** Cloudflare Workers (plain ESM JS), R2, D1, Angular client. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-files-view-youtube-only-sections-design.md`

## Global Constraints

- Change only `worker/files.js` (plus the test, `package.json` script, and docs). No new endpoints, no D1 schema change, no client change.
- Real R2 folders/files keep behaving exactly as now; the "a real file with the same key wins" (`shadowed`) rule is untouched.
- `_resources` is never listed as a folder.
- Never create duplicate `content_order` positions: any position edit must renumber **all** siblings to unique `1..N`.
- Keep the existing path-range cleanup idiom (`path >= p + '/' AND path < p + '0'`).
- This repo has no test runner. Add Node's built-in `node --test` (zero dependency) for the one pure helper, and keep the live checks for everything else. Commands run from the repo root; `npm run deploy` ships the live Worker.

## Review Focus

- A YouTube lesson that sits **directly in** the open folder (`<parent>/<lesson>`, no further segment) must **not** create a folder row.
- A section that is **both** an R2 prefix and has YouTube lessons must appear **once**, as the R2 folder.
- **Delete** on an R2-only, YouTube-only, or mixed folder must clean `youtube_lessons` **and** `content_order`, and must never answer "Not found" when content exists.
- Editing one position must renumber every sibling (R2 folders **and** YouTube-only folders) to unique `1..N`.
- `_resources` and HLS segment keys must never appear as folders.

---

### Task 1: `childDirsFromIds` pure helper (with tests)

**Files:**
- Create: `worker/files.test.mjs`
- Modify: `worker/files.js` (add the helper + export it)
- Modify: `package.json` (add a `test` script)

**Interfaces:**
- Produces: `export function childDirsFromIds(parent: string, ids: Array<string | unknown>): string[]` — the distinct folder paths that are **direct children** of `parent`, implied by the lesson ids. A lesson directly in `parent` (no further `/`) contributes nothing; `_resources` is skipped; insertion order is preserved.

- [ ] **Step 1: Write the failing test**

Create `worker/files.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { childDirsFromIds } from './files.js';

const IDS = [
  'Course/ক্লাস করার নিয়ম/Vedio',   // folder directly under the course
  'Course/Section/Sub/lesson',       // nested -> only the top segment
  'Course/top-level-lesson',         // directly in Course -> not a folder
  'Other/Thing/x',                   // another course -> excluded
];

test('childDirsFromIds finds folder segments under the parent', () => {
  assert.deepEqual(childDirsFromIds('Course', IDS), ['Course/ক্লাস করার নিয়ম', 'Course/Section']);
  assert.deepEqual(childDirsFromIds('Course/Section', IDS), ['Course/Section/Sub']);
  assert.deepEqual(childDirsFromIds('', IDS), ['Course', 'Other']);
});

test('childDirsFromIds never treats a lesson in place, or _resources, as a folder', () => {
  assert.deepEqual(childDirsFromIds('C', ['C/lesson', 'C/_resources/x']), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test worker/files.test.mjs`
Expected: FAIL — `SyntaxError: The requested module './files.js' does not provide an export named 'childDirsFromIds'`.

- [ ] **Step 3: Add the helper to `worker/files.js`**

Put it beside `cleanPath`/`cleanKey` (after `parentOf`/`entryName`):

```js
/**
 * Folder paths directly under `parent` that exist only because of YouTube lessons. A lesson
 * id is <Course>/<Folder>/…/<name>; the segment right after `parent` is a folder only when
 * the id has at least one more segment after it. `_resources` is never a folder.
 */
export function childDirsFromIds(parent, ids) {
  const prefix = parent ? parent + '/' : '';
  const out = new Set();
  for (const raw of ids) {
    const id = String(raw);
    if (!id.startsWith(prefix)) continue;
    const rest = id.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) continue; // a lesson directly in `parent`, not a folder
    const seg = rest.slice(0, slash);
    if (seg === '_resources') continue;
    out.add(parent ? parent + '/' + seg : seg);
  }
  return [...out];
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test worker/files.test.mjs`
Expected: PASS — 2 tests, 0 failures.

- [ ] **Step 5: Add the `test` script**

In `package.json` `"scripts"`, add:

```json
"test": "node --test worker/*.test.mjs",
```

- [ ] **Step 6: Commit**

```bash
git add worker/files.js worker/files.test.mjs package.json
git commit -m "feat(files): derive YouTube-only folders from lesson ids"
```

---

### Task 2: Show and order them (`listFolder` + `siblings`)

**Files:**
- Modify: `worker/files.js` — `listFolder()` (currently lines 104-153) and `siblings()` (currently lines 60-92)

**Interfaces:**
- Consumes: `childDirsFromIds(parent, ids)` from Task 1.

- [ ] **Step 1: Merge virtual folders into `listFolder`**

In `listFolder`, after the `do { … } while (cursor);` R2 listing loop and **before** `const positions = await orderPositions(env);`, insert:

```js
  // Folders that exist only as YouTube lessons (no R2 prefix) still belong in the listing,
  // so the file view matches the student course view. A real R2 folder of the same path wins.
  const seen = new Set(dirs.map((d) => d.path));
  const ids = ((await env.DB.prepare('SELECT id FROM youtube_lessons').all()).results || []).map((r) => String(r.id));
  for (const path of childDirsFromIds(prefix, ids)) {
    if (seen.has(path)) continue;
    const name = entryName(path);
    if (!name) continue;
    dirs.push({ name, path });
    seen.add(path);
  }
```

The `positions`/`order` code below already reads `dirs`, so the new folders get their saved numbers automatically.

- [ ] **Step 2: Merge virtual folders into `siblings`**

In `siblings`, after the existing `for (const row of rows) { … }` YouTube-lesson loop and **before** `return out;`, insert:

```js
  // Sections implied by YouTube lessons (rank 0: they are folders), so setEntryPosition
  // finds them and renumbers the whole folder including them.
  for (const path of childDirsFromIds(parent, rows.map((r) => String(r.id)))) {
    if (seen.has(path)) continue;
    out.push({ path, name: entryName(path), rank: 0 });
    seen.add(path);
  }
```

- [ ] **Step 3: Syntax-check and re-run the unit test**

Run: `node --check worker/files.js && node --test worker/files.test.mjs`
Expected: no output from `--check`, tests PASS.

- [ ] **Step 4: Commit**

```bash
git add worker/files.js
git commit -m "feat(files): list and renumber YouTube-only folders"
```

---

### Task 3: Let Delete accept a YouTube-only folder

**Files:**
- Modify: `worker/files.js` — `deleteEntry()` (guard around lines 431-440)

**Interfaces:**
- Consumes: nothing new. Keeps the existing `DELETE FROM youtube_lessons` and `content_order` cleanup already in the function.

- [ ] **Step 1: Count the folder's YouTube rows**

In `deleteEntry`, immediately before the `if (!keys.length && !lessons.size) { … }` guard, insert:

```js
  // A folder that holds only YouTube lessons has no R2 keys and no student-data rows, so
  // the guard below would 404 it. Its `youtube_lessons` rows are the "something is here".
  const yt = await env.DB.prepare(
    'SELECT COUNT(*) n FROM youtube_lessons WHERE id = ? OR (id >= ? AND id < ?)',
  ).bind(p, p + '/', p + '0').first();
```

Then change the guard's condition from `if (!keys.length && !lessons.size) {` to:

```js
  if (!keys.length && !lessons.size && !yt.n) {
```

(The rest of the guard — the top-level course `enrollments`/`course_meta` retry check — is unchanged. The function's existing `DELETE FROM youtube_lessons WHERE id = ? OR (id >= ? AND id < ?)` and `DELETE FROM content_order …` statements already remove the rows.)

- [ ] **Step 2: Syntax-check**

Run: `node --check worker/files.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add worker/files.js
git commit -m "fix(files): allow deleting a folder that holds only YouTube lessons"
```

---

### Task 4: Docs, deploy, and live end-to-end verification

**Files:**
- Modify: `docs/CHANGELOG.md` (an `### Fixed (file manager)` entry under `## Unreleased`)
- Modify: `docs/HANDOFF.md` (one row in the §2 decision log)

**Interfaces:**
- Consumes: all of Task 1-3.

- [ ] **Step 1: Update the docs**

`docs/CHANGELOG.md`, under `## Unreleased`, add a short entry describing: Course files now lists sections that exist only as YouTube lessons (rank-0 virtual folders derived from `youtube_lessons.id`), they can be positioned (renumbering stays unique), and a YouTube-only folder can now be deleted (previously it 404'd). Mention the live verification result.

`docs/HANDOFF.md` §2 decision log, add a row whose Reason explains: the Files view lists folders from R2, but the course view also lists YouTube lessons, so a YouTube-only section was invisible to the admin; `childDirsFromIds` derives those folders from the lesson ids so both views match and every row is manageable.

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Deploy**

Run: `npm run deploy`
Expected: `Deployed course-site triggers … Current Version ID: <new id>`.

- [ ] **Step 4: Set up the throwaway admin**

Run: `bash /tmp/opencode/mk-test-admin.sh` (recreates `uitest-tmp@example.com` / `UiTest-Pass-123!`). Then:

```bash
BASE=https://course-site.cspg.workers.dev
ADMIN=$(curl -s -i -X POST "$BASE/api/login" -H 'content-type: application/json' \
  -d '{"email":"uitest-tmp@example.com","password":"UiTest-Pass-123!"}' \
  | sed -n 's/^[Ss]et-[Cc]ookie: s=\([^;]*\).*/\1/p')
echo "cookie len: ${#ADMIN}"
```

- [ ] **Step 5: Verify the folder now appears at its saved position**

```bash
curl -s --get "$BASE/api/admin/files" -H "cookie: s=$ADMIN" \
  --data-urlencode "prefix=4th Semester Full Cours ( Computer )/" \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const d of j.dirs)console.log("  #"+d.position+"  ["+d.name+"]")})'
```
Expected: the list includes `#1  [ক্লাস করার নিয়ম]`, alongside the R2 folders (`Master Book`, …). No duplicate of any R2 folder.

- [ ] **Step 6: Verify the position edit keeps numbers unique**

Reassign `ক্লাস করার নিয়ম` to position 1 (or any number) and read `order` back:

```bash
curl -s -X POST "$BASE/api/admin/files/order" -H "cookie: s=$ADMIN" -H 'content-type: application/json' \
  -d '{"path":"4th Semester Full Cours ( Computer )/ক্লাস করার নিয়ম","position":1}' \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const vals=Object.values(j.order||{});console.log("entries:",vals.length,"unique:",new Set(vals).size)})'
```
Expected: `entries:` N, `unique:` N (equal — no duplicate positions).

- [ ] **Step 7: Verify delete works on a YouTube-only scratch folder**

Create a scratch section that holds only a YouTube lesson, then delete it:

```bash
# add a YouTube lesson to a scratch section
curl -s -X POST "$BASE/api/admin/youtube" -H "cookie: s=$ADMIN" -H 'content-type: application/json' \
  -d '{"course":"4th Semester Full Cours ( Computer )","folder":"zz-scratch","lesson":"v","link":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' > /dev/null
# it should now show in the file listing
curl -s --get "$BASE/api/admin/files" -H "cookie: s=$ADMIN" \
  --data-urlencode "prefix=4th Semester Full Cours ( Computer )/" \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("has zz-scratch:", j.dirs.some(d=>d.name==="zz-scratch"))})'
# delete the folder
curl -s -X POST "$BASE/api/admin/files/delete" -H "cookie: s=$ADMIN" -H 'content-type: application/json' \
  -d '{"path":"4th Semester Full Cours ( Computer )/zz-scratch","kind":"folder"}'
```
Expected: `has zz-scratch: true`, then `{"ok":true,…}` (not a 404). Then confirm it is gone:

```bash
npx wrangler d1 execute course-db --remote --command \
  "SELECT COUNT(*) AS n FROM youtube_lessons WHERE id LIKE '4th Semester Full Cours ( Computer )/zz-scratch/%'"
```
Expected: `n = 0`.

- [ ] **Step 8: Browser/visual pass (optional but recommended)**

Drive headless Chromium to `Admin → Course files → 4th Semester Full Cours ( Computer )` and confirm `ক্লাস করার নিয়ম` renders as a folder row you can open (showing the `Vedio` YouTube lesson). Note if skipped.

- [ ] **Step 9: Clean up and commit**

Delete the throwaway admin (and any `zz-scratch` leftovers) and confirm the owner is intact:

```bash
npx wrangler d1 execute course-db --remote --command "DELETE FROM users WHERE email LIKE 'uitest%'"
npx wrangler d1 execute course-db --remote --json --command \
  "SELECT email, is_admin FROM users WHERE email = 'mbthunter007@gmail.com'"
```

```bash
git add docs/CHANGELOG.md docs/HANDOFF.md
git commit -m "docs: Course files now lists YouTube-only sections"
```

---

## Self-Review

- **Spec coverage:** listing (Task 2 Step 1), positioning (Task 2 Step 2), delete (Task 3), docs + live verification (Task 4). The spec's non-goals (four empty sections, no client change, no `listCourse` change) are respected.
- **Step scan:** every step is one action with a checkable result; the new helper has a real red/green test; the wiring is checked live.
- **Type consistency:** `childDirsFromIds(parent, ids)` is the single name used in Tasks 1, 2 and 3's rationale; it returns `string[]` everywhere.
- **Review Focus coverage:** the two tests pin "lesson in place" and `_resources`; the live steps pin "appears once", "unique renumbering", and "delete cleans up". HLS segments stay filtered by the untouched `\.(ts|vtt)$` checks.
- **Proportion:** the code is ~30 lines; the plan documents the decisions, not the program.

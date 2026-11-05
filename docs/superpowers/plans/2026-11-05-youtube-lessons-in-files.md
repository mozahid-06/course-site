# YouTube Lessons Inside the Files View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage YouTube lessons from inside the Files view — a toolbar button adds one to the folder you are in, and existing lessons show as rows — and remove the separate Admin → YouTube tab.

**Architecture:** No worker change. `admin-files.ts` already calls `listFiles(path())`; it now also calls `listYoutubeLessons()` and filters client-side to lessons whose parent folder is the current `path()`. A small two-field dialog adds/edits the link. The Phase A endpoints and `Api` methods stay; `admin-youtube.ts` and the third admin view go away.

**Tech Stack:** Angular 22 standalone components + signals; Cloudflare Worker endpoints unchanged.

**Spec:** `docs/superpowers/specs/2026-11-05-youtube-lessons-in-files-design.md`

## Global Constraints

- Cloudflare Workers + R2 + D1 only; no new dependency; near-zero cost. **The worker is not touched in this plan.**
- **This repo has no test framework.** The TDD cycle is adapted: each task names the exact command and expected output before the change, then runs it after. Use `npm run typecheck` and `npm run build`, a built-bundle `grep`, and a local `wrangler dev` + `curl` smoke (the endpoints are unchanged, so the smoke only proves nothing regressed). Do not add a test framework.
- Keep the Angular `Api` service in sync with the worker `/api` contract. `YoutubeLesson` and the three `api.ts` methods stay.
- Follow existing patterns: the Files toolbar actions, the `.adm-dialog` / `.field` markup, `toast()`, `load()`, `ChangeDetectionStrategy.Eager`.
- Lesson id shape stays `<Course>/<Folder>/<Name>`; a real R2 file with the same id wins (`shadowed`).

## Review Focus

- Adding a lesson while at the root (no course folder) must be impossible — the id would have no course. The button is disabled with a title saying to open a course first.
- A lesson name containing `/` must be refused (dialog error), never creating a nested path the admin did not mean.
- A path already used by a real R2 file must show the `shadowed` warning and stay hidden (the file wins).
- A folder holding only a `.keep` plus a YouTube lesson must show that lesson and suppress the "folder is empty" message.
- Re-adding the same name in the same folder must edit the existing row (upsert), not create a duplicate.

---

### Task 1: Fold YouTube into the Files view and remove the tab

**Files:**
- Modify: `src/app/admin-files.ts` (imports; signals; `load()`; `files-list` markup; toolbar; empty-state condition; a dialog; methods)
- Modify: `src/app/admin.ts` (drop the third view)
- Delete: `src/app/admin-youtube.ts`
- Modify: `src/styles.css` (remove the now-unused `.yt-*` rules)

**Interfaces:**
- Consumes: `Api.listYoutubeLessons(): Promise<YoutubeLesson[]>`, `Api.addYoutubeLesson(course, folder, lesson, link): Promise<{ ok, id, yt, shadowed }>`, `Api.deleteYoutubeLesson(id): Promise<unknown>`, `interface YoutubeLesson { id: string; course: string; folder: string; lesson: string; yt: string }` (all already in `src/app/api.ts`); the existing `Api.listFiles(prefix)`, `path()`, `load()`, `toast()`, private `join(dir, name)`.
- Produces: nothing new for other files. `admin.ts`'s `view` becomes `'users' | 'files'` again.

- [ ] **Step 1: Baseline**

Run:

```bash
cd /home/taxin/Work/course-site
npm run typecheck && npm run build
```

Expected now: both exit 0 (Phase A is live). Note in the ledger that `src/app/admin-youtube.ts` exists and `admin.ts` renders it for `view() === 'youtube'`.

- [ ] **Step 2: Import the type and add the signals + computed in `admin-files.ts`**

Change the import line to:

```ts
import { Api, FileListing, YoutubeLesson } from './api';
```

After the `toasts` signal (around line 232) add:

```ts
protected readonly youtube = signal<YoutubeLesson[]>([]);
protected readonly ytOpen = signal(false);
protected readonly ytEditing = signal<string | null>(null);
protected readonly ytName = signal('');
protected readonly ytLink = signal('');
protected readonly ytError = signal('');
```

After the `crumbs` computed add:

```ts
/** YouTube lessons whose parent folder is the folder currently open. */
protected readonly ytRows = computed(() => {
  const here = this.path();
  return this.youtube()
    .filter((l) => l.id.slice(0, Math.max(0, l.id.lastIndexOf('/'))) === here)
    .map((l) => ({ id: l.id, name: l.lesson, yt: l.yt }));
});
```

- [ ] **Step 3: Fetch the lessons in `load()`**

Replace the body of `load()` (lines ~301-311) with:

```ts
protected async load(): Promise<void> {
  this.loading.set(true);
  this.error.set('');
  try {
    const [listing, youtube] = await Promise.all([this.api.listFiles(this.path()), this.api.listYoutubeLessons()]);
    this.listing.set(listing);
    this.youtube.set(youtube);
  } catch (e) {
    this.error.set(message(e));
  } finally {
    this.loading.set(false);
  }
}
```

- [ ] **Step 4: Add the toolbar button**

In `.files-head-acts`, after the Refresh button (before the Upload button) add:

```html
<button type="button" [disabled]="!path()" [title]="path() ? 'Add a YouTube lesson to this folder' : 'Open a course first'" (click)="openYt()">
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 5 3-5 3z" /></svg>
  YouTube
</button>
```

Reuse whatever class the Upload button's `<svg>` uses for sizing if the icon looks off (`.files-up`). At the root `path()` is `''`, so the button is disabled — a lesson needs a course.

- [ ] **Step 5: Render the rows**

Inside `files-list`, after the `@for (f of listing().files; ...)` block (before the closing `</div>` at line ~161), add:

```html
@for (y of ytRows(); track y.id) {
  <div class="files-row" role="listitem">
    <span class="files-open as-span">
      <span class="files-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 5 3-5 3z" /></svg>
      </span>
      <span class="files-name">{{ y.name }}</span>
      <span class="files-meta">video · {{ y.yt }}</span>
    </span>
    <div class="files-tools">
      <button type="button" class="files-tool" title="Change link" aria-label="Change YouTube link" (click)="editYt(y)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13 7 4 4" /></svg>
      </button>
      <button type="button" class="files-tool danger" title="Delete" aria-label="Delete YouTube lesson" (click)="removeYt(y)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6 7l1 13h10l1-13" /></svg>
      </button>
    </div>
  </div>
}
```

- [ ] **Step 6: Include them in the empty-state condition**

Change the empty-folder condition (line ~163) to:

```html
@if (!loading() && !listing().dirs.length && !listing().files.length && !ytRows().length) {
```

- [ ] **Step 7: Add the dialog**

After the existing `@if (ask(); as a) { ... }` dialog block (line ~207) and before the `.toasts` div, add:

```html
@if (ytOpen()) {
  <div class="adm-scrim" (click)="closeYt()"></div>
  <div class="adm-dialog" role="dialog" aria-modal="true" aria-label="YouTube lesson">
    <header class="adm-dialog-top">
      <h3>{{ ytEditing() ? 'Change YouTube link' : 'YouTube lesson' }}</h3>
      <button type="button" class="adm-close" aria-label="Close" (click)="closeYt()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
      </button>
    </header>
    <div class="adm-form">
      <p class="adm-muted sm">Added to {{ path() }}.</p>
      @if (!ytEditing()) {
        <label class="field">
          <span>Lesson name</span>
          <input [value]="ytName()" (input)="ytName.set($any($event.target).value)" autocomplete="off" spellcheck="false" />
        </label>
      }
      <label class="field">
        <span>YouTube link</span>
        <input [value]="ytLink()" (input)="ytLink.set($any($event.target).value)" placeholder="https://youtu.be/... or the video id" autocomplete="off" spellcheck="false" (keydown.enter)="saveYt()" />
      </label>
      @if (ytError()) { <p class="files-error">{{ ytError() }}</p> }
    </div>
    <footer class="adm-dialog-foot">
      <button type="button" (click)="closeYt()">Cancel</button>
      <button type="button" class="p" [disabled]="busy()" (click)="saveYt()">{{ busy() ? 'Saving...' : ytEditing() ? 'Save' : 'Add lesson' }}</button>
    </footer>
  </div>
}
```

- [ ] **Step 8: Add the methods**

Before the private `openAsk(...)` method (line ~424) add. On save, split the full id back into the `(course, folder, lesson)` the endpoint expects, so no new `Api` method is needed:

```ts
protected openYt(): void {
  this.ytEditing.set(null);
  this.ytName.set('');
  this.ytLink.set('');
  this.ytError.set('');
  this.ytOpen.set(true);
}

protected editYt(y: { id: string; name: string; yt: string }): void {
  this.ytEditing.set(y.id);
  this.ytName.set(y.name);
  this.ytLink.set(y.yt);
  this.ytError.set('');
  this.ytOpen.set(true);
}

protected closeYt(): void {
  this.ytOpen.set(false);
  this.ytError.set('');
  this.busy.set(false);
}

protected async saveYt(): Promise<void> {
  this.ytError.set('');
  const editing = this.ytEditing();
  const name = this.ytName().trim();
  const link = this.ytLink().trim();
  if (!editing && !name) { this.ytError.set('Give the lesson a name.'); return; }
  if (name.includes('/')) { this.ytError.set('A name cannot contain a slash.'); return; }
  if (!link) { this.ytError.set('Paste a YouTube link.'); return; }
  const full = editing ?? this.join(this.path(), name);
  const parts = full.split('/');
  this.busy.set(true);
  try {
    const r = await this.api.addYoutubeLesson(parts[0], parts.slice(1, -1).join('/'), parts[parts.length - 1], link);
    this.ytOpen.set(false);
    this.toast(r.shadowed ? 'Saved, but a file already uses that path, so it will not show.' : editing ? 'Link updated' : 'Lesson added', r.shadowed);
    void this.api.init();
    await this.load();
  } catch (e) {
    this.ytError.set(message(e));
  } finally {
    this.busy.set(false);
  }
}

protected async removeYt(y: { id: string }): Promise<void> {
  if (!confirm(`Delete the YouTube lesson "${y.id}"?`)) return;
  this.busy.set(true);
  this.error.set('');
  try {
    await this.api.deleteYoutubeLesson(y.id);
    this.toast('Deleted');
    void this.api.init();
    await this.load();
  } catch (e) {
    this.error.set(message(e));
  } finally {
    this.busy.set(false);
  }
}
```

- [ ] **Step 9: Remove the separate tab**

In `src/app/admin.ts`:
- Delete `import { AdminYoutube } from './admin-youtube';`
- `imports: [AdminFiles, AdminYoutube]` → `imports: [AdminFiles]`
- `view = signal<'users' | 'files' | 'youtube'>('users')` and `setView(...)` → `view = signal<'users' | 'files'>('users')` and `toggleView(): void { this.view.update((v) => (v === 'files' ? 'users' : 'files')); }`
- Restore the sub-text ternary to two branches (drop the `view() === 'youtube'` arm).
- Remove the YouTube header button; restore the Files button's `(click)="toggleView()"`.
- Remove the `} @else if (view() === 'youtube') { <app-admin-youtube /> }` branch.

Delete `src/app/admin-youtube.ts`. In `src/styles.css`, remove the `/* Admin → YouTube: the lesson list */` block (`.yt-list`, `.yt-row`, `.yt-path`, `.yt-actions`).

- [ ] **Step 10: Verify the build and the bundle**

Run:

```bash
cd /home/taxin/Work/course-site
grep -rn "admin-youtube\|AdminYoutube\|yt-list\|toggleView\|setView" src/ ; echo "--- yt-list refs should be gone; toggleView present ---"
npm run typecheck && npm run build
grep -c "Give the lesson a name." dist/web/browser/main-*.js        # expect >= 1
grep -rc "Add YouTube videos as lessons" dist/web/browser/main-*.js  # expect 0 (old tab copy gone)
```

Expected: `typecheck` and `build` exit 0; the new copy is in the bundle; the old tab copy is not.

- [ ] **Step 11: Smoke the endpoints still answer (worker untouched)**

Start a local worker (`.dev.vars` with `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) and run:

```bash
curl -s -c /tmp/jar -X POST localhost:8787/api/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"longpassword1"}'
curl -s -b /tmp/jar localhost:8787/api/admin/youtube
curl -s -b /tmp/jar -X POST localhost:8787/api/admin/youtube -H 'content-type: application/json' -d '{"course":"Physics","folder":"Week 1","lesson":"Welcome","link":"https://youtu.be/dQw4w9WgXcQ"}'
curl -s -b /tmp/jar localhost:8787/api/course
curl -s -b /tmp/jar -X DELETE localhost:8787/api/admin/youtube -H 'content-type: application/json' -d '{"id":"Physics/Week 1/Welcome"}'
```

Expected: `{"ok":true}`, `[]` (or existing), the `{ok,id,yt,shadowed:false}` add, the lesson in `GET /api/course` as `kind:'youtube'`, then `{"ok":true}`. Clean health.

- [ ] **Step 12: Commit**

```bash
git add src/app/admin-files.ts src/app/admin.ts src/styles.css
git rm src/app/admin-youtube.ts
git commit -m "feat(admin): manage YouTube lessons from the Files view"
```

---

### Task 2: Docs

**Files:**
- Modify: `README.md` (the "YouTube lessons (no upload)" section)
- Modify: `docs/HANDOFF.md` (§4d, the `src/app/admin-files.ts` file-map row, the decision log)
- Modify: `docs/CHANGELOG.md`

**Interfaces:**
- Consumes: nothing at runtime — prose only.
- Produces: nothing for other files.

- [ ] **Step 1: README — point at the Files view**

In "YouTube lessons (no upload)", replace the "Admin panel → YouTube" instructions with: sign in as an admin, open **Admin panel → Files**, go into the course (and folder) you want, and click **YouTube** in the toolbar — Lesson name + YouTube link only, since the folder you are in is the path. The lesson shows as a row in that folder, with **Change link** and **Delete**. The button is disabled at the root; create the course folder first for a YouTube-only course. Keep the existing bullets about the real-file-wins rule, D1 storage / no redeploy, and the seed.

- [ ] **Step 2: HANDOFF — §4d, file map, decision log**

- §4d: replace the "Admin panel → YouTube tab" description with the Files-view flow above; note the tab and `admin-youtube.ts` were removed in this pass, the endpoints are unchanged, and a YouTube-only course now needs its folder created first.
- File map: change the `src/app/admin-files.ts` row to mention the YouTube button and rows; remove the `src/app/admin-youtube.ts` row.
- Decision log: change the "YouTube lessons are opt-in, managed in D1" entry to say they are managed from inside the Files view.

- [ ] **Step 3: CHANGELOG — move the entry**

Under `## Unreleased`, restate that YouTube lessons are added and managed from **Admin → Files**; note the separate Admin → YouTube tab was removed (the endpoints are unchanged).

- [ ] **Step 4: Verify and commit**

```bash
cd /home/taxin/Work/course-site
npm run typecheck && npm run build
git add README.md docs/HANDOFF.md docs/CHANGELOG.md
git commit -m "docs: YouTube lessons live in the Files view"
```

Expected: both exit 0 (docs only); commit created.

---

## Self-review

- **Spec coverage:** toolbar button (Task 1 Step 4), rows in the current folder (Steps 2, 3, 5), add/edit-link/delete (Steps 7, 8), no course/folder fields — path is the current folder (Steps 7, 8), tab + `admin-youtube.ts` removed (Step 9), empty state (Step 6), docs (Task 2). No worker/endpoint change. Covered.
- **Step scan:** each step names the file, the exact anchor and the exact values. No "handle edge cases" left open.
- **Type consistency:** `YoutubeLesson` and the three `Api` methods are used as defined in `api.ts`; `ytRows` yields `{ id, name, yt }`, consumed by `editYt`/`removeYt` signatures.
- **Review Focus:** root-add disabled (Step 4), slash name refused (Step 8), shadow warning (Step 8 + Step 11), empty-folder suppressed (Step 6), duplicate name upserts (Step 8). Each is pinned to the step that owns it.
- **Proportion:** two tasks, no worker change; the plan is mostly the exact markup/signatures the implementer cannot invent.

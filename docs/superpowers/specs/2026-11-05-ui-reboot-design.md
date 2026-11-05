# UI reboot — minimalist, Drive-style, compact — design

Date: 2026-11-05
Status: FINAL — awaiting the go-ahead to build
Source catalogue: `docs/UI-REBOOT.md`

## Intent (why)

The current UI is loud and oversized: a zombie display logo, gradient buttons, a shadow on
every card and row, tinted surfaces and extra toolbars. The owner wants a **minimalist**
interface that reads like **Google Drive**: dense lists, small file-type glyphs, and
actions that appear on the row you are using. The working word for the whole pass is
**compact** — controls sized to their text, rows sized to their content, hierarchy carried
by spacing and one accent colour instead of by fills, shadows and gradients.

## Goals

- Replace the visual system (colour, type, spacing, radii, motion) with the owner's palette
  and a compact scale.
- Convert the three list screens — Home/courses, the student folder browser, Admin → Files
  — to one Drive-style row language.
- Make primary actions, secondary actions and destructive actions visually distinct.
- Keep both themes, following the system preference, with no gradient backgrounds.
- Keep every current capability; this is a presentation change only.

## Non-goals

- No new dependency, framework or component library.
- No functional change: ordering, uploads (still browser → R2 presigned), auth, progress,
  comments, notes, resources and the admin CRUD all behave exactly as today.
- No change to the Video.js player internals or the `ngx-extended-pdf-viewer` toolbar.
- Not an information-architecture change; the same screens stay, and the same routes.

## Anti-goals

- Do not add decoration to signal "minimal" (no hairline grids, no all-caps eyebrows, no
  monospace labels as ornament).
- Do not introduce a second accent. Indigo is the only interactive colour.
- Do not shrink touch targets on phones to hit a desktop density.

## Constraints

- Angular templates + one global `src/styles.css`; no per-component style files today.
- Must survive the existing responsive rules and the PDF full-window mode.
- All copy stays in product voice, sentence case, verb-first buttons.

## The design

### Colour

The owner's palette, unchanged:

| Role | Light | Dark |
| --- | --- | --- |
| Page | `#FAFAF7` | `#0B1120` |
| Surface (cards, bars, menus) | `#FFFFFF` | `#111827` |
| Hover / raised | `#F1F5F9` | `#1E293B` |
| Text | `#0F172A` | `#F8FAFC` |
| Muted text | `#475569` | `#94A3B8` |
| Primary | `#4338CA` | `#6366F1` |
| Primary hover | `#3730A3` | `#4F46E5` |
| On primary | `#FFFFFF` | `#FFFFFF` |
| Link / active | `#4338CA` | `#A5B4FC` |
| Amber badge | `#FBBF24` | `#FBBF24` |
| On amber | `#0F172A` | `#0F172A` |
| Success | `#15803D` | `#4ADE80` |
| Border | `#E2E8F0` | `#334155` |

**One approved addition:** a destructive red, because the palette had none and the admin has
delete actions. `#DC2626` (light) / `#F87171` (dark), the standard red above/below the
palette's slate range (owner-approved 2026-11-05). Destructive is the only other colour, and
only on the destructive control and its confirm.

Colour rules: surfaces are flat (fill + 1 px border, never a shadow); the page has no
gradient; amber only ever sits on a small badge; green only ever means done/saved.

Theming: both palettes ship, and the header menu gains a manual **Light ⇄ Dark** toggle
(two states, as the owner chose). The toggle sets `data-theme` on the root element and is
remembered in `localStorage`; before the user ever touches it, the page follows the OS
`prefers-color-scheme`, so a first-time visitor still gets the theme they expect. This
replaces the current "OS preference only" behaviour and is the one place the reboot changes
how the theme is chosen.

### Type

One family, Inter, at a compact scale:

| Use | Size / weight |
| --- | --- |
| Wordmark | 15 px / 600, `-0.01em` |
| Page title | 20 px / 600 |
| Section heading | 15 px / 600 |
| Row name / body | 14 px / 400–500 |
| Control label | 14 px / 500 |
| Meta, counts, hints | 12.5 px / 400 |

Base `14 px / 1.45` (revised down from the earlier 15 px to serve "compact").
Line lengths stay under 80 characters. No all-caps labels; the one exception the owner
should confirm is an optional quiet `Name / Size` column header in Admin → Files.

### Density and radii

- Desktop row height **40 px**; phone row height **44 px** (touch).
- Controls **28 px** tall (icon buttons 28 × 28, padding 0 8 px); primary actions in a bar
  **32 px**. No control is taller than its row.
- Radii: **6 px** controls, **8 px** menus/popovers/inputs, **10 px** dialogs. (Revised
  down from 10/12 for compactness.)
- Spacing: 8 px rhythm; page gutter 16–24 px; list has no outer card.
- **No shadows anywhere** except the two overlays that must separate from content: dialogs
  and the search dropdown. Those use a 1 px border plus one soft shadow.

### Shape of a row (Drive-style)

Every list uses the same row anatomy:

```
[ 12.5px pos ]  [ 16px type glyph ]  [ 14px name … ]        [ meta 12.5px ]  [ hover: actions ] [ ⋯ ]
```

- Whole row is the target; hover/focus paints the 8 px hover surface (`#F1F5F9` /
  `#1E293B`), full-bleed to the list edges, square ends (Drive-style), no radius.
- A 16 px stroke glyph carries type (folder, PDF, video, YouTube, course). It is flat, uses
  the muted text colour, and is never a tinted 38 px tile.
- Meta is muted and right-aligned; `⋯` is the last cell.
- Everyday actions (rename, move, position, open) appear inline on hover/focus; destructive
  (delete) and rarer actions live in the `⋯` menu, separated by a divider. On touch, `⋯` is
  always visible and inline actions stay hidden.
- Rows are separated by nothing on hover-capable screens (hover defines the row); a 1 px
  border under each row is used only where a static grid needs it (Admin → Users).

### Navigation

Navigation is directional: you enter a place with a labelled control, and you leave it with a
**Back control** (arrow + destination). No control changes meaning on a second press, and no
screen's only exit is the control that opened it.

Concretely:

- Admin keeps one page, but the `Files` toggle is replaced by a **Back** control. Entering
  Files is a one-way entry (from the Admin heading area); inside Files the toolbar starts
  with `← Users`, and the browser Back button does the same because the admin view is
  reflected in the URL hash.
- The existing lesson `Back` and the course breadcrumb already follow this; they stay.
- The header's `Admin panel` / `Back to course` lives in the header's hamburger menu (and,
  when the header is hidden, in the lesson/admin `⋮`).

### Screens

**Home / courses.** A short page heading ("Courses") and a Drive-style list of courses, one
40 px-ish row each: course glyph, title, "7 lessons · 0 done", a 2 px inline progress bar or
the `done/total` count, and a hover "Continue" text action. No cards, no per-course shadow,
no gradient bar. Empty state: one muted sentence.

**Course folder browser.** A plain breadcrumb text line (`Courses / 4th Semester / Master
Book`, each segment a link, `/` separators) instead of the monospace pill. Below, student
rows: quiet position number, type glyph, name, done check. Students have no row actions, so
the row is simply clickable; the trailing `›` and hover lift are removed. Folder rows open
on click.

**PDF lesson.** Three stacked bars become two:
1. **Lesson bar** (one 40 px bar, border-bottom): Back, the lesson title at 14 px/600
   truncated, then on the right the merged notes controls — autosave status text, an eye
   toggle, a delete (red on hover) control, and, when the layout allows, Full window. The
   privacy sentence becomes a tooltip on the status area or a one-time hint, not a bar.
   `Mark as complete` sits at the end as the single primary action.
2. **PDF toolbar** — untouched.
The document area keeps the current full-height behaviour and full-window mode.

**Video lesson.** The same lesson bar as PDF, with the player below and the lesson panel
(Notes / Discussion / Resources) as a flat bordered panel, not a card with a shadow. Tabs
become plain text with an indigo underline for the active tab (no gradient pill). The Notes
tab drops the repeated privacy sentence to a single short line. The `Mark as complete`
button is the only solid-indigo control in the bar.

**Admin → Files.** Entered from the Admin page; the top-right toggle is replaced by the
Back control (`← Users`) at the left of the toolbar (see Navigation). The toolbar is
otherwise compact: breadcrumb; on the right a refresh icon, then `New folder`, `YouTube`
and `Upload` as 28 px controls with `Upload`
the one primary. Rows use the shared anatomy: position number (an inline editable number
that shows no fill until hover/focus), type glyph, name, meta, hover actions (rename, move)
and a `⋯` menu holding delete. Upload jobs keep their thin progress bar but lose the per-job
card. One empty-state sentence. The page uses the full width rather than a 1080 px column.

**Admin → Users.** The six stat tiles collapse into one muted inline summary line
("9 users · 5 students · 4 admins · 4 Google-linked"). Filters become a plain toolbar row
(the second, duplicated `Any/All/Missing` control is removed and the course-access list is
the only place that needs it). Results become a borderless table: one column-header row,
40 px rows, checkbox, email as the row name, role as muted text, access as the one place a
pill (amber or muted) remains, and `Manage` revealed on hover. Selection tint is the hover
surface, not an accent tint.

**Dialogs.** One dialog style (10 px radius, border, one shadow): header, body, footer with
the primary action last. Destructive confirms use the red text button, never a filled
primary. The Add-users dialog keeps its Single / Bulk tabs, styled as plain text tabs. The
YouTube dialog stays a dialog but its two jobs (one lesson, CSV) are visually separated.
The user-detail **drawer becomes this same dialog** (owner delegated; decision 2 above), so
the app has exactly one overlay pattern.

**Login.** A narrow centred column on the page background, no card: wordmark, "Sign in"
heading, labelled email and password fields, full-width primary `Sign in`, a divider, then
Google's own button. Error text occupies its line only when present.

**Header.** The header is not global. It exists only where browsing and search happen —
the course list and the folder browser — as one slim row (~48 px): plain Inter wordmark,
search. On the right is a **single hamburger menu** (the phone pattern, now on every size),
which holds the options instead of two always-visible pills:

- `Admin panel` / `Back to course`
- **Theme:** a two-way Light ⇄ Dark toggle (the palette gets a manual switch, not just the
  OS preference)
- `Sign out`

No blur, no shadow, just a bottom border. Everywhere else the header is removed:

- Lesson screens (video and PDF) have **no header**; the lesson bar is the top bar, and it
  carries the same menu behind a single quiet `⋮` so the options are never unreachable.
- Admin has **no header**; the Admin heading row carries `Back to course` (and a `⋮` for the
  theme + sign out).
- `Sign out` and the theme switch live in that one menu, so hiding the header never strands
  the user.

Search itself is unchanged in behaviour: it is hidden while a lesson is open (already
required), and its dropdown is a bordered panel.

**Search dropdown.** A bordered panel (8 px radius), 36 px rows, the type glyph, name and
path; the group labels become small muted 12.5 px text, not tracked-out uppercase.

### Motion

Remove hover lifts, transforms and scale. Keep only 120 ms colour/background transitions and
the dialog/menu fade. All of it is disabled under `prefers-reduced-motion`.

### Accessibility (quality floor)

- Visible focus: 2 px indigo outline with a 2 px offset on every interactive element.
- Contrast: muted text is ≥ 4.5:1 on its surface in both themes.
- Touch: phone rows ≥ 44 px, controls ≥ 44 px in the header and lesson bar.
- The `⋯` menu is a real menu button with `aria-haspopup`/`aria-expanded` and Escape to
  close; destructive items keep an explicit label.
- Zoom-to-200% and the PDF full-window mode keep working.

## Approaches considered

- **A — Rewrite `styles.css` tokens + shell, then adapt each template (chosen).** One token
  file drives everything; each screen is updated to the shared row anatomy. Lowest risk,
  one deploy, easy to review as a set of screenshots.
- **B — Keep the current CSS and layer per-screen overrides.** Faster to start, but leaves
  two systems in the file and keeps the old shadows/gradients reachable. Rejected.
- **C — Component-by-component with a design system package.** Adds a dependency and a
  build step; the brief says no new dependencies. Rejected.

## Rollout

1. Tokens and base (colour, type, density, row, buttons, fields) in `styles.css`.
2. Header, wordmark, search.
3. Home/courses and the student folder browser.
4. Lesson bar merge + PDF/video/lesson panel.
5. Admin → Files, then Admin → Users, then dialogs.
6. Login.
7. Verify `npm run typecheck`, `npm run build`, real-browser screenshots (light and dark,
   desktop and phone), then deploy.

## Decisions (final)

The owner delegated the remaining judgment calls on 2026-11-05. They are:

1. **Course list = header-less rows with inline meta.** Only Admin → Users keeps a column
   header row, because it has real columns (user, progress, access, action). The course
   list, the student browser and Admin → Files are single-line rows; a second header row
   would be chrome for one small piece of meta.
2. **Admin user detail = the standard dialog, not the right drawer.** One overlay pattern in
   the whole app; the drawer's slide animation goes away with it.
3. **Wordmark stays "Course"** in plain Inter 600. The product has no other agreed name, and
   inventing one is out of scope; swapping the string later is a one-line change.
4. **One primary per bar.** Primary = solid indigo. Secondary = plain text/hover surface.
   Destructive = red text only. Never two filled buttons side by side.
5. **Row actions** reveal on hover/focus; on touch the `⋯` is always visible and inline
   actions stay hidden.
6. **Student rows have no actions** (a student cannot rename/move), so the row is just
   clickable; no `⋯` on the student side.
7. **Empty states** are one sentence in the interface's voice, with an action only where one
   exists ("This folder is empty." / "No courses yet.").
8. **Toasts** sit bottom-centre as a flat bordered surface; an error adds the red only as a
   left border and text, never a filled red block.
9. **Focus** is a 2 px indigo outline with a 2 px offset on everything interactive.

The short list of things this design deliberately does **not** decide (unchanged behaviour):
search matching, sorting rules, permissions, uploads, and the PDF toolbar.

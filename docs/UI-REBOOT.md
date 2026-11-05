# UI reboot — working notes

Status: cataloguing problems, direction chosen. Nothing here is approved for build yet.
Last updated: 2026-11-05.

## Direction

The owner wants the UI to shift to **minimalist**. That points at removing the current
decoration — the zombie display logo, gradient primary buttons, shadows stacked on every
row and card, tinted surfaces, and the extra bars — and carrying hierarchy with spacing,
type and one restrained accent instead.

Still open before a design: the wordmark and type choices, radii/density, and the screen-by-screen catalogue of problems.

### Direction update — Drive-style, compact (owner, 2026-11-05)

The owner has pointed at Google Drive as the model for both the course list and the file
browser, and asked for everything to be **compact**.

Drive behaviours to adopt:

- Content is a **dense list of rows**, not a wall of cards. One line per item: small type
  icon, name, quiet metadata, and an overflow control at the end.
- The row is the unit of interaction: hover (or focus) reveals the row's quick actions;
  a `⋯` menu holds the rest (image 2: share / download / rename / star with a tooltip).
- Type is identified by a small coloured glyph, not a large tinted icon tile.
- Breadcrumb sits above the list, not inside a raised pill.
- Generous whitespace is gone: tighter row height, tighter gutters, fewer nested boxes.

Navigation rule (owner, same session): **navigate with a Back control, not a toggle.** The
admin's `Files` button is currently a switch — press it to enter Files, press the same button
again to leave. The owner wants that gone "mostly everywhere": going forward is an explicit
entry, coming back is a Back control (arrow + destination), and the control never means its
opposite on a second press.

Consequences for this app:

- **Home / course view** becomes a Drive-style list of courses: name, lesson count,
  progress, and a quiet continue affordance. No 240 px cards, no progress gradients.
- **Student folder browser** becomes the same list: position, type icon, name, done mark.
- **Admin → Files** already is a list; it loses the per-row card fill/shadow, the 38 px
  icon tiles and the permanently visible tool cluster, and adopts the same row language.
- Actions that are destructive (delete) move behind the `⋯` menu, separated from the
  everyday actions.

## Palette (owner-supplied)

| UI role | Light | Dark | Use |
| --- | --- | --- | --- |
| Page background | `#FAFAF7` warm off-white | `#0B1120` deep navy | page, course listing, lesson workspace |
| Cards / navigation | `#FFFFFF` white | `#111827` dark slate | course cards, nav bar, lesson sidebar, panels |
| Elevated / hover | `#F1F5F9` pale slate | `#1E293B` slate | hovered menu items, dropdowns, secondary panels |
| Main text | `#0F172A` dark slate | `#F8FAFC` near-white | headings, titles, body |
| Secondary text | `#475569` slate gray | `#94A3B8` muted slate | descriptions, instructor, durations, metadata |
| Primary button | `#4338CA` indigo | `#6366F1` bright indigo | Enroll / Continue / Start lesson |
| Primary hover | `#3730A3` deep indigo | `#4F46E5` indigo | hover |
| Button text | `#FFFFFF` white | `#FFFFFF` white | labels and icons in primary buttons |
| Links / active | `#4338CA` indigo | `#A5B4FC` light indigo | links, active nav, selected lesson |
| Accent | `#FBBF24` amber | `#FBBF24` amber | Featured/Bestseller badges, small highlights |
| Accent text | `#0F172A` dark slate | `#0F172A` dark slate | text/icons on amber |
| Success text | `#15803D` forest green | `#4ADE80` bright green | completed lessons, checkmarks, success |
| Subtle borders | `#E2E8F0` light gray | `#334155` slate | card outlines, dividers, separators |
| Danger (added) | `#DC2626` red | `#F87171` light red | delete controls and their confirm only |

### What the palette settles

- The old pale-green surfaces, navy accent and textured background are gone. Neutral slate
  carries the page; indigo is the only interactive color.
- Surfaces are flat: a card or panel is a white/dark-slate fill plus a subtle border, not a
  shadow. Borders are the separation device everywhere.
- Amber is a badge/highlight color only, never a button or a link.
- Green appears only for completion/success, never for navigation.
- Both themes remain, following the system preference.

### My calls, stated for correction

- Radii tighten to 10 px for controls and 12 px for cards/panels; no gradients.
- Primary buttons are solid indigo with white text; secondary buttons are a bordered or
  hover-only surface, no shadow.
- Hover is the pale-slate / slate step, never a tinted accent.
- Inter stays as the family; base 15 px, controls 14 px, line height 1.5, headings 600.
- The wordmark question is still open (see below).

## PDF lesson screen

What is there today, top to bottom:

1. App header: logo, search field (centre), Admin panel, Sign out.
2. Lesson bar: Back, lesson title, Mark as complete.
3. Notes bar (inside the PDF viewer): privacy hint, autosave status, Full window, Hide my notes, Delete notes.
4. PDF viewer toolbar: page navigation, zoom, Page fit, annotation tools.

### Confirmed by the owner

- **Search field in the header is wrong on this screen** (the red X). It is the widest,
  emptiest control on the page and has nothing to do with reading a lesson.
- **Three stacked bars above the document should become two.** The notes bar (3) moves
  into the lesson bar (2), so only the lesson bar and the PDF toolbar remain.
- **The PDF toolbar (4) stays untouched.**

Open question recorded at the time: the note said "2 and 4 merged" but also "the 4th line
will be untouched"; the arrows and the "3 → 2" direction were read as notes bar merging
into the lesson bar. To confirm.

### Proposed, waiting for a yes/no

- The privacy sentence takes a whole bar for information a student learns once. It could
  be a quiet icon with a tooltip, or a one-word hint, inside the merged bar.
- "Delete notes" looks the same as "Hide my notes"; a destructive action should not sit at
  equal weight next to a view toggle.
- "Mark as complete" (green) and the three small ghost buttons compete; the bar has no
  clear primary/secondary order.
- The lesson title is the raw file name (`Data_Structure_and_Algorithm`), underscores and
  all.
- The logo is 45 px tall in a 58 px header and draws more attention than the lesson title.

## Admin → Files

Seen in `ui-files.png` (1535 × 1009 viewport), dark theme.

- **The controls are bigger than the text they label.** The toolbar buttons are 44 px tall
  with 14 px labels; the row is about 86 px tall with a 38 px icon tile and 14 px name.
  The page reads as oversized furniture around small type.
- Every row is its own rounded card with a shadow, so a folder listing looks like a stack
  of widgets instead of a list.
- The position input is a 3.2 rem box with its own fill; the leading `–` looks like a
  button and is the first thing in the row.
- Folder rows carry a permanent pencil + bin pair; the eye goes to the tool chrome, not
  the file names.
- `Refresh`, `YouTube`, `Upload` and `New folder` are four competing buttons of three
  different heights and weights; `Upload` is the only filled one, so it reads as the page
  action even though uploading is not the common task.
- The `Files` toggle at the top is a large pill whose label never changes: press it to
  enter Files, press the same pill again to leave. There is no Back; the only way out is to
  re-press the thing that took you in.
- Content is top-left in a 1080 px column with roughly two-thirds of the viewport empty.

Compact target for this screen: one 40 px row, 13–14 px type, 28–32 px controls, no card
fill or shadow per row, actions on hover/`⋯`.

## Home / course view

Seen in `ui-home.png`.

- A single course produces one 240 px card floating in a mostly empty page. The card is
  two-thirds whitespace: title, `0/7 lessons`, a 4 px progress bar, `Start →`.
- The page background carries two radial gradients; the card carries a shadow and a 12 px
  radius; nothing on screen needs either.
- The card is large enough to hold a folder listing but only holds four short lines.
- The progress bar mixes green and navy in one gradient, so "progress" has no single
  colour.
- There is no sense of a collection: with more courses the grid would still be a wall of
  identical rounded rectangles.

## Student folder browser

Seen in `ui-browser.png`.

- Rows are 56–58 px tall for one line of 15 px text, each a rounded card with a shadow and
  a hover lift; the whole list looks like stacked buttons.
- A 40 px tinted icon tile sits before every name, plus a leading position number in a
  separate 24 px gutter — three columns of chrome before the file name.
- The breadcrumb is a raised monospace pill (`./ Courses / …`); it repeats the course name
  already in the header and adds a second visual container above the list.
- Trailing `›` on every row, and a hover slide, add motion to something already clickable.
- Completed files get a green dot; nothing marks the currently-open or next item.

## Video lesson

Read from code (`course.ts`, `player.ts`, `lesson-panel.ts`) — no video is on the live site.

- The lesson bar has Back, the raw file name, and a green `Mark as complete`; on phone the
  button drops to its own full-width row, so the bar becomes two rows.
- The player is a black rounded rectangle with a shadow, capped at a 16:9 height equation.
- Below/next to it sits the lesson panel: a rounded card with a tinted tab strip whose
  active tab is a gradient pill; the Notes tab repeats the "private" sentence already
  shown on the PDF screen, and the textarea is an inset soft field.
- Discussion avatars and the admin avatar are circular gradient badges.
- On wide screens the player and panel are columns; on narrow they stack, so the panel is
  pushed below a full-height video.

## Login

Read from code (`login.ts`); no screenshot.

- A 390 px card with a 20 px radius and a large shadow, centred on a gradient page.
- Placeholder-only fields ("Email", "Password") with no visible labels.
- A `p`-class gradient primary button, then an "or" rule, then Google's own pill button —
  three different button shapes on one screen.
- The error line reserves a blank row whether or not there is an error.

## Admin → Users

Seen in `ui-users.png`.

- Six stat cards, each a rounded tile with a shadow, occupy the top third; two of the
  values are zero.
- Filters are inside a large rounded card: a search field, a 3-way role segmented control
  in its own tray, a 3-way Google state control, a sort `<select>`, then a second bordered
  region holding the course-access chips and a second segmented control.
- The same control (segmented `Any / All / Missing`) appears twice with different styling.
- Results is a third rounded card with its own header row, column header row, then rows;
  each row has a card-level radius grouping.
- Checkbox circles at 18 px are the only affordance for bulk selection.
- Avatars are gradient circles; pills have three different tints (mute, accent, green).
- `Manage` is the only accented action per row and is repeated on every row, so the eye
  sees a column of indigo rather than names.

## Dialogs (Add users, Rename/Move/Delete, YouTube / CSV)

Read from code (`admin.ts`, `admin-files.ts`).

- Two visual languages: modal dialogs (`adm-dialog`, 18 px radius, big shadow) and a
  right drawer (`adm-drawer`) with a slide animation.
- Headers, forms and footers each have their own padding, separated by hairlines.
- Destructive confirms render in the same primary shape as safe ones, only recoloured.
- The YouTube dialog carries two jobs (single lesson + CSV import) in one form, with a
  file input and a preview list inside it.

## Header and search

Owner point (2026-11-05): the header should be used as little as possible. It is only
needed for search and occasionally for the account options; everywhere else it should give
way to a **Back** control, so the site stays compact.

- The header is a *global* bar, so it reappears on screens that don't need it: the Admin
  dashboard (which already has its own `Admin` heading and a `Back to course` button) and
  every lesson (which already has its own Back + title bar). On those two screens it is
  pure duplicated chrome and vertical cost.

Owner point (2026-11-05): the header's right side becomes **one hamburger menu**, exactly like
the phone version today, and the **theme switcher moves into that menu**. So `Admin panel` /
`Back to course` and `Sign out` stop being two always-visible pills; the burger is the single
account/options control. The theme is no longer only the system preference — the menu carries
a two-way **Light ⇄ Dark** toggle.

- Logo is a 45 px zombie typeface inside a 58 px bar, the loudest element on every screen.
- The search field is ~38 px tall with an inset shadow, spanning up to 520 px; its results
  panel is a floating card with a shadow and uppercase group labels.
- Admin / Sign out are two bordered pills; the phone view replaces them with a burger and a
  dropdown card.
- Header uses a translucent blur over the page gradient.

### Target

- Header (slim, ~48 px, plain wordmark + search) shows **only where browsing/searching
  happens**: the course list and the folder browser.
- Lesson screens: no header. The single lesson bar is the top bar (Back, title, actions).
- Admin: no header. The Admin heading row carries `Back to course`.
- Account actions (Sign out, and Admin panel from the course side) live in one small menu
  reachable from the slim header, so hiding the header never traps the user.

## Phone layout

Read from CSS at `max-width: 760px`.

- Header shrinks to 54 px but keeps the zombie logo; search collapses to a magnifier that
  expands over the whole bar.
- The file browser switches to `overflow: visible` and the page scrolls as one; rows are
  56 px minimum height.
- The player bar becomes a two-row grid with a full-width complete button.
- PDF pins to `100dvh`; the lesson panel goes full-bleed with a 3-column tab grid.

## Light theme

Not yet seen (screenshots are dark). Tokens currently give light mode a pale-green page
(`#eef9e2`), a warm-green panel (`#f6fcef`), dark navy accent (`#36415a`) and the same
gradients and shadows as dark mode. All of the above applies to it unchanged.

## Other screens

To catalogue next: nothing else is reachable — the remaining items are the general
patterns above (buttons, fields, cards, pills) applied across screens.

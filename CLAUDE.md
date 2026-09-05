# Workout / training app — working notes

Plain HTML, CSS and ES modules. **No build step, no framework, no runtime npm
dependencies.** Russian UI. Run with `node dev-server.js` → http://localhost:8080
(a server is required: browsers block ES modules over `file://`).

Deployed from `main` to GitHub Pages: https://nikitashinkov.github.io/workout/
Repo: https://github.com/NikitaShinkov/workout

## Decisions already made (don't relitigate)

- **Public repo**, app and data together, so the phone needs no login.
- **No build step.** Vanilla ES modules served as written.
- **Categories are data**, not constants — user can add / rename / delete / reorder.
- **IndexedDB, not localStorage**, because images are stored as `Blob`s.
  localStorage is strings only; base64 (+33%) against a ~5MB quota overflows
  after a handful of exercises.
- **Cyclic schedule rotation**: enabled complexes take turns, one every
  `interval` days, repeating. (Not implemented yet — see Not built.)
- **A complex item points at an exercise, it does not copy it.**
  `{id, exerciseId}`, so the same exercise can be scheduled many times, editing
  it once updates every scheduled copy, and the image `Blob`s are stored once
  rather than duplicated into IndexedDB per drag. The item id — not the exercise
  id — is what selection and drag address, so two items referencing the same
  exercise stay independent. Deleting an exercise takes its scheduled items with
  it, and `js/store.js` prunes any complex that is left empty; an empty complex
  has no date to show and nothing to perform, so the list never holds one.

## Figma

File key `ULWMwUv9ivvkRUaHA1JikX`, connected via the `figma` MCP server declared
in `.mcp.json`. Load the `figma-design-to-code` guidance before
`get_design_context` (the tool insists, and it is right to).

| Node | Frame |
|---|---|
| `1:2` | Components |
| `1:1824` | Schedule_page (full; too large for one call — fetch children) |
| `56:3253` | Schedule_page_no exercises |
| `56:4006` | Schedule_page_1 exercise added |
| `78:2541` | Schedule_page_A lot of exercises |
| `78:3398` | Schedule_page_Indicator_and_Favorites |
| `59:6847` | Adaptive 960px (columns stay 50/50 — no stacking) |
| `54:1097` / `56:1316` | Add_exercise_popup, 2 and 7 images |
| `103:5445` / `103:5501` | menu_button states / new-category flow |
| `111:5726` | Undo_button |

Design tokens (the CSS custom properties in `css/app.css`):
`--bg #0A0A0B`, `--hover-bg #1D1D1D`, `--stroke #525252`, `--hard #FF453A`,
`--avr #FFD60A`, `--easy #32D74B`, `--active #478CF6`, `--not-selected #5B5B62`.
Text is Inter 12px throughout; bold is the only variation.

**Figma exports `_active` variants byte-identically to their base.** Verified for
`Favorites_active` and `Add_category_button_active`. Don't trust the exported
file to tell you what the active state looks like — screenshot the node and
sample its pixels. Both cases turned out to be "invert to white ground".

## Gotchas that cost real debugging time

1. **`text-box: trim-both cap alphabetic` + `overflow: hidden` clips glyphs.**
   The cap edge cuts diacritics (Й, Ё) off the top, the alphabetic edge cuts
   descenders (у, р, д) off the bottom. Fix: padding for headroom on the child,
   the compensating negative margin on the **clipping parent** — both on the
   child pushes the padding outside the parent, which clips it away again.
   Only use the trim where a box height feeds a gap; elsewhere `text-box: normal`.
2. **Flex blockifies `display: -webkit-box`**, silently killing
   `-webkit-line-clamp`. A clamped paragraph must not itself be a flex item —
   wrap it. (`.exercise-row__subtitle-box` exists only for this.)
3. **`text-overflow: ellipsis` does nothing on a flex container** — it clips
   mid-glyph instead. Keep such elements block boxes; centre with `line-height`.
4. Standard `line-clamp` and `max-lines` are **not supported** in Chrome 152
   (`CSS.supports` returns false). `-webkit-line-clamp` is the only option.
5. **Letter shortcuts must match `event.code`, not `event.key`.** On a Russian
   layout the D key reports `event.key === 'в'`, so Ctrl+D silently missed and
   Chrome's bookmark dialog won. `Enter`/`Escape`/`Delete` are layout-safe.
6. **Never re-render during `dragstart`** — it replaces the node being dragged
   and aborts the gesture. Apply classes by hand; commit state on drop/dragend.
7. **The drag image is snapshotted synchronously at `dragstart`.** To have it
   look different from the element left behind, set the class during the event
   and remove it in a `setTimeout(…, 0)`.
8. **Percentage-height chains collapse.** `height: 100%` against an auto-height
   ancestor resolves to auto; that once left `.main` at zero height with
   `overflow: hidden` hiding everything. Height flows body → `#app` → `.page` →
   `.main` as an unbroken **flex** chain.
9. **A re-render throws rows away** — destroy running hover animations first or
   their timers keep ticking against detached images.
10. **Complexes need the 8px gap between them.** It is not decoration: it is the
    only place "drop between two complexes" can be distinguished from "drop
    inside one of them", since complexes are stacked blocks of full-width rows.
    The other complex-level lane is `.complex__side`, which spans the full
    height of the block.
11. **`position: sticky` with both `top: 0` and `bottom: 0`** is what parks the
    Date_pointer against whichever edge of the list it has scrolled past. Note
    that it only *sticks* when its natural position is actually outside the
    scrollport — a test that scrolls too little just measures the natural
    position and proves nothing.
12. **`page.mouse.drop()` leaves the left button down.** A second
    `page.mouse.drag()` in the same test then throws "'left' is already
    pressed"; call `page.mouse.up()` after every drop.

## Behaviour worth knowing

- Category close button (X) appears only on the **second** hover after a
  category is opened. Clicking, adding, deleting and restoring all disarm it, so
  the X never lands under the cursor that just clicked.
- Deleting a category hides it and holds the record 5s behind an undo button /
  `Ctrl+Z`; deletions stack newest-first with independent timers.
- Menu button width is fixed by an invisible sizer span carrying the **saved**
  name — that is what keeps it steady on hover and while typing a longer name.
- Store state is version 2. `migrate()` in `js/store.js` upgrades version-1
  saves (which had no category names or order). Keep it working — the user has
  real data. It also normalises `complexes`, which earlier saves left empty.
- **One selection, three scopes.** `schedule-page.js` holds a single
  `{scope, ids, anchor}` — `'library'` (exercise ids), `'item'` (complex-item
  ids) or `'complex'` (complex ids). Selecting in one scope replaces the whole
  selection, which is what makes the spec's mutual-exclusion rules fall out for
  free and lets Del dispatch without guessing which list it means.
- Dropping onto an exercise row inside a complex inserts into that complex;
  dropping anywhere else in Complex_list — the side block, a gap, the empty
  space below — makes a new complex at that boundary. Dragging a whole complex
  always resolves to a boundary, whatever is under the cursor.
- Complexes take schedule slots in list order, and only if their Switch is on.
  Switching one off shifts every later complex a slot earlier rather than
  leaving a hole (`19 сен, —, 20 сен`). Dates are computed over the whole list,
  so the "только включённые комплексы" checkbox never renumbers anything.
- Schedule configuration is not built, so `scheduleStartDate` defaults to
  `3 сен` (chosen so the Date_pointer lands mid-list) with an interval of 1. The
  toolbar's two fields do drive it, via `js/schedule.js`.

## Not built yet, by design

Cyclic schedule rotation, the `только избранные` filter, feedback capture, the
workout page, and syncing data to the repo via the GitHub API (`js/db.js` is the
seam for that).

`Date_pointer` is drawn from the metadata only — a 2px `--active` rule with a
14×18 marker at its left end, as a CSS triangle. The Figma MCP hit its Starter
plan call limit before the node could be screenshotted, so the marker's real
shape is unverified.

## Testing

```
npm install          once
npm test             all 16 suites, ~500 checks, ~55s
npm test -- jsdom    only the logic suites
npm test -- drag     only suites matching "drag"
```

`tests/run.mjs` starts `dev-server.js` on port 8123, runs each suite in its own
process and prints a summary. **Run it after any change** — it is fast and it
covers behaviour that is easy to break silently.

- `tests/jsdom/` — logic: store, modal, selection, categories, undo, drag,
  complexes. `fake-indexeddb` backs persistence, which is how the version-1
  migration is tested against a realistic saved record.
  `complexes.test.mjs` installs a **fake layout engine** (`layout()`) that gives
  every complex and row a rect, because every drop decision is geometric and
  jsdom's rects are all zero. Anything that re-renders — a click, a key, a
  toggle — throws those rects away, so the helpers call `layout()` again.
- `tests/browser/` — layout, `:hover` and real drag, via `puppeteer-core`
  driving the Chrome or Edge already installed (`CHROME_PATH` overrides the
  search). jsdom has no layout engine and no `:hover`, so these are the only
  place geometry can be checked.
- `tests/browser/harness.html` seeds the app without the file picker:
  `?seed=plain|exercises|text`, `&extras`, `&popup=N`, `&complexes=2,1,1`
  (complex sizes, cut from the seeded exercises) and `&off=1` (switch #1 off).
- Screenshots land in `tests/.out/` (gitignored) — read them when a layout
  assertion looks suspicious.

Three lessons paid for in debugging:

1. Assert **rendered** geometry, not `scrollHeight` — that is the *unclamped*
   height, so a working clamp still reads as "3 lines".
2. "Text overflows" is not "an ellipsis was drawn". A green truncation
   assertion hid text being clipped mid-glyph; a zoomed screenshot caught it.
3. Look at the screenshots. Two real bugs — the dead line-clamp and the close
   button landing under the cursor after a delete — were found by eye while the
   assertions were passing.

Adding `"type": "module"` to package.json is why `dev-server.js` uses `import`.

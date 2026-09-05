# Workout / training app — working notes

Plain HTML, CSS and ES modules. **No build step, no framework, no runtime npm
dependencies.** Russian UI. Run with `node dev-server.js` → http://localhost:8080
(a server is required: browsers block ES modules over `file://`).

Deployed from `main` to GitHub Pages: https://nikitashinkov.github.io/workout/
Repo: https://github.com/NikitaShinkov/workout

A push to `main` publishes. Pages takes ~40s; `curl` a file you just added to
know it is live. Note the site root is `/workout/`, so an **absolute** module
path (`import('/js/store.js')`) resolves to the domain root and 404s — this is
also why `tests/browser/harness.html`, with its `<base href="/">`, only works on
localhost.

## File map

```
index.html            loads js/main.js as a module
js/main.js            initStore() then mountApp()
js/app.js             the shell: which page is mounted, and swapping them
js/store.js           the whole app state; every mutation goes through update()
js/db.js              one IndexedDB record holding that state (the sync seam)
js/model.js           domain constants and factories - no DOM, no storage
js/schedule.js        dates: parsing, formatting, buildSchedule, buildCalendar
js/schedule-page.js   page 1 - categories, Exercise_list, Complex_list, drag
js/calendar-page.js   page 2 - every category's schedule, by day. Read-only
js/page-selector.js   the header's page switcher, shared by both pages
js/category-button.js the insides of a category button - ditto, see gotcha 16
js/exercise-row.js    Exercise_block itself, shared by both pages
js/toolbar-inputs.js  the masked date field and the guarded interval field
js/exercise-modal.js  Add/edit popup
js/animation.js       the hover image sequence
js/images.js          File -> Blob, and blob URLs
js/dom.js             el() / svg() / clear() - no framework, just these
```

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
| `139:5578` | Header with Page_selector — **not yet seen, see below** |
| `139:5487` | Page_selector states — **not yet seen** |
| `139:4737` | Calendar_page — **not yet seen** |

**The Figma MCP is on the Starter plan and its call limit is exhausted.** The
Page_selector, the new header and the whole calendar page were built from the
written brief alone; `get_design_context` and `get_screenshot` both refuse. The
icons were exported by hand into `assets/icons/`, which is the way round this.

**The Page_selector icons export as a solid white fill**, so on the active
button's white ground they would vanish. They are painted as a **CSS mask over
`currentColor`** rather than as an `<img>` — one file then covers all three
states (white, black when active, `--not-selected` when disabled) with the
exported geometry untouched. Each keeps its own exported size: calendar 12×12,
workout 15×12. The buttons carry no text, so they are addressed by `data-page`
and named by `aria-label`.

`assets/icons/Page_selector_schedule.svg` (12×10) is committed but **unused** —
the selector lost its schedule button. `assets/favicon.svg` is likewise unused:
`assets/icons/app_logo.svg` is the favicon now, in both `index.html` and the
test harness.

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
   descenders (у, р, д) off the bottom — **both edges need headroom**, which is
   why `.exercise-row__title` carries `padding: 4px 0; margin: -4px 0`.
   The padding goes on the element whose own `overflow` does the clipping; the
   compensating negative margin goes on the **clipping parent** wherever a
   parent clips too — both on the child pushes the padding outside the parent,
   which clips it away again.
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
10. **Complexes are stacked flush, so "between two complexes" is a band, not a
    place.** `BOUNDARY_BAND` (12px) at the top of a complex's first row and the
    bottom of its last means "a new complex here"; everything between them
    inserts into the complex. Without it there is no way to aim at the boundary
    above the first complex — plain midpoint logic sends it into the first slot
    of complex 0. `.complex__side` and the empty space below are the other two
    complex-level lanes.
11. **`position: sticky` with both `top: 0` and `bottom: 0`** is what parks the
    Date_pointer against whichever edge of the list it has scrolled past. The
    sticky element is the 2px rule itself, so it is the *rule* that lines up
    with the edge of the list; the 14×18 marker is absolutely positioned on top
    of it and simply overflows, and the list clips whichever half sticks out.
    Note that it only *sticks* when its natural position is actually outside the
    scrollport — a test that scrolls too little just measures the natural
    position and proves nothing.
12. **A render rebuilds both lists, which resets `scrollTop` to 0.**
    `captureScroll` / `restoreScroll` in `render()` carry it across; without
    them a click, a switch or a reorder snapped the list back to the top.
13. **A drag captures the pointer**, so the wheel and the scrollbar are out of
    reach: `updateAutoScroll` scrolls a list while the cursor sits within 56px
    of its top or bottom edge. It addresses the list by selector, not by node —
    a re-render mid-drag replaces the element, and a timer holding the old one
    would scroll a detached node.
14. **`dropEffect` must be inside `effectAllowed` or the drop is refused** —
    a no-drop cursor, no `drop` event, and nothing logged to say why. An
    Exercise_list block is *copied* into the schedule but *moved* when reordered
    in its own list, so its dragstart declares `copyMove`; declaring plain
    `copy` silently killed reordering. **jsdom cannot catch this** — its
    `dataTransfer` stub is a plain object with no such semantics — so a real
    browser test guards it (`complex-drag`, section 0).
15. **Never re-render from a `blur` handler, or from the click that focuses a
    field.** Committing the toolbar fields rebuilds the page, which replaces the
    very input being blurred — Chrome throws "The node to be removed is no
    longer a child of this node", so `toolbar-inputs.js` defers the store update
    with `setTimeout(…, 0)`. The mirror image bit harder: `onDocumentClick`
    cleared the selection *by re-rendering*, so clicking into the date field
    while a row was selected tore the field out from under its own focus and
    swallowed the typing. It now drops the two selection classes by hand.
16. **Every category button must be built by `js/category-button.js`.** The
    sizer/label pair is not just about width: the label is centred by its own
    `line-height: 24px`, so a button that puts the name in as bare text centres
    it by the flex box instead and the name sits **1-2px lower** — visible as a
    jump when switching pages. And `.menu-button--off` selects `__label`, so a
    bare-text button silently loses the 50% fade that says a category is out of
    the schedule. Both bugs came from the calendar header having its own copy.
    `browser/calendar` sections 2b and 2c guard them.
17. **`page.mouse.drop()` leaves the left button down.** A second
    `page.mouse.drag()` in the same test then throws "'left' is already
    pressed"; call `page.mouse.up()` after every drop. And `page.mouse.drag()`
    hangs forever with no error if the start point is not over a draggable
    element — a scrolled-out-of-view handle, for instance.

## Pages

`js/app.js` is the shell: it mounts one page into `#app` and swaps it on
demand. Each page owns its own header, its own document-level listeners and its
own store subscription, so **every mount returns the function that undoes it** —
skip that and two pages render into the same container and both react to every
mutation. `browser/calendar` guards it (`A MUTATION RENDERS ONE PAGE, NOT TWO`).

**Page_selector holds only calendar and workout — the schedule has no button.**
A category *is* the way to the schedule, on either page: on the calendar the
header carries the category list as navigation, and picking one opens that
category's schedule. So on the schedule page nothing in the selector is active,
and the selector reads as "somewhere else you can go".

- **schedule** (`js/schedule-page.js`) — the default, and where the app always
  opens; the page is deliberately not persisted.
- **calendar** (`js/calendar-page.js`) — read-only. `buildCalendar()` in
  `js/schedule.js` gathers every scheduled complex from every category by the
  day it falls on. A day's first row is Category_block, tabs for the categories
  landing on that day; which tab is open is transient, per day.
  Its header categories are **navigation, not a filter** — the calendar is not
  scoped to a category, so none of them is drawn active, and they carry no close
  button, rename or drag. Add_category_button creates one and leaves for the
  schedule, editing its name: `editCategoryOnOpen()` in `schedule-page.js` is
  how that intent survives the page swap.
- **workout** — not built. The third button is rendered but inert.

`js/exercise-row.js` holds Exercise_block itself. The schedule page and the
calendar agree on how it *looks* and disagree about what it *does*, so
everything behavioural arrives through options and nothing in there reads the
store. The hover-animation registry lives there too, which is why both pages
call `stopAllRowAnimations()` before a render.

A category switched out of the schedule contributes nothing to the calendar — it
has no schedule to place.

The calendar can still star a block and double-click one to edit it, and those
blocks belong to any category — so `updateExercise` and `toggleFavorite` take an
optional `categoryId`. Omit it and they mean the active category, as everywhere
else.

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
  dropping on a complex's outer 12px band, on the side block or in the empty
  space below makes a new complex at that boundary. Dragging a whole complex
  always resolves to a boundary, whatever is under the cursor.
- Complexes take schedule slots in list order, and only if their Switch is on.
  Switching one off shifts every later complex a slot earlier rather than
  leaving a hole (`19 сен, —, 20 сен`). Dates are computed over the whole list,
  so the "только включённые комплексы" checkbox never renumbers anything.
- `scheduleStartDate` defaults to `3 сен` (chosen so the Date_pointer lands
  mid-list) with an interval of 1.
- **The two toolbar fields are keyboard machines, not text boxes**
  (`js/toolbar-inputs.js`). The date reads `19 сен` and edits as a fixed
  `DD.MM` mask: focusing swaps the form and selects all, typing **overwrites**
  one slot at a time and steps over the dot — so `21.10` is typed as `2110` —
  and each slot refuses digits outside its range (day `0-3`/`0-9`, month
  `0-1`/`0-9`). Insertion is never used, so the value is always five characters.
  A date the calendar lacks (`31.02`) reverts to the last good one on commit,
  as does Escape. The interval takes 1–99, no leading zero: two digits is what
  the design's 29px field holds, and it is why the spec's `0542` cannot survive.
- Both view_options checkboxes only ever **hide**. `visibleExercises` /
  `visibleItems` / `visibleComplexes` are the single source of what is on
  screen, and every drop position they produce is mapped back through
  `fullExerciseIndex` / `fullItemIndex` / `fullComplexIndex` before the store
  sees it. Dates are still worked out over every complex, so filtering can never
  renumber one.

## Not built yet, by design

Cyclic schedule rotation, feedback capture, the workout page, and syncing data
to the repo via the GitHub API (`js/db.js` is the seam for that).

A category switched out of the schedule (`scheduleEnabled`) fades its menu
button, but the rule it exists for — its exercises not appearing on the workout
page — has nothing to act on until that page is built.

## Unverified against the design

Built to the written brief while the Figma MCP was rate-limited. Worth a look
whenever the plan allows a call again:

- **`Date_pointer`'s marker shape.** A white 14×18 CSS triangle at the left end
  of a white 2px rule. The geometry came from the node metadata; the shape
  itself was never seen.
- **The whole Page_selector.** Button padding is `0 8px` (giving 28/31px
  buttons), and the unbuilt workout page's icon is `--not-selected` grey so it
  reads as unavailable. Both are choices, not the design's.
- **Category_block** on a calendar day — a tab strip reusing `.menu-button`.

## Known issue

`.exercise-row__subtitle` clips its last visible line's descenders, the same
defect gotcha 1 describes and the title has been fixed for. Harder here: the
clipping parent `.exercise-row__subtitle-box` is a `flex: 1 1 0` item with
`box-sizing: border-box`, so the compensating negative margin has to go on the
parent and interacts with flex height resolution. Visible in any row whose
description reaches the bottom of its box.

## Testing

```
npm install          once
npm test             all 18 suites, ~640 checks, ~85s
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
- `tests/browser/` — layout, `:hover`, real drag and page switching, via `puppeteer-core`
  driving the Chrome or Edge already installed (`CHROME_PATH` overrides the
  search). jsdom has no layout engine and no `:hover`, so these are the only
  place geometry can be checked.
  Which browser suite covers what: `calendar` the page swap and the calendar
  page, `toolbar` the two masked fields plus the category switch and the
  favourites filter, `complex-drag` / `complex-layout` the schedule page's
  lists, `drag` / `category-layout` / `hover-undo` the category menu,
  `row-layout` / `text` / `page-layout` typography and geometry.
- `tests/browser/harness.html` seeds the app without the file picker:
  `?seed=plain|exercises|text`, `&extras`, `&popup=N`, `&complexes=2,1,1`
  (complex sizes, cut from the seeded exercises), `&off=1` (switch #1 off),
  `&multi` (a second category with its own complexes) and `&page=calendar`.
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

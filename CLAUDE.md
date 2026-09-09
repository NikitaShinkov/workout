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

## Where things stand

Working and in daily use: the Schedule, Calendar and Workout pages, and the data
in git. The user adds exercises and builds the schedule on the computer and reads
it on the phone; both show the same data. Verified end to end against the live
repo, not just in tests.

The Exercise page is built too — Начать now opens it, a complex is walked
through with Button_next, and the three ratings, the time each exercise took and
which exercises were got through are written to the log. That was the whole of
"feedback capture", so it is off the list.

**Next, in the order it was agreed:**

1. **Durable staging for structural writes** — the one real data-loss window
   left. See "The one real weakness left" below; it has a settled design and the
   user's explicit direction on how it should behave.
2. Cyclic schedule rotation.

## Working on this app for real

The data lives in a **second repo**, `NikitaShinkov/workout-data`
(`js/config.js`), which already holds the user's real exercises and photos.
**Reads need no token.** Writes need a fine-grained PAT scoped to that repo alone
with *Contents: read and write*, supplied once per browser origin in the URL
fragment:

```
http://localhost:8080/index.html#schedule&k=github_pat_…      the computer
https://nikitashinkov.github.io/workout/#workout&k=…          the phone
```

It is then kept in localStorage and stripped from the address bar. **Never commit
a token** — GitHub revokes any it finds in a public repo, so the leak costs the
token too. `.gitignore` has a `*token*` backstop because the user keeps theirs in
a text file inside the project folder and `git add -A` once staged it.

Without a token everything still loads and renders; only saving is inert, which
is the right default for a session that is only reading.

**Care when testing by hand:** a write goes to the user's real data. `?offline=1`
skips the network entirely, and the test harness never touches it at all.

## File map

```
index.html            loads js/main.js as a module
js/main.js            initToken(), initStore(), then mountApp()
js/app.js             the shell: which page is mounted, and swapping them
js/store.js           the whole app state; every mutation goes through update()
js/db.js              the persistence seam - two functions, nothing else
js/sync.js            the data repo: read, merge, buffer, flush
js/github.js          Git Data API client (blobs -> tree -> commit -> ref)
js/config.js          which repo the data lives in
js/model.js           domain constants and factories - no DOM, no storage
js/schedule.js        dates: parsing, formatting, buildSchedule, buildCalendar
js/schedule-page.js   page 1 - categories, Exercise_list, Complex_list, drag
js/calendar-page.js   page 2 - every category's schedule, by day. Read-only
js/workout-page.js    page 3 - today / tomorrow / the day after, for a phone
js/exercise-page.js   page 4 - one exercise being performed. Writes the results
js/gesture.js         the numbers behind every horizontal swipe, shared
js/page-selector.js   the header's page switcher, shared by all three pages
js/category-button.js the insides of a category button - ditto, see gotcha 16
js/exercise-row.js    Exercise_block itself, shared by the first two pages
js/toolbar-inputs.js  the masked date field and the guarded interval field
js/exercise-modal.js  Add/edit popup
js/animation.js       the hover image sequence; resumable, see setFrames
js/loading.js         the loading screen - the logo, turning
js/images.js          File -> Blob, and blob URLs
js/dom.js             el() / svg() / clear() - no framework, just these
```

## Decisions already made (don't relitigate)

- **Two public repos.** `workout` is the code and is what Pages builds;
  `workout-data` holds `data/state.json`, `data/log.json` and
  `data/images/<hash>.jpg`. Separate, because a write into the built branch
  rebuilds the site (~10/hour soft limit, ~40s each), which would force a slow
  save cadence; and because a token that can write the code repo could rewrite
  the JavaScript running on the phone. A leak now costs exercise data only.
- **No build step.** Vanilla ES modules served as written.
- **Categories are data**, not constants — user can add / rename / delete / reorder.
- **The repo is the source of truth, not the browser.** Every launch reads it,
  so the computer and the phone cannot drift apart. localStorage holds only the
  token, the op buffer, and a last-good cache so the app still opens with no
  signal - none of it authoritative.
- **Images are content-addressed** (`data/images/<sha256-16>.jpg`), so they are
  immutable, cacheable for ever, and deduplicated. Only the two JSON files are
  ever re-read, and only they need cache-busting.
  The path stored in `state.json` is **relative to the data repo**, so the owner
  and repo name stay out of the data. `blobUrl()` resolves it through
  `rawUrl()` at display time - the data repo is not the site, so a relative
  `src` would resolve against the page and 404.
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

## Storing the data in git

`js/db.js` is still the only seam the store knows about — `loadState()` once,
`saveState(state)` on every mutation — but it now talks to `js/sync.js`.

**Two files, because they have different authors.** `state.json` is a whole-file
snapshot of the structure (reorders and drags do not commute, and there is one
author). `log.json` is an append-only list of **idempotent ops** — `favorite`,
`duration`, `rate`, `done`, `complex` — because the phone writes those and a
snapshot would discard whatever the computer wrote meanwhile. `applyOps()`
merges the log over the structure on load.

`done` is what a workout produces most of: one op per complex ITEM per day,
saying that exercise was got through. Keyed by the item and not the exercise,
because a complex may schedule the same exercise twice and the two have to be
walked through separately — the same reason selection and drag address the item
id. It merges into `state.doneLog[itemId][date]`, which `isItemDone()` in
`js/store.js` is the only reader of.

**`compact()` drops an op once a later one says something about the same
thing**, and `SUPERSEDED_BY` is what "the same thing" means for each kind. A
favourite or a duration has only a current value, so the exercise alone is the
key; `rate`, `done` and `complex` are keyed by day as well, so every day's own
value survives and only the several ops one day produces get collapsed — cycling
an indicator round to the value you meant writes four ops and keeps one. **Those
keys must stay identical to the ones `applyOps` merges by**, or compacting the
log would change what loading it produced.

**`state.json` carries neither `ui` nor the log's fields.** `favorite`,
`lastDurationSec`, `feedback`, `doneLog` and `complexLog` live in the log —
otherwise both files would claim them and fight — and `ui` is a per-device view
preference, so persisting it would make every checkbox click a commit and would
sync `activeCategory` across devices, which is meaningless.
`serializeForRepo()` and `serializeText()` build their output from a named list
of structural fields, so anything else on the state is ignored by construction;
`applyOps()` puts the `feedback` shape back. **A whole workout therefore
provokes no `state.json` write at all**, which `jsdom/sync` section 7 pins.

**Saving is triggered by idle, never by the tab closing.** MDN is explicit that
`pagehide`/`unload` are "not reliably fired ... especially on mobile", and the
case it gives — background the app, later close it from the app manager — is
exactly how a workout ends. `sendBeacon` cannot set an `Authorization` header,
so it cannot reach the API at all. So: buffer synchronously into localStorage on
every op, flush after `FLUSH_IDLE_MS` (4s) of quiet, flush again on
`visibilitychange → hidden` as a bonus, and flush anything left over on the next
launch. The close event stops mattering.

**A write only happens when the state really changed.** `sync.js` keeps a
`baseline` — the serialization of the state as loaded — and compares against it.
That is what stops a view toggle committing, and, more importantly, what stops a
device writing back the pruning `normalizeComplexes()` does on every load.

**The token** rides in the bookmark's fragment (`#workout&k=…`), which is never
sent to a server. `initToken()` must run **before `mountApp()`**:
`pageFromHash()` reads the whole fragment as a page name, so `#workout&k=…`
matches nothing and `goToPage()` would then overwrite the hash and destroy it.
It is copied to localStorage and stripped from the address bar; the home-screen
bookmark still carries it, so it heals itself if storage is ever cleared.
Reads need no token (60/hour per address); writes do (5000/hour).

`?offline=1` skips the network entirely — that is how the browser suites drive
the real `index.html` without depending on a repo, a token or a connection.

**The loading screen** (`js/loading.js`) covers that first fetch. `showLoading()`
returns the function that removes it. `rotateY` with **no perspective** is what
makes the logo squash rather than swing — an orthographic flip, which is the
"horizontal distortion" the brief asked for — and `alternate` on an 800ms
iteration is what plays the second half in reverse with the easing mirrored, so
both directions ease in and out. Measured: scale 1 at 0ms, ~0 (edge on) at
400ms, −1 at 800ms. `browser/loading` pins all of it, including that the logo is
really a gradient (it counts distinct opaque pixel colours) and really is an
`<img>` rather than a mask.

### The one real weakness left

**A structural change lives only in memory until it commits.** The op buffer
(`log.json`) is in localStorage and survives anything, but a brand new exercise
and its photos do not: if the write fails — expired token, no signal — and the
page is reloaded, that work is gone, and nothing on screen says so.

The agreed fix, not yet built: stage pending structural writes durably the
moment they are made, **before** any network call. Photos are `Blob`s, so that
means IndexedDB again — but in a completely different role from the one it used
to have: a write-ahead buffer only, never a source of truth, so it cannot make
the two devices disagree. On the next launch, anything staged is pushed *before*
the app loads, then cleared.

The user was explicit about how this should feel: **prevent the loss, recover
silently, and show no error indicators.** A save that failed and was retried is
not something to report. While a recovery is in flight, put the loading screen
up and keep the app locked so nothing can be edited into a race — which is why
`showLoading()` already hands back its own teardown.

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

The exercise page has no node ids: it arrived as three `design/raw` exports
(`Top_block`, `Description_and_toolbar`, `Toolbar`) plus the written brief, and
the MCP could not be asked for the frames they came from.

The loading screen came from `design/raw/Download_1.json` and `Download_2.json`:
a 236×190 logo on the `--bg` ground, the second frame the same logo rotated 180°.
**The design shows it flat `--not-selected` grey; the app draws it in colour on
purpose** — `app_logo.svg` carries a four-colour gradient and the user asked for
that gradient, so the file is drawn as an `<img>` rather than masked. A mask
takes only the alpha channel, which would flatten it to one colour, so this is
the one place the Page_selector trick is deliberately *not* used. Height is left
to the file (its own 15:12 gives 236×189, a pixel off the design's 190) rather
than forced, so nothing is distorted.

**The Figma MCP is on the Starter plan and its call limit is exhausted.** The
Page_selector, the new header and the whole calendar page were built from the
written brief alone; `get_design_context` and `get_screenshot` both refuse. The
icons were exported by hand into `assets/icons/`, which is the way round this.

**The other way round it is `design/raw/`** — structural JSON exported by the
Figma Raw plugin, one file per frame. It carries the auto-layout numbers
(padding, itemSpacing, sizing modes), the fills as hex, and the text content,
which is enough to build from; what it does NOT carry is vectors, so an `Icon`
child arrives as a bare `type: "VECTOR"`. The workout page came from
`Date_selector.json`, `Complex_list.json` and `Preview_bar.json` that way, and
the exercise page from `Top_block.json`, `Description_and_toolbar.json` and
`Toolbar.json`. Read them with a small `node -e` walker rather than dumping the
JSON — the tree is what matters and the raw file is mostly noise.

**The exercise page's icons were exported by hand**, like the Page_selector's,
and unlike the Page_selector's they are drawn as plain `<img>`s: each level of
each axis is a DIFFERENT drawing (technique 30x40 easy, 26x40 moderate, 39x37
hard) and the exported file already carries the right colour, so both the
geometry and the fill are wanted. A mask would throw the colour away and there
is nothing to gain by it. `ratingIcon()` in `js/model.js` builds the path from
`<axis>_<level>`, which is why `strength__moderate.svg` was renamed to
`strength_moderate.svg` — the double underscore was an export slip.
The close button reuses `close.svg` at 18px rather than needing a new asset.

**The Page_selector icons export as a solid white fill**, so on the active
button's white ground they would vanish. They are painted as a **CSS mask over
`currentColor`** rather than as an `<img>` — one file then covers both states
(white, black when active) with the exported geometry untouched. Each keeps its
own exported size: calendar 12×12, workout 15×12. The buttons carry no text, so
they are addressed by `data-page` and named by `aria-label`.

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
   And **`-webkit-line-clamp` does not drop the lines past the limit** — it lays
   them out and leans on `overflow: hidden` to hide them. So gotcha 1's padding
   trick is unusable on a clamped element: widening the clip for the last line's
   descenders widens it for the next line's ascenders too, and 4px was enough to
   show a row of glyph tops. Move the **trim edge** instead —
   `.exercise-row__subtitle` uses `text-box: trim-both cap text`, whose under
   edge is the font's descent rather than the baseline. That reaches the
   descenders and stops short of the next line's box, and leaves the over edge
   on `cap` so the 8px gap up to the title is untouched. `browser/text` section
   4 pins both sides of that window.
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
18. **An `<img>` is natively draggable, and starting that drag fires
    `pointercancel`.** So a swipe that begins on an image never gets its
    `pointerup`: the workout page's swipe did nothing at all, and the only clue
    was a `pointercancel` at `clientX: 0`. `js/animation.js` sets
    `img.draggable = false` on the frame it creates — nothing ever drags the
    frame itself, and on an exercise row it was hijacking the row's own drag
    too. `user-select: none` on the container handles the other cancel source,
    a text-selection gesture.
19. **A gesture that commits on a timer needs the timer, not `transitionend`.**
    jsdom runs no transitions, so `transitionend` never fires there and the
    swipe would never commit. `release()` starts the CSS transition and sets a
    `setTimeout` for the same duration; the timeout is what moves
    `previewIndex` and re-renders. It is cancelled by `render()` and by the
    page teardown, because it holds a node from the render it started in.
20. **`flex: 1 1 0` does not make two siblings equal if one has padding.** With
    `box-sizing: border-box` a flex base size of 0 cannot resolve below the
    element's own padding, so `padding: 20px` made the workout page's
    Complex_list exactly 40px taller than the image_block beside it. Put that
    air on the children (`> :first-child { margin-top }`) and the two halves
    match. The list still needs the horizontal padding, which costs nothing.

21. **Two pages may not share a class name, and `.exercise-toolbar` was
    already taken.** The exercise page's Toolbar was given that name and
    silently inherited `height: 24px` from the strip of fields over the schedule
    page's Exercise_list. Because the Toolbar aligns its buttons to its own
    BOTTOM edge, a 24px-tall toolbar did not clip them — it let the 69px
    indicators and the 82px Button_next overflow *upwards*, straight over the
    description. It is `.exercise-controls` now, and the toolbar carries
    `flex-shrink: 0` so that nothing can squeeze it again; the description is
    the only part of the block allowed to give.
    **Two lessons.** Grep the stylesheet for a class name before using it — the
    `.exercise-*` prefix already belongs to the exercise *list*. And a
    flex-end-aligned container that is shorter than its children overflows
    rather than clipping, so the symptom appears somewhere other than the bug.
    Found by looking at a screenshot while every assertion passed, which is
    lesson 3 below for the third time.
22. **An empty GitHub repo refuses the Git Data API outright.**
    `/git/ref/heads/main`, `/git/blobs` AND `/git/trees` all answer
    `409 "Git Repository is empty."`, so the first commit cannot be built out of
    blobs and a tree at all. The **Contents API** (`PUT /contents/README.md`) is
    the only door into a repo with no commits, and it creates the branch as a
    side effect — so `commitFiles()` bootstraps with a README once, then takes
    the normal path for ever after.
    **The lesson is about the fake, not the API.** `jsdom/sync` passed while the
    real thing failed, because the fake allowed blobs and trees on an empty
    repo. A fake that is more permissive than the real service is worse than no
    test: it converts "untested" into "believed working". When a fake stands in
    for something external, make it refuse what the real one refuses — and probe
    the real one with `curl` to find out what that is.
23. **Never persist `ui`, and never save on a `ui` change.** `setUiFlag` and
    `setActiveCategory` go through the same `update()` as everything else, so a
    naive "save on every mutation" turns ticking a checkbox into a git commit.
24. **A year-less date is a New Year bug.** `scheduleStartDate` used to be
    stored as its display form (`"3 сен"`), and `parseStartDate` resolves that
    in the *current* year — so every schedule in the app jumped twelve months on
    1 January. Stored as ISO now; `"3 сен"` is display only. Verified either
    side of the boundary.

25. **A borrowed hover fill has to yield to the real one, and that takes CSS.**
    The linked row's class is dropped when the pointer really arrives in
    Exercise_list — but Up/Down work from anywhere on the page, so the pointer
    may ALREADY be over the list when a keypress sets the highlight, and a
    pointer that is already there arrives nowhere (gotcha 26), so nothing
    fires and two rows would look hovered at once.
    `.exercise-list:hover .exercise-row--linked:not(:hover)` clears the fill
    for as long as the pointer is in the list, and the `:not(:hover)` is
    load-bearing: without it that rule (three classes) outranks
    `.exercise-row:hover` (two) and the hovered row itself would go
    transparent — the one row that must keep its fill. `mouseleave` clears the
    class as well, so a highlight the pointer has sat through cannot reappear
    behind it.

26. **A render under a stationary pointer fires `mouseenter` on the new node.**
    Every keyboard move re-renders, which replaces Exercise_list — and Chrome
    then re-runs hit-testing and dispatches `mouseenter` to the fresh element
    the pointer is now "over", though the pointer never moved. The handler that
    ends the borrowed highlight ran on that, so navigating with the pointer
    resting anywhere over Exercise_list threw the highlight away the instant it
    was set. Both crossing handlers now return early while hover is parked:
    while the park is on, nothing about the pointer counts as it arriving
    anywhere. The mirror case is the pointer that is inside the list when the
    park is *lifted* — no mouseenter fires for a pointer already there, and the
    swallowed one is not coming back, so `onDocumentMouseMove` ends the
    highlight itself when the movement happened inside the list.
    Same family as gotcha 15 and 9: a render throws away the node an
    interaction was living on, and the events that follow are about the new
    node, not about the user.

## Pages

`js/app.js` is the shell: it mounts one page into `#app` and swaps it on
demand. Each page owns its own header, its own document-level listeners and its
own store subscription, so **every mount returns the function that undoes it** —
skip that and two pages render into the same container and both react to every
mutation. `browser/calendar` guards it (`A MUTATION RENDERS ONE PAGE, NOT TWO`).

**The hash names the page**, and nothing else does: `index.html#workout` opens
the workout page directly, which is how it reaches a phone. `goToPage()` writes
the hash, `mountApp()` reads it once, and a `hashchange` listener makes the
back button walk the pages visited. A hash naming no page falls back to the
schedule. That is the *only* routing — the page is still not persisted, so a
plain `index.html` always opens on the schedule.
`browser/workout-layout` section 10 guards all of it.

**`#exercise` is the exception, and `NEEDS_SESSION` in `js/app.js` is why.**
The exercise page is half of a session — which complex, which exercise, and the
moment the clock started — and none of that is persisted, deliberately: a
workout resumed tomorrow from a bookmark is not the same workout. So
`pageFromHash()` refuses to return `exercise` unless a complex is actually being
performed, and a bookmark of it lands on the schedule instead. Mounting it with
no session draws nothing and leaves for the workout page, deferred with
`setTimeout(…, 0)` — navigating from inside a mount would leave the shell
holding this page's teardown for the page that replaced it.

**Page_selector holds only calendar and workout — the schedule has no button.**
A category *is* the way to the schedule, from any page: the calendar's and the
workout page's headers carry the category list as navigation, and picking one
opens that category's schedule. So on the schedule page nothing in the selector
is active, and the selector reads as "somewhere else you can go".

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
- **workout** (`js/workout-page.js`) — read-only apart from Начать, and the
  only page built for a phone. Three blocks: Date_selector (today / tomorrow / the day after,
  today by default), image_block with its Preview_bar, and Complex_list. The
  two lower blocks split what is left of the height in half.
  It shows **every category's** complexes for the chosen day, so it reads
  `buildCalendar()` the way the calendar does; `buildWorkoutDays()` is exported
  and is where all the arithmetic lives, which is what `jsdom/workout` tests.
  image_block is a **viewport over a track** carrying the exercise on screen and
  its two neighbours, parked a block-width to either side. The swipe translates
  the track 1:1 under the finger and is only committed when the finger lifts -
  re-rendering mid-gesture would replace the node being dragged, the same rule
  the schedule page's drag lives by. Every rendered slide plays, so at most
  three sequences run and the arriving exercise is already alive.
  Its header is the same `.categories` block in the same place — no
  view_options, since neither the indicators nor the favourites column has
  anything to act on here.
- **exercise** (`js/exercise-page.js`) — one exercise of one complex, being
  performed. The only page that WRITES what a workout produced, and the only
  one with no header at all: it is the whole screen while a workout is on, and
  the close button is the way off it. Four blocks, and image_block takes
  whatever the other three leave — top_block floating over the picture,
  image_block, Description_block, Toolbar. Reached only through Начать; see
  `NEEDS_SESSION` above.

`js/exercise-row.js` holds Exercise_block itself. The schedule page and the
calendar agree on how it *looks* and disagree about what it *does*, so
everything behavioural arrives through options and nothing in there reads the
store. The hover-animation registry lives there too, which is why both pages
call `stopAllRowAnimations()` before a render. The workout page uses none of it
— its Complex_block is its own thing, and it drives `createSequenceAnimation`
directly.

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
- **Up/Down move the selection, Shift extends it, Ctrl+Shift takes it to the
  end of the list.** The selection carries a `focus` alongside its `anchor` —
  the anchor is what a range grows FROM, the focus is what the next key moves
  from — and `moveSelection()` works in all three scopes. **Inside a complex
  "the list" is that complex's own blocks.** Item keys are flattened across
  every complex so that a shift-CLICK can still span them, but `navBounds()`
  confines the keyboard to the one the cursor is in: Down on a complex's last
  block does nothing, and Ctrl+Shift+Down stops at its end rather than running
  into the next complex. A key that cannot move changes nothing at all.
- **Enter groups the Exercise_list selection into one complex** at the end of
  the list — the same thing Ctrl+G does, from a key that needs no modifier.
  Both go through `groupLibrarySelection()`, which returns false when the
  selection is not in Exercise_list so the key is left to the browser rather
  than swallowed. Ctrl+G is matched on `event.code` and Enter on `event.key`,
  because Enter is layout-safe and the letter keys are not (gotcha 5).
- **A keyboard move parks hover until the mouse moves.** The keys move the
  selection and the pointer stays where it was left, so the block under it
  would go on drawing its hover fill — and two filled blocks read as two
  selections, which the selection model forbids outright. So a move that lands
  somewhere puts `hover-off` on the `<body>`, which **every hover half in the
  stylesheet is guarded against** (`body:not(.hover-off)`); the selected halves
  are never guarded, because a selection is not a hover. The park is lifted by
  the first `mousemove` whose coordinates really differ from the last —
  comparing them matters, since Chrome emits a mousemove after a programmatic
  scroll and a keyboard move scrolls both lists. A key that could not move
  parks nothing: it changed nothing to be confused with.
- **Selecting a block inside a complex points Exercise_list at the exercise it
  references**: that row scrolls to the middle of the list and borrows the
  hover fill (`exercise-row--linked`). It does **not** become selected — there
  is one selection on the page and it stays on the block that was clicked.
  Only a plain click or a plain Up/Down re-points it; Shift and Ctrl leave the
  highlight on the block the run started from, which is what the spec asks
  for. The pointer reaching Exercise_list ends it —
  `clearLinkedHighlight()` drops the class by hand, because gotcha 15 forbids
  re-rendering from a mouse handler — and gotcha 25 is the other half of that.
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
- **An exercise's duration is `lastDurationSec`**, seeded to
  `DEFAULT_DURATION_SEC` (120 = 2 min) and overwritten with what the exercise
  actually took every time Button_next confirms one. `exerciseDuration()` in
  `js/model.js` is the single reader, so every estimate in the app — a
  Complex_block's "25 мин", Button_next's remaining time — is built from the
  same number and improves as the exercises get performed.
- **A workout Complex_block's equipment is the union of its exercises'**, walked
  in `EQUIPMENT` order rather than in mention order so the same complex always
  reads the same way, and capitalised only as a whole line
  (`Коврик, короткая лента, рол`).
- Counting things in Russian needs three forms, so `plural()` in
  `workout-page.js` is exported and tested — including the 11–14 exception,
  which a naive `n % 10` gets wrong (`11 упражнений`, not `11 упражнение`).
- The workout page's **Начать appears only on today's blocks**, and only while
  the complex still has something left to do. See "The exercise page" below.
- **The swipe is a carousel, not a swap.** The track follows the finger 1:1
  while there is a neighbour to bring in; at either end of a complex it follows
  only `EDGE_RESISTANCE` (0.28) of the travel, capped at `EDGE_MAX_PX` (56), so
  the end is felt rather than hit. On release it either glides on to the next
  slide (200ms, an ease-out that starts fast so the gesture reads as finished)
  or springs back (260ms, gentler).
- **The gesture holds the pictures still.** Every rendered sequence is paused on
  pointerdown and resumed on release — `stop()` keeps the frame and `start()`
  picks up from it — so the image the finger is dragging cannot change under it.
- **`previewIndex` changes when the settle timer lands, not on pointerup**, so a
  test must wait the settle out before asserting which exercise is *showing*.
  The **Preview_bar is the exception**: `markPreviewBar()` moves the active
  segment by hand the instant the finger lifts, because waiting 200ms for the
  settle made the whole page feel like it lagged behind the gesture. By hand and
  not by rendering, for the usual reason — a render would replace the very track
  that is mid-glide.
- **Frames survive a render.** `frameByExercise` remembers where each exercise's
  sequence had got to, and `setFrames(urls, startAt)` puts it back. Without it
  every render — and a swipe ends in one — restarted every animation at frame
  one, so the picture flinched exactly as it arrived.

### The exercise page

- **Начать is on today's complexes, and only while there is something left in
  one.** A complex that has been got through carries no button at all rather
  than an inert one.
- **`metaLine()` has two forms, and which one is used says how far along the
  complex is.** A complex that is untouched *or* finished is described whole —
  `5 упражнений, 25 мин` — and the difference between the two is what the time
  MEANS: before, an estimate built from the last performances; after, what this
  one actually took, so the same line becomes `5 упражнений, 17 мин`. Hence
  `totalMinutes` alongside `minutes` on a card. Only part way through does it
  count what is LEFT: `3 из 5 упражнений, 15 мин`, the minutes being the sum
  over the exercises still to do. (`0 из 5 упражнений, 0 мин` is what the
  finished case used to say. It was true and useless.)
  The noun in the part-done form agrees with the **total**, not with the count,
  because it belongs to "из 5": `3 из 5 упражнений`, and `1 из 1 упражнения`
  for the one case that ends in a one.
- **Начать opens the first exercise still to do**, not the first exercise, so a
  complex closed half way through carries on where it was left. Finishing the
  last one leaves for the workout page and drops the highlight, so the first
  complex with anything left to do takes over.
- **The indicators cycle easy → moderate → hard → not selected → easy.**
  `none` is a rating in its own right — "performed, nothing to report" — which
  is why it sits in the cycle rather than only being the starting point.
  `RATING_CYCLE` and `nextRatingLevel()` in `js/model.js` own the order.
- **Easy is DISPLAYED, not recorded.** An exercise opened with nothing recorded
  for the day shows all three on Easy, because that is the common answer and it
  puts the value one tap away. Nothing is written until the user taps an
  indicator or confirms the exercise, so merely opening a page cannot invent a
  rating. What IS recorded for today is what comes back on screen, which is how
  a page closed and reopened restores what was chosen.
- **Every tap writes its own op, immediately.** That is why closing the page has
  nothing to save: each indicator and the star have already recorded themselves,
  synchronously into localStorage. Button_next then writes all three whether
  they were touched or not — what is on screen is what the user saw and let
  stand — plus the duration and the completion.
- **The clock is module state and is thrown away on close.** A workout closed
  and picked up an hour later did not take an hour, so `startedAt` is reset
  rather than persisted, and Button_next restarts it for each exercise.
- **Button_next's ring is built, not exported.** The number of segments follows
  the complex, so each is its own `<circle>` carrying a single dash
  (`stroke-dasharray="len C"`, so the pattern cannot repeat) positioned by a
  negative `stroke-dashoffset`, with the whole group turned `rotate(-90)` so the
  count starts at the top instead of at three o'clock. `butt` caps, or a round
  one would eat into the 2px between neighbours from both sides. The exported
  `Progress_ellipse_3_4.svg` / `_4_4.svg` are one drawing of one four-segment
  case and are **not used**.
  The segment being performed alternates every 500ms, which is `steps(1)` over
  a 1s animation — two half-second halves, and a switch rather than a fade.
- **A swipe on image_block turns the animation into the sheet of every image**,
  and back the other way. It is a two-panel carousel using the same numbers as
  the workout page's (`js/gesture.js`), so the two feel the same, and it resists
  at both ends for the same reason.
- **Where the images go on the sheet is measured, not ruled.**
  `chooseSheetLayout()` compares how much of the block a pair covers side by
  side against one above the other and takes the larger — which reproduces both
  of the brief's examples (wide images stack, tall ones sit in a row) without a
  rule about shape, and takes the block's own proportions into account too.
  One image gets the whole block, and so does a pair; both **stretch**, which is
  what the brief asks of them.
  It needs the images' shapes and the size of the block, neither of which is
  known during a render, so the class is applied **after** the append by
  `applySheetLayout()` and re-applied on a resize without rebuilding anything.
  The shapes are measured once per url with an off-document `Image`; the
  animation has already fetched them, so it costs nothing.
- **Three or more images do NOT stretch.** Two columns, read
  `1 2 / 3 4 / 5 6` so an odd last one sits in the first column — but the rows
  are `auto` and the images are `height: auto`, so a row is the height of the
  *pictures* rather than a share of the block. Giving each a quarter of the
  height instead left a landscape photograph `contain`ed in the middle of its
  cell with a band of ground above and below it, so the design's 4px gap read as
  forty. With content-height rows the only space between two pictures is the
  gap.
  The grid then no longer fills the block, so it is **centred** in it — and by
  `margin: auto` rather than `align-content: center`, because auto margins
  collapse to zero once the content overflows, whereas centring would push the
  first row up out of reach above the scrollport. `max-height: 100%` plus
  `overflow-y: auto` is what makes it a scrollport only when it needs to be: a
  sheet that fits shows no scrollbar at all. `overscroll-behavior: contain`
  keeps the scroll in the grid, and `sheetScroll` carries its position across a
  render so tapping an indicator does not throw you back to the first picture.
  The animation beside it is a different element and cannot be moved by any of
  this.

## Not built yet, by design

**Cyclic schedule rotation** is the only feature left of the original brief.

And the durability gap above — that one is a known weakness rather than a
deliberate omission, and it is the next thing to do.

Two smaller things the exercise page leaves open, neither of which the brief
asks for:

- **Nothing can be un-done.** `setItemDone` takes a flag and the `done` op
  carries `done: false`, both tested, but no screen produces it: an exercise
  confirmed by mistake stays confirmed until tomorrow. The mechanism is there
  if it is ever wanted.
- **The remaining time does not count down.** It is built from the historical
  durations and is recomputed per exercise, which is what the brief asks for —
  it is an estimate of what is left, not a running clock.

A category switched out of the schedule (`scheduleEnabled`) fades its menu
button, and that is now visible in three places: it drops out of the calendar
and out of the workout page as well, because `buildCalendar()` skips it.

## Unverified against the design

Built to the written brief while the Figma MCP was rate-limited. Worth a look
whenever the plan allows a call again:

- **`Date_pointer`'s marker shape.** A white 14×18 CSS triangle at the left end
  of a white 2px rule. The geometry came from the node metadata; the shape
  itself was never seen.
- **The whole Page_selector.** Button padding is `0 8px`, giving 28/31px
  buttons. A choice, not the design's.
- **Category_block** on a calendar day — a tab strip reusing `.menu-button`.
- **image_block.** There is no design file for it, only the brief. It is a plain
  area with the frame `object-fit: contain`ed into it — no ground, no border, no
  radius — on the grounds that this is the picture being worked from, so none of
  the pose may be cropped and nothing should compete with it.
- **The swipe's numbers.** 200ms / 260ms, the two easing curves, and the 0.28 /
  56px edge resistance were all chosen to read as "short, smooth and
  unobtrusive"; none of them came from a design file.
- **The workout page's vertical rhythm.** "Upper half / lower half" is read as
  the two blocks splitting whatever the Date_selector leaves, and the 40px the
  Date_selector carries in Figma is treated as the top inset (so `.page--workout`
  drops the shell's own 24px gap). The 400px desktop cap is centred, which is a
  choice — the header above it is left-aligned.
- **Start_button's icon.** `Complex_list.json` has an `Icon` VECTOR child, but
  the button is 54px wide and `6 + 42 + 6` is already 54 — there is no room for
  one, so it is rendered as text alone. Raw JSON carries no vectors, so this
  cannot be settled without a screenshot.
- **top_block's close symbol.** The design has an 18x18 filled VECTOR; the app
  draws `close.svg` — a two-line cross with round caps — at 18px, whose 8px
  viewBox scales the 1px stroke to 2.25px. It reads right on a 44px button but
  it is not the exported glyph.
- **Button_next's insides.** The design is a GROUP, so it carries no layout:
  the 29px arrow over the time with a 4px gap, both centred, is a choice. So is
  the whole ring being generated rather than exported — the exported
  `Progress_ellipse` files only cover four segments, and the count has to follow
  the complex.
- **The description's 14px line-height.** Taken from the design's 353x84 text
  box over six lines. It is tight for Cyrillic descenders and was not seen
  rendered. Nothing caps the block and nothing in it scrolls, so a very long
  description takes the height it needs and image_block gives it up — that is
  the user's own instruction, and the design has no case for it.
- **The sheet of every image.** There is no design file for it at all, only the
  brief's rules. Which arrangement a pair takes is decided by measuring covered
  area (`chooseSheetLayout()`), which reproduces both of the brief's examples —
  but the brief describes the outcome, not the method, so a case it disagrees
  with is possible. The 4px gaps and the two columns are the brief's own.
- **`--progress-off: #3b3b3b`.** The brief's own hex, one shade off the
  `--hover-bg-block` `#3a3a3a` already in the stylesheet. Kept as its own token
  rather than folded into that one, because the brief is explicit — but if they
  are meant to be the same colour, this is the place it would show.

## Testing

```
npm install          once
npm test             all 26 suites, ~1150 checks, ~155s
npm test -- jsdom    only the logic suites
npm test -- drag     only suites matching "drag"
```

`tests/run.mjs` starts `dev-server.js` on port 8123, runs each suite in its own
process and prints a summary. **Run it after any change** — it is fast and it
covers behaviour that is easy to break silently.

- `tests/jsdom/` — logic: store, modal, selection, categories, undo, drag,
  complexes, keyboard selection, the workout page, the exercise page, and the
  data-repo sync. **Nothing here touches the network**: the suites call
  `resetStore(seed)` rather than `initStore()`, and `sync.test.mjs` replaces
  `fetch` with a fake GitHub that records what was committed. `migrate()` is
  exported and tested as the pure function it is,
  against the same version-1 fixture as before.
  `complexes.test.mjs` installs a **fake layout engine** (`layout()`) that gives
  every complex and row a rect, because every drop decision is geometric and
  jsdom's rects are all zero. Anything that re-renders — a click, a key, a
  toggle — throws those rects away, so the helpers call `layout()` again.
- `tests/browser/` — layout, `:hover`, real drag and page switching, via `puppeteer-core`
  driving the Chrome or Edge already installed (`CHROME_PATH` overrides the
  search). jsdom has no layout engine and no `:hover`, so these are the only
  place geometry can be checked.
  Which browser suite covers what: `list-sync` the two schedule-page lists
  read together — the centring scroll, the borrowed hover fill, the real
  `:hover` taking it back and hover parked by a keyboard move, plus
  Shift+Down and Enter driven from a real keyboard — `calendar` the page swap
  and the calendar page, `workout-layout` the workout page, its phone
  breakpoint, its swipe and the hash routing, `exercise-layout` the exercise
  page — top_block floating
  over the picture, the description sizing itself to its text, the Toolbar,
  Button_next and its ring, the swipe onto the sheet and how the sheet divides
  the block — `loading` the loading screen and its turn, `toolbar` the two
  masked fields plus the category switch and the favourites filter,
  `complex-drag` / `complex-layout` the schedule page's lists, `drag` /
  `category-layout` / `hover-undo` the category menu, `row-layout` / `text` /
  `page-layout` typography and geometry.
  Two of them hold the network open on purpose so a transient state stays put
  long enough to measure: `loading` delays the API so the screen it covers is
  still there, and `workout-layout` holds a pointer down to catch the swipe
  mid-gesture.
- `tests/browser/harness.html` seeds the app without the file picker:
  `?seed=plain|exercises|text`, `&extras`, `&popup=N`, `&rows=N` (repeat the
  seeded exercises up to N numbered rows, so Exercise_list is long enough to
  scroll), `&complexes=2,1,1`
  (complex sizes, cut from the seeded exercises), `&off=1` (switch #1 off),
  `&multi` (a second category with its own complexes), `&start=today` (move
  every category's start date to today, which is the only way the workout page
  has anything to show), `&images=N` (N images per exercise instead of two, so
  the exercise page's sheet has a single, a pair and a grid to lay out) and
  `&page=calendar|workout|exercise`. `&page=exercise` starts the active
  category's first complex the way Начать does and then goes there, because the
  page cannot be reached by naming it; it needs `&start=today` with it.
  It also calls `resetExerciseState()`, because a session is module state that
  reloading the harness does not by itself clear.
- Screenshots land in `tests/.out/` (gitignored) — read them when a layout
  assertion looks suspicious.

Ten lessons paid for in debugging:

1. Assert **rendered** geometry, not `scrollHeight` — that is the *unclamped*
   height, so a working clamp still reads as "3 lines".
2. "Text overflows" is not "an ellipsis was drawn". A green truncation
   assertion hid text being clipped mid-glyph; a zoomed screenshot caught it.
3. Look at the screenshots. Two real bugs — the dead line-clamp and the close
   button landing under the cursor after a delete — were found by eye while the
   assertions were passing.
4. **Never use `:nth-of-type` / `:last-of-type` inside `.complex-list`.** The
   Date_pointer is a `div` sibling of the complexes, so it counts, and *where*
   it sits depends on today's date — a suite written on one day started failing
   on the next. Address complexes with `.complex-list .complex` and index.
5. When a fix is a guess about how a CSS feature behaves, **write the test that
   would fail on the wrong guess and run it against the wrong version.** The
   descender fix was attempted twice; only reverting each attempt under the new
   assertions showed which one actually held.
6. **A suite that needs today's schedule has to move the start date.** Every
   category defaults to `3 сен`, which is in the past for most of the year, so
   a workout-page suite seeded the ordinary way shows three empty days and every
   assertion about content silently passes on nothing. `&start=today` exists for
   that; assert a card count, not just the absence of an error.
7. **`page.goto()` with only a hash change is a same-document navigation** — the
   app never restarts, so a test of "what does this URL open on" measures the
   page that was already there. Add a throwaway query (`?a=1#nonsense`) to force
   a real load.
8. **jsdom's `btoa` rejects input a browser encodes fine.** It threw
   "The string to be encoded contains invalid characters." on plain ASCII with
   newlines, which reads exactly like an encoding bug in the app — it is not.
   Leave Node's own `btoa` and `TextEncoder` in place in the jsdom suites
   rather than aliasing the jsdom ones.

9. **An assertion that reads through a nested object CRASHES the suite instead
   of failing it.** `getState().complexLog[complexId][DATE] === true` threw when
   the complex was never finished, so the run died at that line and printed
   none of the results collected before it - the one failure hid the twelve
   others that would have said what was actually wrong. Reach through with
   `(x[a] || {})[b]`, and give every `querySelector` chain in a detail argument
   a null-safe helper. The suite has to survive its own failures to be worth
   reading.

10. **A timing assertion needs margin, or it asserts something false at the
   boundary.** `browser/loading` sampled the logo every 100ms across a 800ms
   half-cycle and checked the turn never reversed - but each round trip costs a
   few ms, so the last sample landed just past 800ms where `alternate` has
   legitimately started turning back. It passed alone and failed in a full run.
   Assert monotonicity only over samples that are safely inside the window, and
   use the extreme (`Math.min`) rather than a fixed index for the turning point.
   Repeat a suspected flake in a FULL run - the loading suite passed every time
   on its own.

Adding `"type": "module"` to package.json is why `dev-server.js` uses `import`.

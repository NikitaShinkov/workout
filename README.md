# Workout / training app

Plain HTML, CSS and ES modules. No build step, no npm dependencies, no framework.

## Run it locally

```
node dev-server.js
```

Then open http://localhost:8080.

A server is required: `index.html` loads ES modules, and browsers block module
loading over `file://`. Opening the file directly will show a blank page.

## Tests

```
npm install
npm test
```

24 suites, about 1065 checks, ~135 seconds. The logic suites run under jsdom;
the layout ones drive the Chrome or Edge already installed on the machine (set
`CHROME_PATH` if it is somewhere unusual). `npm test -- jsdom` runs a subset.

The app itself still ships no dependencies — these are `devDependencies` only,
and nothing in `js/` imports them.

## What is implemented

Stage 1 — the Schedule page and the "add exercise" popup:

- Categories: click to switch (same tab), double-click to rename in place
  (Enter or a click outside saves, Esc cancels), drag horizontally to reorder,
  and **+** adds one that opens straight into renaming. The button width holds
  steady while renaming and follows the saved name.
- Deleting a category (the X on the active button) hides it and offers a 5s
  undo, by button or `Ctrl+Z`; the countdown runs down on the button. Deleting
  several in a row stacks them, newest first. The X only appears on the *second*
  hover after a category is opened, so it never lands under the cursor that just
  clicked.
- **Add exercise** (in the exercise toolbar, or below the header when the
  category is empty) opens the system file picker, then the popup.
- Popup: animated preview of all images cycling at 0.4s, thumbnails in rows of
  four, drag-and-drop reordering within and between rows, replace-all photos,
  name, description, and the fixed equipment list.
- Equipment selection is remembered and pre-ticked for the next new exercise.
- Exercise list: hover, click to select, Shift for a range, Ctrl for
  non-contiguous selection, Del to delete, double-click to edit.
- The indicator and favourites buttons in `view_options` show or hide the
  feedback indicators and the star on each row. The star toggles the exercise's
  favourite flag.
- Everything is stored in git (see below), so the computer and the phone show
  the same data.

Keyboard: `Ctrl+D` starts a new exercise, `Del` deletes the selected rows,
`Enter` saves in the popup and `Ctrl+Enter` adds a line break there.

Stage 2 — complexes, a schedule, and two more pages:

- Complexes: drag exercises from the list into the schedule column to build
  them, reorder inside and between them, and switch one out of the schedule.
  Dates run from a start date at a fixed interval, one enabled complex per slot.
- **Calendar** page — every category's schedule laid out by day, read-only.
- **Workout** page — the complexes scheduled for today, tomorrow and the day
  after, with the selected complex's exercises animated above the list and a
  swipe to walk through them — the next exercise slides in as the current one
  slides out, following the finger, and the ends of a complex resist and spring
  back. Built for a phone: on a narrow screen it drops the header entirely, and
  `index.html#workout` opens it directly.

Stage 3 — the data lives in git:

- A second public repo, `workout-data`, holds `data/state.json`,
  `data/log.json` and `data/images/<hash>.jpg`. The app reads it on every
  launch, so both devices see one copy of the data. Nothing authoritative is
  kept in the browser.
- Writing needs a fine-grained GitHub token with **Contents: read and write** on
  that repo alone. It is passed once in the bookmark URL
  (`…/#workout&k=github_pat_…`), then kept locally and stripped from the address
  bar. It is never committed — GitHub auto-revokes tokens found in public repos.
- Changes are buffered and pushed a few seconds after you stop making them, and
  again when the page is hidden. Anything unsent is pushed on the next launch,
  so nothing depends on the tab closing cleanly.
- Images are named by the hash of their own bytes: immutable, cached for ever,
  and identical pictures stored once.

Stage 4 — performing a workout:

- **Exercise** page — what `Начать` opens. The picture animates through the
  exercise's images; swipe left and the whole set is laid out at once — one
  image fills the block, a pair goes side by side or one above the other
  depending on which leaves them bigger, and three or more form two columns at
  their own height, 4px apart, centred in the block and scrolling only if they
  do not fit. Swipe right to go back. Under it, the name with a favourites star and the description, and a
  toolbar of three indicators — **Техника**, **Амплитуда**, **Сила** — that
  cycle easy → moderate → hard → not selected on each tap.
- `Button_next` confirms the exercise and opens the next one. It carries a
  progress ring with one segment per exercise in the complex — grey behind you,
  blue ahead, blinking for the one on screen — and the time left over this
  exercise and the ones after it, built from how long each actually took last
  time.
- Confirming an exercise records the three ratings, its duration and its
  favourite state for today: one record per exercise per date, overwritten if
  it is performed again the same day, while the ratings keep their history
  across every date the exercise was performed on.
- Closing keeps whatever was chosen and forgets the clock. `Начать` on the same
  complex then opens the first exercise still to do, with its values restored.
- A complex that has been got through loses its `Начать` and goes back to
  describing itself whole, at the time it really took — "5 упражнений, 25 мин"
  becomes "5 упражнений, 17 мин". A part-done one keeps the button and says
  what is left — "2 из 3 упражнений, 4 мин".

Not built yet, by design: cyclic schedule rotation.

## Layout

```
index.html          the app shell
css/app.css         all styles; Figma design tokens are the CSS variables
dev-server.js       local static server (development only)
assets/icons/       icons exported from Figma
js/
  main.js           entry point
  app.js            which page is mounted, and swapping them
  model.js          categories, equipment, factories
  store.js          state, mutations, persistence
  db.js             the persistence seam
  sync.js           the data repo: read, merge, buffer, flush
  github.js         Git Data API client
  config.js         which repo the data lives in
  schedule.js       dates, buildSchedule, buildCalendar
  images.js         file import, downscaling, object URLs
  animation.js      reusable image-sequence animation
  dom.js            small DOM helpers
  schedule-page.js  the schedule page
  calendar-page.js  the calendar page
  workout-page.js   the workout page
  exercise-page.js  the exercise page - the only one that writes results
  gesture.js        the numbers behind every horizontal swipe
  exercise-modal.js the add / edit exercise popup
```

`js/animation.js` is standalone, which is how the exercise rows, the popup's
preview and both the workout and exercise pages share one image-sequence player.
`js/gesture.js` does the same job for the swipes: the two pages do different
things with a horizontal drag, but they have to feel the same.

## Design source

Figma file `ULWMwUv9ivvkRUaHA1JikX`, frames `Schedule_page` (1:1824),
`Schedule_page_no exercises` (56:3253) and `Add_exercise_popup` (54:1097,
56:1316). The workout page was built from `design/raw/*.json` — `Date_selector`,
`Complex_list` and `Preview_bar` — and the exercise page from `Top_block`,
`Description_and_toolbar` and `Toolbar`, all exported by the Figma Raw plugin.
The sheet of every image has no design file at all; its rules come from the
written brief.

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

22 suites, about 815 checks, ~105 seconds. The logic suites run under jsdom; the
layout ones drive the Chrome or Edge already installed on the machine (set
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

Not built yet, by design: cyclic schedule rotation, the exercise-execution page
behind the workout page's `Начать` button, and feedback capture — the storage
for ratings and timings is built and tested, but there is no screen yet that
records them.

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
  exercise-modal.js the add / edit exercise popup
```

`js/animation.js` is standalone, which is how the exercise rows, the popup's
preview and the workout page all share one image-sequence player.

## Design source

Figma file `ULWMwUv9ivvkRUaHA1JikX`, frames `Schedule_page` (1:1824),
`Schedule_page_no exercises` (56:3253) and `Add_exercise_popup` (54:1097,
56:1316). The workout page was built from `design/raw/*.json` — `Date_selector`,
`Complex_list` and `Preview_bar`, exported by the Figma Raw plugin.

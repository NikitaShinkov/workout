# Workout / training app

Plain HTML, CSS and ES modules. No build step, no npm dependencies, no framework.

## Run it locally

```
node dev-server.js
```

Then open http://localhost:8080.

A server is required: `index.html` loads ES modules, and browsers block module
loading over `file://`. Opening the file directly will show a blank page.

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
- Everything is persisted in the browser (IndexedDB) and survives a reload.

Keyboard: `Ctrl+D` starts a new exercise, `Del` deletes the selected rows,
`Enter` saves in the popup and `Ctrl+Enter` adds a line break there.

Not built yet, by design: workout complexes, schedule calculation, the two
`view_options` filter checkboxes, feedback capture, and the workout page.

## Layout

```
index.html          Schedule page
css/app.css         all styles; Figma design tokens are the CSS variables
dev-server.js       local static server (development only)
assets/icons/       icons exported from Figma
js/
  main.js           entry point
  model.js          categories, equipment, factories
  store.js          state, mutations, persistence
  db.js             IndexedDB wrapper
  images.js         file import, downscaling, object URLs
  animation.js      reusable image-sequence animation
  dom.js            small DOM helpers
  schedule-page.js  page rendering and interaction
  exercise-modal.js the add / edit exercise popup
```

`js/animation.js` is deliberately standalone so the workout page can reuse it.

## Design source

Figma file `ULWMwUv9ivvkRUaHA1JikX`, frames `Schedule_page` (1:1824),
`Schedule_page_no exercises` (56:3253) and `Add_exercise_popup` (54:1097,
56:1316).

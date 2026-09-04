// Add_exercise_popup - used for both creating and editing an exercise.
//
// Per the spec the two modes differ only in the submit button label
// ("Добавить упражнение" vs "Сохранить"). Everything else is identical.
//
// Cancelling (Esc, or a click outside the popup) discards every edit: the popup
// works on its own copy of the data and only reports back on submit.

import { EQUIPMENT, IMAGES_PER_LINE } from './model.js';
import { el, clear, chunk } from './dom.js';
import { blobUrl, filesToImageBlobs } from './images.js';
import { createSequenceAnimation, DEFAULT_FRAME_MS } from './animation.js';

let openModal = null; // only ever one at a time

export function isModalOpen() {
  return openModal !== null;
}

export function openExerciseModal(options) {
  const {
    images = [],
    exercise = null,
    defaultEquipment = [],
    onSubmit,
  } = options || {};

  if (openModal) closeModal();

  // --- working copy -------------------------------------------------------
  let workingImages = images.slice();
  const selectedEquipment = new Set(
    exercise ? exercise.equipment : defaultEquipment
  );

  const isEdit = Boolean(exercise);

  // --- elements -----------------------------------------------------------
  const nameInput = el('input', {
    class: 'input input--text',
    type: 'text',
    value: exercise ? exercise.name : '',
    spellcheck: 'false',
  });

  const descriptionInput = el('textarea', {
    class: 'input input--textarea',
    spellcheck: 'false',
  });
  descriptionInput.value = exercise ? exercise.description : '';

  const previewFrame = el('div', { class: 'animation-preview' });
  const previewLines = el('div', { class: 'images-preview-lines' });

  const filePicker = el('input', {
    class: 'visually-hidden',
    type: 'file',
    accept: 'image/*',
    multiple: true,
  });

  const changeImagesButton = el(
    'button',
    { class: 'change-image-button', type: 'button' },
    el('img', { class: 'change-image-button__icon', src: 'assets/icons/change-image.svg', alt: '' }),
    el('span', { text: 'Заменить фото...' })
  );

  const submitButton = el(
    'button',
    { class: 'main-button', type: 'button' },
    el('span', { text: isEdit ? 'Сохранить' : 'Добавить упражнение' })
  );

  const animation = createSequenceAnimation(previewFrame, { intervalMs: DEFAULT_FRAME_MS });

  // --- images: preview lines + drag reordering ----------------------------

  // Insertion index within workingImages that a drop would land on.
  let dropTarget = null;

  function renderImages() {
    animation.setFrames(workingImages.map(blobUrl));

    clear(previewLines);

    // Lines always hold IMAGES_PER_LINE slots. Empty slots are invisible but
    // still take up space, which is what keeps every thumbnail the same width -
    // this mirrors the `reserved_space` layers in the Figma layout.
    const lines = chunk(workingImages, IMAGES_PER_LINE);
    if (lines.length === 0) lines.push([]);

    lines.forEach((line, lineIndex) => {
      const row = el('div', { class: 'images-preview-line' });

      line.forEach((blob, positionInLine) => {
        const index = lineIndex * IMAGES_PER_LINE + positionInLine;
        row.appendChild(renderThumb(blob, index));
      });

      for (let i = line.length; i < IMAGES_PER_LINE; i += 1) {
        row.appendChild(el('div', { class: 'image-thumb image-thumb--reserved' }));
      }

      previewLines.appendChild(row);
    });
  }

  function renderThumb(blob, index) {
    const thumb = el(
      'div',
      { class: 'image-thumb', draggable: 'true', dataset: { index: String(index) } },
      el('img', { class: 'image-thumb__img', src: blobUrl(blob), alt: '', draggable: 'false' })
    );

    thumb.addEventListener('dragstart', (event) => {
      // Some browsers refuse to start a drag without data set.
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
      thumb.classList.add('image-thumb--dragging');
    });

    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('image-thumb--dragging');
      clearDropMarkers();
      dropTarget = null;
    });

    thumb.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      // Drop before or after this thumb, depending on which half we are over.
      const box = thumb.getBoundingClientRect();
      const after = event.clientX > box.left + box.width / 2;
      dropTarget = after ? index + 1 : index;

      clearDropMarkers();
      thumb.classList.add(after ? 'image-thumb--drop-after' : 'image-thumb--drop-before');
    });

    thumb.addEventListener('drop', (event) => {
      event.preventDefault();
      commitDrop(Number(event.dataTransfer.getData('text/plain')));
    });

    return thumb;
  }

  function clearDropMarkers() {
    for (const node of previewLines.querySelectorAll('.image-thumb')) {
      node.classList.remove('image-thumb--drop-before', 'image-thumb--drop-after');
    }
  }

  function commitDrop(fromIndex) {
    const to = dropTarget;
    clearDropMarkers();
    dropTarget = null;

    if (!Number.isInteger(fromIndex) || to === null) return;
    if (to === fromIndex || to === fromIndex + 1) return; // dropped where it already is

    const next = workingImages.slice();
    const [moved] = next.splice(fromIndex, 1);
    // Removing the item first shifts every later index down by one.
    next.splice(to > fromIndex ? to - 1 : to, 0, moved);
    workingImages = next;

    renderImages(); // also pushes the new order into the animation immediately
  }

  // Dropping onto the empty tail of a line appends.
  previewLines.addEventListener('dragover', (event) => {
    if (event.target.classList && event.target.classList.contains('image-thumb--reserved')) {
      event.preventDefault();
      dropTarget = workingImages.length;
    }
  });
  previewLines.addEventListener('drop', (event) => {
    if (event.target.classList && event.target.classList.contains('image-thumb--reserved')) {
      event.preventDefault();
      commitDrop(Number(event.dataTransfer.getData('text/plain')));
    }
  });

  // --- replace images -----------------------------------------------------

  changeImagesButton.addEventListener('click', () => filePicker.click());

  filePicker.addEventListener('change', async () => {
    if (!filePicker.files || filePicker.files.length === 0) return;
    const blobs = await filesToImageBlobs(filePicker.files);
    filePicker.value = '';
    if (blobs.length === 0) return;

    workingImages = blobs; // new selection replaces the current images
    renderImages();
  });

  // --- equipment ----------------------------------------------------------

  function renderEquipment() {
    return EQUIPMENT.map((item) => {
      const input = el('input', {
        class: 'checkbox__input',
        type: 'checkbox',
        checked: selectedEquipment.has(item.id),
      });

      input.addEventListener('change', () => {
        if (input.checked) selectedEquipment.add(item.id);
        else selectedEquipment.delete(item.id);
      });

      return el(
        'label',
        { class: 'checkbox-line' },
        input,
        el('span', { class: 'checkbox' }),
        el('span', { class: 'checkbox-line__label', text: item.name })
      );
    });
  }

  // --- assembly -----------------------------------------------------------

  const popup = el(
    'div',
    { class: 'popup', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Новое упражнение' },
    el(
      'div',
      { class: 'popup__form' },
      el('p', { class: 'popup__title', text: 'Новое упражнение' }),
      el(
        'div',
        { class: 'popup__fields' },
        // Название
        el(
          'div',
          { class: 'field field--inline' },
          el('span', { class: 'field__label', text: 'Название' }),
          nameInput
        ),
        // Описание
        el(
          'div',
          { class: 'field' },
          el('span', { class: 'field__label field__label--textarea', text: 'Описание' }),
          descriptionInput
        ),
        // Картинки
        el(
          'div',
          { class: 'field' },
          el('span', { class: 'field__label', text: 'Картинки' }),
          el(
            'div',
            { class: 'images-block' },
            previewFrame,
            previewLines,
            changeImagesButton,
            filePicker
          )
        ),
        // Инвентарь
        el(
          'div',
          { class: 'field' },
          el('span', { class: 'field__label field__label--equipment', text: 'Инвентарь' }),
          el('div', { class: 'equipment-options' }, renderEquipment())
        )
      )
    ),
    submitButton
  );

  const overlay = el('div', { class: 'overlay' }, popup);

  // --- submit / cancel ----------------------------------------------------

  submitButton.addEventListener('click', () => {
    const fields = {
      name: nameInput.value.trim(),
      description: descriptionInput.value.trim(),
      equipment: EQUIPMENT.map((e) => e.id).filter((id) => selectedEquipment.has(id)),
      images: workingImages,
    };
    closeModal();
    if (onSubmit) onSubmit(fields);
  });

  // A click outside the popup cancels. Using mousedown would fire mid
  // text-selection drag, so this listens for a click landing on the overlay.
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  }

  document.addEventListener('keydown', onKeydown);

  openModal = {
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      animation.destroy();
      overlay.remove();
    },
  };

  document.body.appendChild(overlay);
  renderImages();
  nameInput.focus();
}

export function closeModal() {
  if (!openModal) return;
  const current = openModal;
  openModal = null;
  current.destroy();
}

// Entry point: load persisted state, then mount the Schedule page.

import { initStore } from './store.js';
import { mountApp } from './app.js';

async function start() {
  await initStore();
  mountApp(document.getElementById('app'));
}

start().catch((error) => {
  console.error('Startup failed:', error);
  document.getElementById('app').textContent =
    'Не удалось запустить приложение. Подробности в консоли браузера.';
});

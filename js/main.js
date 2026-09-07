// Entry point: pick up the token, load from the data repo, then mount.

import { initToken, watchForHide, flush, hasToken } from './sync.js';
import { initStore } from './store.js';
import { mountApp } from './app.js';
import { showLoading } from './loading.js';

async function start() {
  const app = document.getElementById('app');

  // Before anything reads the hash: the token rides in the fragment, and
  // pageFromHash() would otherwise treat "workout&k=..." as a page name, fail
  // to match it, and then overwrite the fragment - losing the token.
  initToken();

  // The state now comes over the network, so there is a moment with nothing to
  // show.
  const hideLoading = showLoading(app);

  await initStore();

  hideLoading();
  mountApp(app);

  // Being hidden is the last moment a browser reliably gives us. It is not
  // relied on - the idle flush is the real mechanism - but it gets the data up
  // sooner when it does fire.
  watchForHide();

  // Anything left buffered from a previous session goes up now.
  if (hasToken()) flush();
}

start().catch((error) => {
  console.error('Startup failed:', error);
  document.getElementById('app').textContent =
    'Не удалось запустить приложение. Подробности в консоли браузера.';
});

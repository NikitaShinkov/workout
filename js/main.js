// Entry point: pick up the token, load from the data repo, then mount.

import { initToken, watchForHide, flush, hasToken, forceSync, recoveredFromStaging } from './sync.js';
import { initStore, getState } from './store.js';
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

  // A «Обновить» upload the last session did not live to see confirmed: the
  // store is showing its staged snapshot, so finish sending it - behind the
  // loading screen, so nothing can be edited into the race, and silently. If
  // it cannot go up now it stays staged and is tried again next launch.
  if (recoveredFromStaging() && hasToken()) {
    try {
      await forceSync(getState());
    } catch (error) {
      console.warn('Could not finish the staged upload; it stays staged:', error);
    }
  }

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

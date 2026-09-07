// Where the data lives.
//
// A SECOND repository, deliberately. Committing data into the repo GitHub Pages
// builds from would rebuild the site on every save - a soft limit of ~10 builds
// an hour and ~40s each - which forces a slow save cadence and so risks losing
// the end of a workout. It would also mean the write token could rewrite the
// app's own JavaScript, which then runs on the user's phone. A separate repo
// removes both: saves are instant and unlimited, and a leaked token costs
// exercise data rather than control of the code.

export const DATA_REPO = {
  owner: 'NikitaShinkov',
  repo: 'workout-data',
  branch: 'main',
};

// Paths within that repo.
export const STATE_PATH = 'data/state.json';
export const LOG_PATH = 'data/log.json';
export const IMAGE_DIR = 'data/images';

// Images are content-addressed, so they are immutable and can be cached for
// ever; only the two JSON files are ever re-read. Reading those through the API
// rather than the CDN is what keeps them fresh - raw.githubusercontent and
// Pages both cache for minutes, which would show the other device stale data.
export function rawUrl(path) {
  const { owner, repo, branch } = DATA_REPO;
  return 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/' + path;
}

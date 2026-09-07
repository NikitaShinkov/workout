// Reading from and writing to the data repository, straight from the browser.
//
// api.github.com sends `Access-Control-Allow-Origin: *`, so no server of our own
// is needed anywhere in this. All it takes is a fine-grained token scoped to the
// one data repo with Contents: read and write.
//
// Writes go through the Git Data API - blobs, then a tree, then a commit, then
// move the ref - NOT the Contents API. Two reasons:
//
//   - Contents commits one file per call, so adding an exercise with three
//     images would be four commits and four half-finished repo states.
//   - `force: false` on the ref update is a single optimistic-concurrency check
//     for the whole commit, instead of juggling a base sha per file.

import { DATA_REPO } from './config.js';

const API = 'https://api.github.com';

let token = null;

export function setToken(next) {
  token = next || null;
}

export function hasToken() {
  return Boolean(token);
}

function repoUrl(suffix) {
  return API + '/repos/' + DATA_REPO.owner + '/' + DATA_REPO.repo + suffix;
}

async function call(url, options = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {}),
  };
  // Reads work without one - 60 an hour per address, plenty for a person - but
  // a token raises that to 5000 and is required for anything that writes.
  if (token) headers.Authorization = 'Bearer ' + token;

  const response = await fetch(url, { ...options, headers });

  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error('GitHub ' + response.status + ' on ' + url + ': ' + detail.slice(0, 200));
    error.status = response.status;
    throw error;
  }
  return response;
}

// --- reading ---------------------------------------------------------------

// The file's text, or null if it is not there yet. A missing file is a normal
// state - it is what an empty log looks like before the first workout - so it
// must never be an error.
export async function readFile(path) {
  const response = await call(repoUrl('/contents/' + path), {
    // The raw media type returns the bytes rather than a base64 JSON envelope,
    // which also lifts the API's 1MB ceiling on the `content` field.
    headers: { Accept: 'application/vnd.github.raw' },
    cache: 'no-store',
  });

  return response ? response.text() : null;
}

export async function readJson(path, fallback = null) {
  const text = await readFile(path);
  if (text === null) return fallback;

  try {
    return JSON.parse(text);
  } catch (error) {
    // A corrupt file must not wedge the app permanently; treat it as absent and
    // say so, rather than throwing on every load for ever.
    console.warn('Could not parse ' + path + ':', error);
    return fallback;
  }
}

// --- writing ---------------------------------------------------------------

// btoa() takes a binary string, and String.fromCharCode.apply blows the
// argument limit somewhere around 100k, so bytes are folded in chunks.
const CHUNK = 0x8000;

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function writeHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function post(path, body) {
  const response = await call(repoUrl(path), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.json();
}

// The branch head, or null if there is no branch. A repository with no commits
// reports that as 409 "Git Repository is empty"; one that simply lacks this
// branch reports 404. Neither is an error worth propagating.
async function headCommit(branch) {
  try {
    const response = await call(repoUrl('/git/ref/heads/' + branch));
    return response ? (await response.json()).object.sha : null;
  } catch (error) {
    if (error.status === 409) return null;
    throw error;
  }
}

// What goes in to make a bare repository into one the Git Data API will talk
// to. A README rather than an empty placeholder, because this repo is public
// and someone finding it deserves to know what it is.
const README = [
  '# workout-data',
  '',
  'Data for [the workout app](https://nikitashinkov.github.io/workout/).',
  'Written by the app through the GitHub API - not meant to be edited by hand.',
  '',
  '- `data/state.json` - categories, exercises, complexes and the schedule',
  '- `data/log.json` - what workouts produced: times, ratings, favourites',
  '- `data/images/` - exercise photos, each named by the hash of its own bytes',
  '',
].join('\n');

// The Contents API is the ONLY way to write into a repository that has no
// commits, and it creates the branch as a side effect. One extra commit, once,
// on the very first write the app ever makes.
async function createFirstCommit(branch) {
  const response = await fetch(repoUrl('/contents/README.md'), {
    method: 'PUT',
    headers: writeHeaders(),
    body: JSON.stringify({
      message: 'Create the data repository',
      content: bytesToBase64(new TextEncoder().encode(README)),
      branch,
    }),
  });

  if (!response.ok) {
    throw new Error('GitHub ' + response.status + ' creating the first commit: '
      + (await response.text().catch(() => '')).slice(0, 200));
  }
}

// One commit, however many files.
//
// `files` is [{ path, text }] or [{ path, bytes }] - text goes into the tree
// directly and lets the API make the blob, bytes are uploaded as a base64 blob
// first because a tree entry cannot carry binary.
//
// Returns the new commit sha, or null if there was nothing to do.
export async function commitFiles(files, message) {
  if (!token) throw new Error('No GitHub token: cannot write.');
  if (!files.length) return null;

  const branch = DATA_REPO.branch;

  let baseCommitSha = await headCommit(branch);

  // A repository with no commits at all refuses the Git Data API OUTRIGHT:
  // /git/blobs and /git/trees both answer 409 "Git Repository is empty", not
  // just the ref lookup. So there is no way to build the first commit out of
  // blobs and a tree - the Contents API is the only door into an empty repo.
  // The first write ever therefore puts one file in to create the initial
  // commit and the branch, and every write after that takes the normal path.
  if (baseCommitSha === null) {
    await createFirstCommit(branch);
    baseCommitSha = await headCommit(branch);
    if (baseCommitSha === null) {
      throw new Error('Could not create the first commit on ' + branch + '.');
    }
  }

  const commitResponse = await call(repoUrl('/git/commits/' + baseCommitSha));
  const baseTreeSha = (await commitResponse.json()).tree.sha;

  const tree = [];
  for (const file of files) {
    const entry = { path: file.path, mode: '100644', type: 'blob' };

    if (file.bytes) {
      const blob = await post('/git/blobs', {
        content: bytesToBase64(file.bytes),
        encoding: 'base64',
      });
      entry.sha = blob.sha;
    } else {
      entry.content = file.text;
    }

    tree.push(entry);
  }

  const newTree = await post('/git/trees', { base_tree: baseTreeSha, tree });

  const commit = await post('/git/commits', {
    message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });

  // force: false, so a push that is not a fast-forward is refused rather than
  // silently discarding what the other device just committed. The caller
  // re-reads and retries.
  const response = await fetch(repoUrl('/git/refs/heads/' + branch), {
    method: 'PATCH',
    headers: writeHeaders(),
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  if (response.status === 422) {
    // The branch moved under us: read again and retry rather than overwrite.
    const conflict = new Error('The branch moved while writing; retry.');
    conflict.conflict = true;
    throw conflict;
  }
  if (!response.ok) {
    throw new Error('GitHub ' + response.status + ' updating the branch: '
      + (await response.text().catch(() => '')).slice(0, 200));
  }

  return commit.sha;
}

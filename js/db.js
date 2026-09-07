// Persistence: the data repository, via js/sync.js.
//
// This file used to be one IndexedDB record. It is still the only seam the
// store knows about - load once, hand over every change - but the data now
// lives in git so that the computer and the phone are looking at one copy of
// it rather than two unrelated ones.
//
// Nothing is read from the browser any more. The repo is the source of truth on
// every launch; sync.js keeps a local copy purely so the app still opens with
// no signal, and that copy is never authoritative.

import { loadFromRepo, noteState } from './sync.js';

// The stored state, or null when the data repo has nothing in it yet - which
// migrate() turns into a fresh install rather than an error.
export async function loadState() {
  return loadFromRepo();
}

// Handed the whole live state on every mutation. sync.js decides whether that
// amounts to a change worth committing and when to send it; the store neither
// knows nor waits.
export async function saveState(state) {
  noteState(state);
}

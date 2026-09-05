// Shared paths and Chrome discovery for the test suites.
// Everything is derived, so the tests work from any checkout location.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Forward slashes throughout: these get used in file:// URLs as well as paths.
export const PROJECT = path.resolve(here, '../..').split(path.sep).join('/');
export const OUT = PROJECT + '/tests/.out';

// The runner starts dev-server.js and passes the port through.
export const BASE = process.env.BASE_URL || 'http://localhost:8123';

fs.mkdirSync(OUT, { recursive: true });

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

// The browser suites drive whichever Chrome or Edge is already installed -
// puppeteer-core ships no browser of its own.
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // unreadable path, keep looking
    }
  }

  throw new Error('No Chrome or Edge found. Set CHROME_PATH to the executable.');
}

export function harness(query = '') {
  return BASE + '/tests/browser/harness.html' + (query ? '?' + query : '');
}

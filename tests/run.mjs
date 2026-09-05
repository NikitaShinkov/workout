// Test runner: starts the dev server, runs every suite in a child process,
// and reports a summary.
//
//   npm test                 everything
//   npm test -- jsdom        only the jsdom suites
//   npm test -- browser      only the Chrome suites
//   npm test -- undo         only suites whose name contains "undo"

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(here, '..');
const PORT = 8123;
const BASE_URL = 'http://localhost:' + PORT;

const filter = process.argv[2] || '';

function suitesIn(dir) {
  return readdirSync(path.join(here, dir))
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => ({ name: dir + '/' + f.replace('.test.mjs', ''), file: path.join(here, dir, f) }));
}

const suites = [...suitesIn('jsdom'), ...suitesIn('browser')]
  .filter((s) => s.name.includes(filter));

if (suites.length === 0) {
  console.error('No suites match "' + filter + '"');
  process.exit(1);
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL + '/index.html');
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const server = spawn(process.execPath, ['dev-server.js', String(PORT)], {
  cwd: PROJECT,
  stdio: 'ignore',
});

if (!(await waitForServer())) {
  server.kill();
  console.error('dev-server did not start on port ' + PORT);
  process.exit(1);
}

console.log('Running ' + suites.length + ' suite(s) against ' + BASE_URL + '\n');

const failed = [];
for (const suite of suites) {
  const started = Date.now();
  const { code, output } = await run(process.execPath, [suite.file], {
    cwd: PROJECT,
    env: { ...process.env, BASE_URL },
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const passes = (output.match(/^ {2}PASS/gm) || []).length;

  if (code === 0) {
    console.log('  ok    ' + suite.name.padEnd(28) + passes + ' checks  ' + seconds + 's');
  } else {
    failed.push(suite.name);
    console.log('  FAIL  ' + suite.name.padEnd(28) + seconds + 's');
    // Only the failures are worth printing in full.
    console.log(output.split('\n').filter((l) => /FAIL|Error|error/.test(l)).join('\n'));
  }
}

server.kill();

console.log('');
if (failed.length === 0) {
  console.log('All suites passed.');
  process.exit(0);
}
console.log(failed.length + ' suite(s) failed: ' + failed.join(', '));
process.exit(1);

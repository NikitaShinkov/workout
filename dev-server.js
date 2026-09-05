// Minimal static file server for local development.
//
// Needed because index.html loads ES modules, and browsers refuse to load
// modules over file:// (they are subject to CORS). GitHub Pages serves the
// same files over HTTP, so this is only for working locally.
//
//   node dev-server.js        -> http://localhost:8080
//   node dev-server.js 3000   -> http://localhost:3000

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8080);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

http
  .createServer((request, response) => {
    let urlPath = decodeURIComponent(request.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.resolve(path.join(root, urlPath));

    // Never serve anything outside the project directory.
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, contents) => {
      if (error) {
        response.writeHead(404).end('Not found');
        return;
      }
      const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(contents);
    });
  })
  .listen(port, () => {
    console.log('Serving ' + root);
    console.log('Open http://localhost:' + port);
  });

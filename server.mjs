import http from 'node:http';
import { basename } from 'node:path';
import fetchExchange from './api/fetch.mjs';
import { assets, readSiteAsset } from './lib/site-assets.mjs';

const port = Number(process.env.PORT || 4173);
const contentTypes = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  txt: 'text/plain',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET requests only.' });
    if (url.pathname === '/api/fetch') return await fetchExchange(req, res);
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (basename(name) !== name || !assets.has(name)) return json(res, 404, { error: 'File not found.' });
    const data = await readSiteAsset(name);
    res.writeHead(200, {
      'Content-Type':
        contentTypes[name.split('.').pop()] + (name.endsWith('.woff2') ? '' : '; charset=utf-8'),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (!res.destroyed && !res.headersSent)
      json(res, error.code === 'ENOENT' ? 404 : 502, { error: 'Could not reach the requested resource.' });
  }
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${port} is in use. Choose another port with PORT=4174 node server.mjs.`
      : error.message,
  );
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Election dashboard is running at http://127.0.0.1:${server.address().port}`),
);

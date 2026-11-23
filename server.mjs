import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const allowed = new Map([
  ['api.elections.kalshi.com', /^\/v1\/search\/series$/],
  ['external-api.kalshi.com', /^\/trade-api\/v2\/(?:series|events|markets|historical|milestones)(?:\/|$)/],
  ['gamma-api.polymarket.com', /^\/(?:markets|events|tags)(?:\/|$)/],
  ['data-api.polymarket.com', /^\/v2\/resolutions$/],
  ['clob.polymarket.com', /^\/(?:prices-history|markets)(?:\/|$)/],
]);
const contentTypes = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  txt: 'text/plain',
};
const assets = new Set([
  'index.html',
  'styles.css',
  'montserrat.css',
  'montserrat-latin.woff2',
  'montserrat-latin-ext.woff2',
  'montserrat-cyrillic.woff2',
  'montserrat-license.txt',
  'instrument-serif-italic-latin.woff2',
  'instrument-serif-license.txt',
  'app.js',
  'theme.js',
  'chart.js',
  'api.js',
  'kalshi.js',
  'polymarket.js',
  'backtest.js',
  'backtest-ui.js',
  'trading.js',
  'trading-ui.js',
  'trading.css',
  'discovery.js',
  'contract-fetch.js',
  'contract-fetch.css',
  'backtest-charts.js',
  'backtest-charts.css',
  'strategies.js',
  'strategies.css',
  'settlement-filter.js',
  'settlement-filter.css',
  'atlas.css',
  'space-panels.css',
  'atlas.js',
  'countries.js',
  'globe.js',
  'market-geography.js',
  'snapshot.js',
  'kalshi-snapshot.js',
]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET requests only.' });
    if (url.pathname === '/api/fetch') {
      const remote = new URL(url.searchParams.get('url'));
      if (
        remote.protocol !== 'https:' ||
        remote.username ||
        remote.password ||
        remote.port ||
        !allowed.get(remote.hostname)?.test(remote.pathname)
      ) {
        return json(res, 400, { error: 'Unsupported exchange data endpoint.' });
      }
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const upstream = await fetch(remote, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return json(res, upstream.status, { error: `Exchange returned HTTP ${upstream.status}.` });
      }
      // Pass through only JSON returned by the listed public data endpoints.
      const type = upstream.headers.get('content-type') || '';
      if (!type.includes('json')) {
        await upstream.body?.cancel();
        return json(res, 502, { error: 'Exchange returned an unexpected response format.' });
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(body);
    }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (basename(name) !== name || !assets.has(name)) return json(res, 404, { error: 'File not found.' });
    let data = await readFile(join(directory, name));
    if (name === 'index.html')
      data = data
        .toString()
        .replace('name="election-api" content="direct"', 'name="election-api" content="relay"');
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

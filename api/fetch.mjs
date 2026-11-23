import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const allowed = new Map([
  ['api.elections.kalshi.com', /^\/v1\/search\/series$/],
  ['external-api.kalshi.com', /^\/trade-api\/v2\/(?:series|events|markets|historical|milestones)(?:\/|$)/],
  ['gamma-api.polymarket.com', /^\/(?:markets|events|tags)(?:\/|$)/],
  ['data-api.polymarket.com', /^\/v2\/resolutions$/],
  ['clob.polymarket.com', /^\/(?:prices-history|markets)(?:\/|$)/],
]);

function json(res, status, error) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error }));
}

// Both the local server and Vercel serve this read-only exchange relay at /api/fetch.
export default async function fetchExchange(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, 'GET requests only.');
  const target = new URL(req.url, 'http://localhost').searchParams.get('url');
  const remote = URL.canParse(target) ? new URL(target) : null;
  if (!remote || remote.protocol !== 'https:' || remote.username || remote.password || remote.port ||
      !allowed.get(remote.hostname)?.test(remote.pathname)) {
    return json(res, 400, 'Unsupported exchange data endpoint.');
  }
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  try {
    const upstream = await fetch(remote, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return json(res, upstream.status, `Exchange returned HTTP ${upstream.status}.`);
    }
    if (!upstream.headers.get('content-type')?.includes('json')) {
      await upstream.body?.cancel();
      return json(res, 502, 'Exchange returned an unexpected response format.');
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD' || !upstream.body) {
      await upstream.body?.cancel();
      return res.end();
    }
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch {
    if (!res.headersSent && !res.destroyed) json(res, 502, 'Could not reach the requested resource.');
  }
}

import { readFile } from 'node:fs/promises';

export const assets = new Set([
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

export async function readSiteAsset(name) {
  const data = await readFile(new URL('../' + name, import.meta.url));
  if (name !== 'index.html') return data;
  return data.toString().replace('name="election-api" content="direct"', 'name="election-api" content="relay"');
}

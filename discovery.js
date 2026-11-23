(() => {
  'use strict';

  const DAY = 86_400_000;
  const names = { kalshi: 'Kalshi', polymarket: 'Polymarket' };

  function eligible(market, mode) {
    if (!market) return false;
    const resolved = market.outcome === 0 || market.outcome === 1;
    return mode === 'live'
      ? !resolved && !market.settledAt
      : resolved && Number.isFinite(Date.parse(market.settledAt || ''));
  }

  function utcStart(day) {
    if (!day) return null;
    const time = Date.parse(day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(time) ||
        new Date(time).toISOString().slice(0, 10) !== day)
      throw new Error('Enter a valid UTC date.');
    return time;
  }

  function tradingBounds(market) {
    const opened = Date.parse(market.openAt || market.openedAt || market.listedAt);
    const closed = Date.parse(market.tradingClosedAt || market.closeAt);
    const settled = Date.parse(market.settledAt);
    return {
      opened: Number.isFinite(opened) ? opened : -Infinity,
      closed: Math.min(Number.isFinite(closed) ? closed : Infinity, Number.isFinite(settled) ? settled : Infinity),
    };
  }

  // A partial UTC day can contain a close. An exchange close timestamp is exclusive.
  function possiblePriceDays(market, start, end, warmup) {
    const { opened, closed } = tradingBounds(market);
    const first = Math.max(Math.floor(start / DAY), Math.floor(opened / DAY) + warmup);
    const last = Math.min(Math.floor(end / DAY), Math.ceil(closed / DAY) - 1);
    return Math.max(0, last - first + 1);
  }

  function restrictions({ mode, from, to, undated = false, includedCountry = '', excludedCountries = [], query = '', tradingFrom, tradingThrough, tradingMinDays, tradingWarmup = 0 }) {
    const firstTradeDay = utcStart(tradingFrom), lastTradeDay = utcStart(tradingThrough);
    if (firstTradeDay !== null && lastTradeDay !== null && lastTradeDay < firstTradeDay)
      throw new Error('The trading window ends before it begins.');
    const start = undated ? null : utcStart(from);
    const last = undated ? null : utcStart(to);
    if (start !== null && last !== null && last < start)
      throw new Error('Choose an end date on or after the start date.');
    const end = last === null ? null : last + DAY;
    const excluded = new Set(excludedCountries);
    const countryRestricted = Boolean(includedCountry || excluded.size);
    const term = query.trim().toLowerCase();
    function acceptsDate(market) {
      if (!eligible(market, mode)) return false;
      if (firstTradeDay !== null || lastTradeDay !== null) {
        const { opened, closed } = tradingBounds(market);
        if ((firstTradeDay !== null && closed <= firstTradeDay) ||
            (lastTradeDay !== null && opened >= lastTradeDay + DAY)) return false;
      }
      if (tradingMinDays && possiblePriceDays(market, firstTradeDay, lastTradeDay, tradingWarmup) < tradingMinDays)
        return false;
      if (!undated && start === null && end === null) return true;
      const date = window.ElectionSettlement.dateFor(market, mode);
      if (undated) return date === null;
      return date !== null && (start === null || date.ms >= start) && (end === null || date.ms < end);
    }
    function acceptsCountries(ids) {
      return ids.length > 0 && (!includedCountry || ids.includes(includedCountry)) && !ids.some((id) => excluded.has(id));
    }
    function acceptsMetadata(market) {
      if (countryRestricted && !acceptsCountries(window.ElectionGeography.countryIds(market))) return false;
      return !term || [market.title, market.eventTitle, market.label, market.id, market.source]
        .some((text) => String(text || '').toLowerCase().includes(term));
    }
    return {
      start, end, undated, includedCountry, excluded, countryRestricted, metadataRestricted: Boolean(term || countryRestricted),
      acceptsCountries, acceptsDate, acceptsMetadata,
      possibleHistory: tradingMinDays ? (m) => possiblePriceDays(m, firstTradeDay, lastTradeDay, tradingWarmup) >= tradingMinDays : null,
    };
  }

  async function fetchContracts({ mode = 'archive', source = 'all', count, newest = false, electionIndex = false, signal, onProgress, onPage, onCandidates, ...criteria }) {
    const modes = mode === 'both' && onCandidates ? ['live', 'archive'] : [mode];
    if (modes.some((m) => !['live', 'archive'].includes(m)) || !(source === 'all' || Object.hasOwn(names, source)))
      throw new Error('Choose a valid exchange and market mode.');
    const all = count === 'all' && mode === 'live';
    if (!all && (!Number.isSafeInteger(count) || count < 1)) throw new Error('Enter a positive whole contract count.');
    if (newest && (all || count > 500)) throw new Error('Choose a backtest maximum between 1 and 500.');
    const target = all ? Infinity : count;
    const providers = { polymarket: window.ElectionPolymarket, kalshi: window.ElectionKalshi };
    const sources = source === 'all' ? Object.keys(providers) : [source];
    // Time-frame fetch can verify one batch while older election pages are still unread.
    const visited = new Set(), offered = [];
    let pending = [];
    const queue = modes.flatMap((mode) => {
      const filter = restrictions({ ...criteria, mode });
      return sources.map((name) => ({
        name, mode, filter, feed: modes.length === 1 ? name : name + ':' + mode,
        provider: providers[name], nextMaxTime: Infinity, cursor: null, seenCursors: new Set(), scanned: 0, found: 0, incomplete: false,
      }));
    });
    const feedCount = queue.length;
    const matches = new Map();
    const rankingTimes = new WeakMap();
    const timeOf = (market) => {
      if (!rankingTimes.has(market)) {
        const time = Date.parse(electionIndex ? market.discoveryListedAt || market.listedAt : market.listedAt);
        rankingTimes.set(market, Number.isFinite(time) ? time : -Infinity);
      }
      return rankingTimes.get(market);
    };
    function ranked() {
      return [...matches.values()].sort((a, b) =>
        timeOf(b) - timeOf(a) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
    }
    let oldestSelected = -Infinity;
    const issues = new Set();
    const completedSources = [];
    let scanned = 0, pages = 0;
    async function offerBatch() {
      if (!pending.length || offered.length >= target) return false;
      const batch = pending.sort((a,b) => timeOf(b) - timeOf(a)).slice(0, target - offered.length);
      pending = [];
      offered.push(...batch);
      const filled = await onCandidates(batch);
      signal?.throwIfAborted();
      return filled || offered.length >= target;
    }
    while (queue.length && (newest || matches.size < target)) {
      signal?.throwIfAborted();
      if (newest && !onCandidates) queue.sort((a, b) => b.nextMaxTime - a.nextMaxTime);
      const state = queue.shift();
      if (newest && !onCandidates && matches.size >= target && state.nextMaxTime <= oldestSelected) break;
      visited.add(state.feed);
      // Size the next request from the remaining count and the observed yield of this source.
      // Sparse filters grow to exchange-sized pages while small unfiltered requests stay small.
      const remaining = all ? 100 : target - matches.size;
      const share = !all && state.cursor === null && queue.length
        ? Math.min(remaining, Math.ceil(count / sources.length))
        : remaining;
      const expected = state.found ? Math.ceil(share * state.scanned / state.found) : 0;
      const limit = newest ? Math.min(100, Math.max(20, target)) : Math.min(100, Math.max(share, expected, state.scanned && !state.found ? 100 : 1));
      onProgress?.({ found: Math.min(matches.size, target), scanned, pages, source: state.name });
      let page;
      try {
        page = await state.provider.discoverPage({ mode:state.mode, filter:state.filter, limit, cursor: state.cursor, signal, all, newest, electionIndex });
        if (!Array.isArray(page.markets)) throw new Error('The exchange returned an unreadable page.');
      } catch (error) {
        signal?.throwIfAborted();
        issues.add(names[state.name] + ' — ' + (error?.message || 'The exchange request failed.'));
        continue;
      }
      signal?.throwIfAborted();
      const inspected = page.scanned ?? page.markets.length;
      state.scanned += inspected;
      scanned += inspected;
      pages += page.pages ?? 1;
      if (page.warning) {
        state.incomplete = true;
        issues.add(page.warning);
      }
      const added = [];
      let inspectedAll = true;
      for (const [index, market] of page.markets.entries()) {
        if (!market?.id || market.source !== state.name || !state.filter.acceptsDate(market) ||
            !state.filter.acceptsMetadata(market)) continue;
        const key = market.source + ':' + market.id;
        if (matches.has(key)) continue;
        if (newest && timeOf(market) < oldestSelected) continue;
        matches.set(key, market);
        added.push(market);
        state.found++;
        if (!newest && matches.size === target) {
          inspectedAll = index === page.markets.length - 1;
          break;
        }
      }
      if (!newest) onPage?.({ source: state.name, markets: added });
      if (onCandidates) pending.push(...added);
      state.nextMaxTime = page.nextMaxTime ?? Infinity;
      // Once all remaining feeds are older than or tied with the last selected listing, stop.
      const needsCutoff = matches.size >= target && (matches.size > target || oldestSelected === -Infinity);
      if (newest && !onCandidates && needsCutoff) {
        const selected = ranked().slice(0, target);
        oldestSelected = timeOf(selected[selected.length - 1]);
        matches.clear();
        for (const market of selected) matches.set(market.source + ':' + market.id, market);
      }
      if (page.nextCursor != null) {
        const key = page.nextKey ?? page.nextCursor;
        if (state.seenCursors.has(key))
          issues.add(names[state.name] + ' repeated a page cursor. Its search stopped early.');
        else {
          state.seenCursors.add(key);
          state.cursor = page.nextCursor;
          queue.push(state);
        }
      } else if (!state.incomplete && inspectedAll) completedSources.push(state.feed);
      onProgress?.({ found: Math.min(matches.size, target), scanned, pages, source: state.name });
      if (onCandidates && visited.size === feedCount && await offerBatch()) break;
    }
    signal?.throwIfAborted();
    if (onCandidates) await offerBatch();
    const markets = onCandidates ? offered : newest ? ranked().slice(0, target) : [...matches.values()];
    if (newest && onPage)
      for (const name of sources) onPage({ source: name, markets: markets.filter((m) => m.source === name) });
    return {
      markets, scanned, pages, exhausted: completedSources.length === feedCount,
      issues: [...issues], completedSources,
    };
  }

  // Store only complete, unrestricted live catalogs. Compare start times inside the writing
  // transaction so an older scan in another tab cannot overwrite a newer one.
  let connection;
  function liveCache() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const opening = window.indexedDB.open('election-atlas-live', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('catalog');
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => resolve(opening.result);
    });
    return connection;
  }
  async function readLive() {
    const db = await liveCache();
    return new Promise((resolve, reject) => {
      const request = db.transaction('catalog').objectStore('catalog').get('snapshot');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function saveLive(snapshot) {
    const db = await liveCache();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('catalog', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      const store = tx.objectStore('catalog');
      const previous = store.get('started');
      previous.onsuccess = () => {
        if ((previous.result || 0) > snapshot.started) return;
        store.put(snapshot.started, 'started');
        store.put(snapshot, 'snapshot');
      };
    });
  }
  window.ElectionDiscovery = Object.freeze({ fetch: fetchContracts, eligible, tradingBounds, possiblePriceDays, readLive, saveLive });
})();

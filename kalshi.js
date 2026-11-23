/* Public Kalshi market data. Only series metadata is cached between refreshes. */
(() => {
  'use strict';
  const base = 'https://external-api.kalshi.com/trade-api/v2';
  const seriesPerPage = 5;
  let catalogCache;
  let nextRequestTime = 0;

  function wait(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      function abort() {
        clearTimeout(timer);
        reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      }
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }

  async function request(path, params, signal) {
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    // Anonymous readers share a rate limit. Pace requests and back off on transient exchange failures.
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const at = Math.max(now, nextRequestTime);
      nextRequestTime = at + 180;
      await wait(at - now, signal);
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      try {
        return await window.ElectionAPI.json(url.href, { signal });
      } catch (error) {
        const retryable = error instanceof TypeError || [429, 500, 502, 503, 504].includes(error.status) || /\b429\b/.test(error.message);
        if (attempt >= 4 || signal?.aborted || !retryable)
          throw error;
        nextRequestTime = Math.max(nextRequestTime, Date.now() + 1000 * 2 ** attempt);
      }
    }
  }

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function probability(value) {
    const result = number(value);
    return result !== null && result >= 0 && result <= 1 ? result : null;
  }

  function marketPrice(record, key) {
    if (record[key + '_dollars'] != null) return probability(record[key + '_dollars']);
    const cents = number(record[key]);
    return cents === null ? null : probability(cents / 100);
  }

  function marketTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d(?:$|T)/i.test(value)) return null;
    if (/T[\d:.]+$/i.test(value)) value += 'Z';
    if (!Number.isFinite(Date.parse(value))) return null;
    const day = value.slice(0, 10);
    return new Date(day).toISOString().slice(0, 10) === day ? value : null;
  }

  function marketRow(raw, series, event, archived, mode) {
    const label = raw.yes_sub_title?.trim() || 'Yes';
    const eventTitle = event?.title || raw.title || series.title;
    const question = raw.title || eventTitle;
    const title =
      label.toLowerCase() === 'yes' || question.toLowerCase().includes(label.toLowerCase())
        ? question
        : eventTitle + ' · ' + label;
    const volume = number(raw.volume_fp ?? raw.volume);
    const price = marketPrice(raw, 'last_price');
    const outcome = raw.result === 'yes' ? 1 : raw.result === 'no' ? 0 : null;
    const settledAt = marketTime(raw.settlement_ts);
    const open = mode === 'live' && (!raw.status || raw.status === 'active' || raw.status === 'open');
    const expectedResolutionAt =
      open && outcome === null && !settledAt ? marketTime(raw.expected_expiration_time) : null;
    const eventId = raw.event_ticker;
    const marketUrl = new URL(
      'https://kalshi.com/markets/' +
        encodeURIComponent(series.ticker.toLowerCase()) +
        '/event/' +
        encodeURIComponent(eventId.toLowerCase()),
    );
    marketUrl.searchParams.set('op_market_ticker', raw.ticker);
    return {
      id: raw.ticker,
      source: 'kalshi',
      title,
      eventTitle,
      label,
      price: volume === 0 ? null : price,
      volume,
      volumeUnit: 'contracts',
      feeMultiplier: event?.fee_type_override === 'flat' ? null : number(event?.fee_multiplier_override) ?? series.feeMultiplier ?? null,
      feeWaiverUntil: marketTime(raw.fee_waiver_expiration_time),
      yesBid: marketPrice(raw, 'yes_bid'),
      yesAsk: marketPrice(raw, 'yes_ask'),
      listedAt: marketTime(raw.created_time),
      openAt: raw.open_time || null,
      closeAt: raw.close_time || null,
      settledAt,
      settlementBasis: settledAt ? 'reported' : null,
      expectedResolutionAt,
      expectedResolutionBasis: expectedResolutionAt ? 'expected_expiration_time' : null,
      outcome,
      url: marketUrl.href,
      eventId,
      seriesTicker: series.ticker,
      seriesTags: series.tags || [],
      archived,
    };
  }

  async function catalog(signal) {
    if (catalogCache && Date.now() - catalogCache.saved < 900_000) return catalogCache.rows;
    const data = await request('/series', { category: 'Elections', include_volume: true }, signal);
    if (!Array.isArray(data?.series)) throw new Error('Kalshi returned an unreadable election series list.');
    const rows = data.series
      .filter((s) => s.ticker)
      .map((s) => ({
        ticker: s.ticker,
        tags: Array.isArray(s.tags) ? s.tags : [],
        title: s.title || s.ticker,
        feeMultiplier: s.fee_type === 'flat' ? null : number(s.fee_multiplier),
        volume: number(s.volume_fp ?? s.volume) || 0,
      }));
    rows.sort((a, b) => b.volume - a.volume || a.ticker.localeCompare(b.ticker));
    catalogCache = { rows, saved: Date.now() };
    return rows;
  }

  async function firstCursor(mode, signal) {
    if (mode === 'archive') return { series: await catalog(signal), offset: 0, pending: [] };
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const [series, upcoming] = await Promise.all([
      catalog(signal),
      request(
        '/milestones',
        { category: 'Elections', type: 'political_race', minimum_start_date: day.toISOString(), limit: 10 },
        signal,
      ).catch((error) => {
        if (signal?.aborted) throw error;
        return {};
      }),
    ]);
    // Interleave frequently traded elections with races on the exchange's calendar.
    // A series may contain hyphens. Remove event suffixes until a catalog ticker matches.
    const byTicker = new Map(series.map((s) => [s.ticker, s]));
    const near = [];
    for (const milestone of upcoming.milestones || []) {
      for (let ticker of milestone.primary_event_tickers || []) {
        while (ticker && !byTicker.has(ticker)) {
          const split = ticker.lastIndexOf('-');
          ticker = split < 0 ? '' : ticker.slice(0, split);
        }
        if (ticker && !near.includes(ticker)) near.push(ticker);
      }
    }
    const preferred = ['KXPRESPERSON', ...near.slice(0, 2), 'KXPRESNOMD', ...near.slice(2)];
    const ordered = new Set([...preferred.map((t) => byTicker.get(t)).filter(Boolean), ...series]);
    return { series: [...ordered], offset: 0, pending: [] };
  }

  async function pool(items, callback) {
    const results = [];
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        try {
          results[i] = { value: await callback(items[i]) };
        } catch (error) {
          results[i] = { error };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
    return results;
  }

  function binaryMarket(raw) {
    return raw?.ticker && raw.event_ticker && !raw.mve_collection_ticker &&
      (!raw.market_type || raw.market_type === 'binary');
  }

  // Discover open events first so a full live fetch does not visit thousands of dormant election series.
  async function discoverOpenEvents(cursor, filter, signal) {
    const series = cursor?.series ?? new Map((await catalog(signal)).map((item) => [item.ticker, item]));
    const page = await request('/events', { status: 'open', limit: 200, cursor: cursor?.after }, signal);
    if (!Array.isArray(page.events)) throw new Error('Kalshi returned an unreadable event list.');
    const candidates = page.events.filter((event) => {
      if (!series.has(event.series_ticker) && event.category !== 'Elections') return false;
      if (!filter.countryRestricted) return true;
      const ids = window.ElectionGeography.countryIds({
        source: 'kalshi', eventTitle: event.title, seriesTicker: event.series_ticker,
        seriesTags: series.get(event.series_ticker)?.tags,
      });
      // An unlocated event can still have a country in the individual market title.
      return !ids.length || filter.acceptsCountries(ids);
    });
    const markets = [];
    let scanned = 0, warning = '';
    for (let i = 0; i < candidates.length; i += 16) {
      const batch = candidates.slice(i, i + 16);
      const tickers = new Set(batch.map((event) => event.event_ticker));
      try {
        const detail = await request('/events', {
          tickers: [...tickers].join(','), with_nested_markets: true, limit: 200,
        }, signal);
        if (!Array.isArray(detail.events)) throw new Error('Unreadable event details.');
        for (const event of detail.events) {
          if (!tickers.has(event.event_ticker) || !Array.isArray(event.markets)) continue;
          tickers.delete(event.event_ticker);
          const meta = series.get(event.series_ticker) || { ticker: event.series_ticker, title: event.title };
          scanned += event.markets.length;
          for (const raw of event.markets) {
            if (binaryMarket(raw) && (raw.status === 'active' || raw.status === 'open'))
              markets.push(marketRow(raw, meta, event, false, 'live'));
          }
        }
        if (tickers.size) warning = 'Some Kalshi events could not be verified.';
      } catch (error) {
        if (signal?.aborted) throw error;
        // Keep verified batches and surface partial coverage when enrichment is interrupted.
        warning = 'Some Kalshi event details could not be loaded. ' + error.message;
      }
    }
    return { markets, scanned, warning, nextCursor: page.cursor ? { series, after: page.cursor } : null, nextKey: page.cursor };
  }

  async function initialDiscovery(mode, filter, signal, historicalOnly = false) {
    let series = await catalog(signal);
    if (filter.countryRestricted) {
      // Unclassified series and election combos may identify additional countries at event level.
      const allowed = [], unmapped = [];
      for (const item of series) {
        const ids = window.ElectionGeography.countryIds({
          source: 'kalshi', seriesTicker: item.ticker, seriesTags: item.tags,
        });
        if (ids.some((id) => filter.excluded.has(id))) continue;
        if (ids.length && filter.acceptsCountries(ids)) allowed.push(item);
        else if (!ids.length || item.tags.includes('Election Combos')) unmapped.push(item);
      }
      series = allowed.concat(unmapped);
    }
    let tiers = historicalOnly ? [true] : mode === 'live' ? [false] : [false, true];
    if (!historicalOnly && series.length && mode === 'archive' && (filter.start !== null || filter.end !== null)) {
      // This optional optimization routes wholly historical or recent ranges directly to the
      // right endpoint. Both tiers remain searchable when the cutoff is unavailable.
      let cutoff;
      try {
        const data = await request('/historical/cutoff', {}, signal);
        cutoff = Date.parse(data?.market_settled_ts);
      } catch (error) {
        if (signal?.aborted) throw error;
      }
      if (Number.isFinite(cutoff)) {
        if (filter.end !== null && filter.end <= cutoff) tiers = [true];
        if (filter.start !== null && filter.start >= cutoff) tiers = [false];
      }
    }
    return { series, tiers, index: 0, tier: 0, after: null };
  }

  async function discoverSeriesPage({ mode, cursor, filter, limit, signal, newest }) {
    const state = cursor || await initialDiscovery(mode, filter, signal);
    const series = state.series[state.index];
    if (!series) return { markets: [], nextCursor: null, scanned: 0 };
    const archived = state.tiers[state.tier];
    // In the historical API, series_ticker and mve_filter are mutually exclusive.
    const params = { series_ticker: series.ticker, limit, cursor: state.after };
    if (!archived) {
      params.status = mode === 'archive' ? 'settled' : 'open';
      params.mve_filter = 'exclude';
      // The API describes strict second bounds. Widen by one second at the inclusive
      // lower edge, then check the exact UTC boundaries against settlement_ts locally.
      if (mode === 'archive' && filter.start !== null) params.min_settled_ts = filter.start / 1000 - 1;
      if (mode === 'archive' && filter.end !== null) params.max_settled_ts = filter.end / 1000;
    }
    const data = await request(archived ? '/historical/markets' : '/markets', params, signal);
    if (!Array.isArray(data?.markets)) throw new Error('Kalshi returned an unreadable market list.');
    const candidates = data.markets.filter((raw) => {
      if (!binaryMarket(raw)) return false;
      if (mode === 'live' && raw.status && raw.status !== 'open' && raw.status !== 'active') return false;
      return filter.acceptsDate(marketRow(raw, series, null, archived, mode));
    });
    const ids = [...new Set(candidates.map((raw) => raw.event_ticker))];
    const events = new Map();
    const checked = new Set();
    let warning = '';
    for (let i = 0; i < ids.length; i += 40) {
      const batch = ids.slice(i, i + 40);
      try {
        const result = await request('/events', { tickers: batch.join(','), limit: 200 }, signal);
        if (!Array.isArray(result?.events)) throw new Error('The exchange returned unreadable event details.');
        for (const event of result.events) events.set(event.event_ticker, event);
        for (const id of batch) checked.add(id);
      } catch (error) {
        if (signal?.aborted) throw error;
        warning = 'Some Kalshi event details could not be loaded. ' + (error?.message || '');
        break;
      }
    }
    const markets = candidates
      .filter((raw) => !warning || !filter.metadataRestricted || checked.has(raw.event_ticker))
      .map((raw) => marketRow(raw, series, events.get(raw.event_ticker), archived, mode));
    let { index, tier } = state;
    const after = data.cursor || null;
    if (!after) {
      tier++;
      if (tier >= state.tiers.length) {
        tier = 0;
        index++;
      }
    }
    const nextCursor = (!warning || newest) && index < state.series.length ? { ...state, index, tier, after } : null;
    return {
      markets, scanned: data.markets.length, nextCursor, nextKey: JSON.stringify([index, tier, after]), warning,
    };
  }

  async function newestElectionPage({ mode, cursor, limit, signal, filter }) {
    const url = new URL('https://api.elections.kalshi.com/v1/search/series');
    url.searchParams.set('category', 'Elections');
    url.searchParams.set('order_by', 'newest');
    url.searchParams.set('status', mode === 'live' ? 'open' : 'settled');
    url.searchParams.set('page_size', String(Math.max(5, Math.min(40, Math.ceil(limit / 4)))));
    if (cursor) url.searchParams.set('cursor', cursor);
    const page = await window.ElectionAPI.json(url.href, { signal });
    if (!Array.isArray(page.current_page)) throw new Error('Kalshi returned an unreadable election index.');
    const candidates = new Map();
    let scanned = 0, tail = Infinity, awaitingInactive = mode === 'archive';
    for (const row of page.current_page) {
      const summaries = row.markets || [];
      scanned += summaries.length;
      // Newest sorts two blocks by election opening. The search service subtracts
      // 9,999,999,999 seconds from inactive scores. The first inactive event may be
      // newer than the last active one, so a positive score cannot bound the archive.
      const score = number(row.search_score);
      const seconds = score === null ? NaN : score < 0 ? score + 9_999_999_999 : score;
      const opening = seconds > 946684800 && seconds < 4102444800 ? seconds * 1000 :
        summaries.reduce((t, m) => Math.min(t, Date.parse(m.open_ts) || Infinity), Infinity);
      tail = Number.isFinite(seconds) && seconds > 946684800 && seconds < 4102444800 ? opening : Infinity;
      if (score !== null && score < 0) awaitingInactive = false;
      if (row.category !== 'Elections' || !row.series_ticker) continue;
      const series = { ticker: row.series_ticker, title: row.series_title, tags: row.tags || [],
        feeMultiplier: row.fee_type === 'flat' ? null : number(row.fee_multiplier) };
      const event = { event_ticker: row.event_ticker, title: row.event_title, series_ticker: series.ticker };
      for (const m of summaries) {
        if (!m.ticker || candidates.has(m.ticker)) continue;
        if (filter.possibleHistory && !filter.possibleHistory({ openAt: m.open_ts, closeAt: m.close_ts })) continue;
        const raw = { ...m, event_ticker: event.event_ticker, yes_sub_title: m.yes_subtitle };
        if (!filter.acceptsMetadata(marketRow(raw, series, event, false, mode))) continue;
        candidates.set(m.ticker, { series, event, opening });
      }
    }
    const markets = [];
    let warning = '';
    // The index supplies the candidate tickers. Verify outcomes, dates, volume and fee
    // waivers against the individual exchange records before counting a match.
    const ids = [...candidates.keys()];
    for (let i = 0; i < ids.length; i += 60) {
      const pending = new Set(ids.slice(i, i + 60));
      for (const archived of mode === 'live' ? [false] : [false, true]) {
        if (!pending.size) break;
        const data = await request(archived ? '/historical/markets' : '/markets',
          { tickers: [...pending].join(','), limit: 100 }, signal);
        if (!Array.isArray(data.markets)) throw new Error('Kalshi returned unreadable contract details.');
        for (const raw of data.markets) {
          if (!pending.delete(raw.ticker) || !binaryMarket(raw)) continue;
          if (mode === 'live' && !['open','active'].includes(raw.status)) continue;
          const { series, event, opening } = candidates.get(raw.ticker);
          const market = marketRow(raw, series, event, archived, mode);
          market.discoveryListedAt = Number.isFinite(opening) ? new Date(opening).toISOString() : market.listedAt;
          markets.push(market);
        }
      }
      if (pending.size && mode === 'archive') warning = 'Some indexed Kalshi contracts could not be verified.';
    }
    return { markets, scanned, nextCursor: page.next_cursor || null, nextMaxTime: awaitingInactive ? Infinity : tail, warning };
  }

  async function discoverPage(options) {
    const { mode, filter, signal, cursor, newest, all } = options;
    if (mode === 'live' && all) return discoverOpenEvents(cursor, filter, signal);
    if (mode === 'archive' && filter.undated) return { markets: [], nextCursor: null, scanned: 0 };
    if (!newest) return discoverSeriesPage(options);
    if (options.electionIndex) return newestElectionPage(options);

    let state = cursor;
    if (!state) {
      const series = new Map((await catalog(signal)).map((item) => [item.ticker, item]));
      const feeds = [];
      if (mode === 'live') feeds.push({ archived: false, bound: Infinity });
      else {
        const cutoff = Date.parse((await request('/historical/cutoff', {}, signal)).market_settled_ts);
        // An archived contract must already have been listed when it settled.
        if (!Number.isFinite(cutoff) || filter.end === null || filter.end > cutoff)
          feeds.push({ archived: false, bound: Infinity });
        if (!Number.isFinite(cutoff) || filter.start === null || filter.start < cutoff)
          feeds.push({ archived: true, bound: Number.isFinite(cutoff) ? cutoff : Infinity });
      }
      state = { feeds, series, events: new Map() };
    }
    const feed = state.feeds.shift();
    // Creation-ordered feeds carry their own cursor and upper bound. Advance whichever
    // tier can still have the newest listing, including after the two tiers overlap.
    const data = await request(feed.archived ? '/historical/markets' : '/markets', {
      status: feed.archived ? undefined : mode === 'archive' ? 'settled' : 'open',
      mve_filter: 'exclude', limit: 1000, cursor: feed.after,
    }, signal);
    if (!Array.isArray(data.markets)) throw new Error('Kalshi returned an unreadable market list.');
    const rows = data.markets.filter(binaryMarket);
    const ids = [...new Set(rows.map((raw) => raw.event_ticker).filter((id) => !state.events.has(id)))];
    let warning = '';
    for (let i = 0; i < ids.length; i += 80) {
      const batch = ids.slice(i, i + 80);
      const detail = await request('/events', { tickers: batch.join(','), limit: 200 }, signal);
      if (!Array.isArray(detail.events)) throw new Error('Kalshi returned unreadable event details.');
      for (const event of detail.events) state.events.set(event.event_ticker, event);
      if (batch.some((id) => !state.events.has(id))) warning = 'Some Kalshi event categories could not be verified.';
    }
    const markets = [];
    for (const raw of rows) {
      const event = state.events.get(raw.event_ticker);
      if (!event || (event.category !== 'Elections' && !state.series.has(event.series_ticker))) continue;
      const series = state.series.get(event.series_ticker) || { ticker: event.series_ticker, title: event.title };
      markets.push(marketRow(raw, series, event, feed.archived, mode));
    }
    if (data.cursor) {
      const last = Date.parse(data.markets.at(-1)?.created_time);
      state.feeds.push({ ...feed, bound: Number.isFinite(last) ? Math.min(last, feed.bound) : feed.bound, after: data.cursor });
    }
    state.feeds.sort((a, b) => b.bound - a.bound);
    const next = state.feeds[0];
    return { markets, scanned: data.markets.length, nextCursor: next ? state : null,
      nextKey: next ? String(next.archived) + ':' + (next.after || 'first') : null, nextMaxTime: next?.bound, warning };
  }

  async function list({ mode = 'live', cursor, signal } = {}) {
    const initial = cursor || (await firstCursor(mode, signal));
    let offset = initial.offset;
    let pending = initial.pending.slice();
    const series = initial.series;
    const entries = new Map();
    const warnings = new Set();
    // Skip a few empty batches (a series may have no markets in the requested state).
    // Bound each click even when many old series have no open contracts.
    for (let batch = 0; batch < 3 && !entries.size; batch++) {
      const jobs = pending.splice(0, seriesPerPage * (mode === 'archive' ? 2 : 1));
      const count = mode === 'archive' ? 2 : 1;
      while (jobs.length + count <= seriesPerPage * count && offset < series.length) {
        const selected = series[offset++];
        jobs.push({ series: selected, archived: false });
        if (mode === 'archive') jobs.push({ series: selected, archived: true });
      }
      if (!jobs.length) break;
      const fetched = await pool(jobs, (job) => {
        const params = { series_ticker: job.series.ticker, limit: 100, cursor: job.cursor };
        if (!job.archived) params.status = mode === 'archive' ? 'settled' : 'open';
        return request(job.archived ? '/historical/markets' : '/markets', params, signal);
      });
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      if (fetched.every((item) => item.error)) throw fetched[0].error;
      fetched.forEach((result, index) => {
        const job = jobs[index];
        if (result.error) {
          pending.push(job);
          warnings.add('Some Kalshi series could not be loaded. Load more to retry.');
          return;
        }
        const data = result.value;
        for (const raw of data.markets || []) {
          if (!binaryMarket(raw)) continue;
          entries.set(raw.ticker, { raw, series: job.series, archived: job.archived });
        }
        if (data.cursor && data.cursor !== job.cursor) pending.push({ ...job, cursor: data.cursor });
      });
      if (warnings.size) break;
    }
    // The market feed omits event titles. A targeted event lookup also distinguishes
    // different election years sharing the same series and candidate name.
    const ids = [...new Set([...entries.values()].map((entry) => entry.raw.event_ticker))];
    const chunks = [];
    for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
    const eventPages = await pool(chunks, (chunk) =>
      request('/events', { tickers: chunk.join(','), limit: 200 }, signal),
    );
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const events = new Map();
    for (const page of eventPages) {
      for (const event of page.value?.events || []) events.set(event.event_ticker, event);
    }
    const markets = [...entries.values()].map((e) =>
      marketRow(e.raw, e.series, events.get(e.raw.event_ticker), e.archived, mode),
    );
    markets.sort((a, b) => (b.volume || 0) - (a.volume || 0) || a.id.localeCompare(b.id));
    const nextCursor = pending.length || offset < series.length ? { series, offset, pending } : null;
    if (!markets.length && nextCursor && !warnings.size)
      warnings.add('No matching markets in this group of Kalshi election series. Load more to continue.');
    return { markets, nextCursor, warning: [...warnings].join(' ') };
  }

  async function history(market, { start, end, signal, daily = false } = {}) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
      throw new Error('Choose a valid price-history window.');
    const span = end - start;
    const interval = daily || span > 120 * 86400 ? 1440 : span <= 2 * 86400 ? 1 : 60;
    const ticker = encodeURIComponent(market.id);
    const livePath =
      '/series/' + encodeURIComponent(market.seriesTicker) + '/markets/' + ticker + '/candlesticks';
    const archivePath = '/historical/markets/' + ticker + '/candlesticks';
    const paths = market.archived ? [archivePath, livePath] : [livePath, archivePath];
    const finished = Boolean(
      market.settledAt ||
      market.outcome === 0 ||
      market.outcome === 1 ||
      (market.closeAt && Date.parse(market.closeAt) <= Date.now()),
    );
    // A previously loaded market can migrate to the other tier between discovery and history.
    for (const path of finished ? paths : paths.slice(0, 1)) {
      const points = new Map();
      try {
        for (let from = Math.floor(start); from <= end;) {
          const to = Math.min(Math.floor(end), from + interval * 60 * 4999);
          const data = await request(path, { start_ts: from, end_ts: to, period_interval: interval }, signal);
          for (const candle of data.candlesticks || []) {
            const rawPrice = candle.price;
            if (!rawPrice || number(candle.volume_fp ?? candle.volume) === 0) continue;
            // Archived bars return fixed-point dollars under "close"; live bars use "close_dollars".
            let p = probability(rawPrice.close_dollars);
            if (p === null && rawPrice.close != null) {
              p =
                path === archivePath
                  ? probability(rawPrice.close)
                  : probability(Number(rawPrice.close) / 100);
            }
            const t = number(candle.end_period_ts);
            if (p !== null && t !== null && t >= start && t <= end) points.set(t, { t, p });
          }
          from = to + 1;
        }
      } catch (error) {
        if (signal?.aborted || !(error.status === 404 || /\b404\b/.test(error.message))) throw error;
      }
      if (points.size) return [...points.values()].sort((a, b) => a.t - b.t);
    }
    return [];
  }

  window.ElectionKalshi = { list, discoverPage, history };
})();

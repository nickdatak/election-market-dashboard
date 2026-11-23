(function () {
  'use strict';

  const GAMMA = 'https://gamma-api.polymarket.com';
  const CLOB = 'https://clob.polymarket.com';
  const RESOLUTIONS = 'https://data-api.polymarket.com/v2/resolutions';
  const DAY = 86400;
  // Gamma's /tags/slug/elections endpoint identifies this exchange-maintained tag.
  const ELECTION_TAG = '144';

  function arrayField(field) {
    if (Array.isArray(field)) return field;
    if (typeof field !== 'string') return [];
    try {
      const value = JSON.parse(field);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function number(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function price(value) {
    const result = number(value);
    return result !== null && result >= 0 && result <= 1 ? result : null;
  }

  function iso(value) {
    if (typeof value !== 'string' || !value) return null;
    // Gamma closedTime uses Postgres's 'YYYY-MM-DD hh:mm:ss+00' format.
    const normalized = value.replace(' ', 'T').replace(/(T.*)([+-]\d\d)$/, '$1$2:00');
    const t = Date.parse(normalized);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }

  function resolutionTime(value) {
    if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))) {
      // The resolution API expresses numeric timestamps in Unix seconds.
      const date = new Date(Number(value) * 1000);
      const year = date.getUTCFullYear();
      return year >= 0 && year <= 9999 ? date.toISOString() : null;
    }
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d(?:$|[T ])/i.test(value)) return null;
    const day = value.slice(0, 10);
    const midnight = new Date(day);
    if (!Number.isFinite(+midnight) || midnight.toISOString().slice(0, 10) !== day) return null;
    return iso(/[T ][\d:.]+$/i.test(value) ? value + 'Z' : value);
  }

  async function readPage(url, signal, discovery) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await window.ElectionAPI.json(url.href, { signal });
      } catch (error) {
        const retryable = error instanceof TypeError || [429, 500, 502, 503, 504].includes(error?.status);
        if (!discovery || attempt >= 4 || !retryable || signal?.aborted) throw error;
        await new Promise((resolve, reject) => {
          function abort() {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Request canceled', 'AbortError'));
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
          }, 1000 * 2 ** attempt);
          signal?.addEventListener('abort', abort, { once: true });
        });
      }
    }
  }

  async function resolutionStates(markets, signal, discovery = false, eventIds = null) {
    const conditionIds = markets.map((market) => String(market.conditionId).toLowerCase());
    const ids = [...new Set(conditionIds.filter((id) => /^0x[0-9a-f]{64}$/.test(id)))];
    const result = { states: new Map(), warning: '', unverified: new Set() };
    const unavailable = 'Some Polymarket settlement dates could not be loaded.';
    if (!ids.length) return result;
    function read(batch, requestSignal) {
      const url = new URL(RESOLUTIONS);
      if (eventIds) url.searchParams.set('event_id', eventIds.join(','));
      else url.searchParams.set('condition', batch.join(','));
      return readPage(url, requestSignal, discovery);
    }
    function collect(data) {
      if (!Array.isArray(data?.data)) return false;
      let valid = true;
      for (const row of data.data) {
        if (typeof row?.condition_id === 'string') result.states.set(row.condition_id.toLowerCase(), row);
        else valid = false;
      }
      return valid;
    }
    if (discovery) {
      // Discovery supplies a single batch. A failed lookup cannot establish that a market is undated or open.
      try {
        if (!collect(await read(ids, signal))) throw new Error('The exchange returned unreadable settlement data.');
      } catch (error) {
        if (signal?.aborted) throw error;
        result.warning = unavailable + (error?.message ? ' ' + error.message : '');
        for (const id of ids) if (!result.states.has(id)) result.unverified.add(id);
      }
      return result;
    }
    if (signal?.aborted || typeof AbortController === 'undefined') return { ...result, warning: unavailable };
    // Gamma already supplied the listing. Bound the optional enrichment to one short wait.
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, 3500);
    signal?.addEventListener('abort', abort, { once: true });
    const batches = [];
    for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
    try {
      const responses = await Promise.allSettled(batches.map((batch) => read(batch, controller.signal)));
      for (const response of responses) {
        if (!collect(response.value)) result.warning = unavailable;
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
    return result;
  }

  function normalize(market, event, resolution) {
    const outcomes = arrayField(market.outcomes).map((value) => String(value).trim().toLowerCase());
    const yes = outcomes.indexOf('yes');
    const no = outcomes.indexOf('no');
    if (outcomes.length !== 2 || yes < 0 || no < 0 || !market.question || !market.id) return null;

    const values = arrayField(market.outcomePrices);
    const yesPrice = price(values[yes]);
    const noPrice = price(values[no]);
    const quotesForFirst = [price(market.bestBid), price(market.bestAsk)];
    const reportedSettlement = resolutionTime(resolution?.resolved_at);
    const oracleFinal = resolution?.status === 'resolved' ? resolutionTime(resolution.last_update_timestamp) : null;
    const final =
      market.closed === true &&
      (reportedSettlement !== null || oracleFinal !== null || market.umaResolutionStatus === 'resolved' || market.automaticallyResolved === true);
    const binaryPayout = (yesPrice === 1 && noPrice === 0) || (yesPrice === 0 && noPrice === 1);
    const outcome = final && binaryPayout ? yesPrice : null;
    const settledAt = reportedSettlement || (outcome === null ? null : oracleFinal || resolutionTime(market.closedTime));
    const expectedResolutionAt =
      !settledAt && market.closed === false ? resolutionTime(resolution?.expected_settlement_time) : null;
    const token = arrayField(market.clobTokenIds)[yes];
    const path = event.slug
      ? '/event/' + encodeURIComponent(event.slug)
      : '/market/' + encodeURIComponent(market.slug || '');
    const deepLink =
      event.slug && market.slug && market.slug !== event.slug ? '/' + encodeURIComponent(market.slug) : '';
    const firstChange = number(market.oneDayPriceChange);
    return {
      id: 'poly-' + market.id,
      source: 'polymarket',
      title: market.question,
      eventTitle: event.title || market.question,
      countryName: event.countryName || null,
      label: market.groupItemTitle || 'Yes',
      price: yesPrice,
      yesBid: yes === 0 ? quotesForFirst[0] : quotesForFirst[1] === null ? null : 1 - quotesForFirst[1],
      yesAsk: yes === 0 ? quotesForFirst[1] : quotesForFirst[0] === null ? null : 1 - quotesForFirst[0],
      dayChange: firstChange === null ? null : yes === 0 ? firstChange : -firstChange,
      volume: number(market.volumeNum ?? market.volume),
      volumeUnit: 'USD',
      feesEnabled: typeof market.feesEnabled === 'boolean' ? market.feesEnabled : null,
      feeRate: number(market.feeSchedule?.rate),
      volume24h: number(market.volume24hr),
      listedAt: iso(market.createdAt),
      discoveryListedAt: market.discoveryListedAt || null,
      openedAt: iso(market.startDate || market.createdAt),
      closeAt: iso(market.endDate || event.endDate),
      tradingClosedAt: market.closed ? iso(market.closedTime) : null,
      settledAt,
      settlementBasis: reportedSettlement ? 'reported' : settledAt && oracleFinal ? 'oracle-final' : settledAt ? 'resolved-close' : null,
      expectedResolutionAt,
      expectedResolutionBasis:
        expectedResolutionAt && typeof resolution?.settlement_time_basis === 'string'
          ? resolution.settlement_time_basis.trim() || null
          : null,
      updatedAt: iso(market.updatedAt),
      outcome,
      url: 'https://polymarket.com' + path + deepLink,
      tokenId: typeof token === 'string' ? token : null,
    };
  }

  async function marketPage(mode, cursor, limit, signal, discovery, all = false, newest = false) {
    const live = mode === 'live';
    const url = new URL(GAMMA + '/markets/keyset');
    url.searchParams.set('tag_id', ELECTION_TAG);
    url.searchParams.set('limit', String(limit));
    // Gamma's closed index supports close-time ordering. A market cannot have been
    // listed after its recorded close, which supplies an upper bound on unseen listings.
    url.searchParams.set('closed', String(!live));
    if (live) url.searchParams.set('active', 'true');
    const order = newest ? (live ? 'createdAt' : 'closedTime') : all ? 'id' : live ? 'volume24hr' : 'volumeNum';
    url.searchParams.set('order', order);
    url.searchParams.set('ascending', String(order === 'id'));
    if (cursor) url.searchParams.set('after_cursor', cursor);
    const result = await readPage(url, signal, discovery);
    if (!Array.isArray(result?.markets)) throw new Error('Polymarket returned an unreadable market list.');
    const listed = result.markets.filter((market) =>
      live ? market?.closed === false && market.active === true && !market.archived : market?.closed === true,
    );
    const tail = result.markets.at(-1);
    const last = Date.parse(live ? tail?.createdAt : iso(tail?.closedTime));
    const next = result.next_cursor || null;
    return { listed, next, scanned: result.markets.length,
      nextMaxTime: newest && Number.isFinite(last) ? last : Infinity };
  }

  function withStates(listed, states) {
    return listed.map((market) => normalize(
      market, market.events?.[0] || {}, states.get(String(market.conditionId).toLowerCase()),
    )).filter(Boolean);
  }

  async function list({ mode = 'live', cursor, signal } = {}) {
    const page = await marketPage(mode, cursor, 36, signal, false);
    const { states, warning } = await resolutionStates(page.listed, signal);
    return { markets: withStates(page.listed, states), nextCursor: page.next, warning };
  }

  async function electionPage(mode, cursor, limit, signal, filter) {
    const feeds = cursor?.feeds || (mode === 'archive' ? [true, false] : [false]).map((closed) => ({ closed, bound: Infinity }));
    const feed = feeds.shift();
    const url = new URL(GAMMA + '/events/keyset');
    for (const [key, value] of Object.entries({ tag_id: ELECTION_TAG, closed: feed.closed,
      order: 'createdAt', ascending: false, limit: Math.max(3, Math.min(30, Math.ceil(limit / 5))) })) url.searchParams.set(key, value);
    if (feed.after) url.searchParams.set('after_cursor', feed.after);
    const data = await readPage(url, signal, true);
    if (!Array.isArray(data.events)) throw new Error('Polymarket returned an unreadable election index.');
    const listed = [];
    let scanned = 0;
    for (const event of data.events) {
      const summary = { id: event.id, title: event.title, slug: event.slug, countryName: event.countryName, endDate: event.endDate };
      for (const raw of event.markets || []) {
        scanned++;
        if (mode === 'live' ? raw.closed !== false || !raw.active || raw.archived : raw.closed !== true) continue;
        const record = { ...raw, events: [summary], discoveryListedAt: iso(event.createdAt) };
        const market = normalize(record, summary);
        if (market && (!filter.possibleHistory || filter.possibleHistory(market)) && filter.acceptsMetadata(market)) listed.push(record);
      }
    }
    if (data.next_cursor) feeds.push({ closed: feed.closed, bound: Date.parse(data.events.at(-1)?.createdAt) || feed.bound, after: data.next_cursor });
    feeds.sort((a,b) => b.bound - a.bound);
    const next = feeds.length ? { feeds } : null;
    return { listed, next, scanned, nextMaxTime: feeds[0]?.bound ?? -Infinity,
      key: feeds.length ? feeds[0].closed + ':' + (feeds[0].after || 'first') : 'end' };
  }

  async function discoverPage({ mode, cursor, signal, limit, filter, all, newest, electionIndex }) {
    const buffered = Boolean(cursor?.page);
    const page = buffered ? cursor.page : electionIndex ? await electionPage(mode, cursor, limit, signal, filter) : await marketPage(mode, cursor, limit, signal, true, all, newest);
    const offset = buffered ? cursor.offset : 0;
    if (!buffered && !electionIndex && filter.metadataRestricted) {
      // Gamma provides the country and title before condition-level resolution enrichment.
      page.listed = page.listed.filter((raw) => {
        const row = normalize(raw, raw.events?.[0] || {});
        return row && filter.acceptsMetadata(row);
      });
    }
    // Several markets often belong to one election. An event lookup covers them together.
    let eventIds = null, size = 20;
    if (newest) {
      const ids = new Set();
      let end = offset;
      for (; end < page.listed.length; end++) {
        const id = String(page.listed[end].events?.[0]?.id || '');
        if (!/^[1-9]\d*$/.test(id) || (!ids.has(id) && ids.size === 20)) break;
        ids.add(id);
      }
      if (ids.size) { eventIds = [...ids]; size = end - offset; }
    }
    let listed = page.listed.slice(offset, offset + size);
    const { states, warning, unverified } = await resolutionStates(listed, signal, true, eventIds);
    if (mode === 'live' || filter.undated || filter.start !== null || filter.end !== null) {
      listed = listed.filter((market) => !unverified.has(String(market.conditionId).toLowerCase()));
    }
    const nextOffset = offset + size;
    const nextCursor = nextOffset < page.listed.length ? { page, offset: nextOffset } : page.next;
    return {
      markets: withStates(listed, states), nextCursor: warning && !all && !newest ? null : nextCursor,
      nextKey: JSON.stringify([page.key ?? page.next, nextOffset < page.listed.length ? nextOffset : 0]),
      nextMaxTime: nextOffset < page.listed.length
        ? Math.max(page.nextMaxTime ?? -Infinity, Date.parse(electionIndex ? page.listed[nextOffset].discoveryListedAt :
          mode === 'live' ? page.listed[nextOffset].createdAt : iso(page.listed[nextOffset].closedTime)) || Infinity)
        : page.nextMaxTime,
      warning, scanned: buffered ? 0 : page.scanned, pages: buffered ? 0 : 1,
    };
  }

  function cleanHistory(rows, start, end) {
    const samples = new Map();
    for (const row of rows) {
      const t = number(row.t);
      const p = price(row.p);
      if (t !== null && t >= start && t <= end && p !== null) samples.set(t, p);
    }
    return Array.from(samples, ([t, p]) => ({ t, p })).sort((a, b) => a.t - b.t);
  }

  async function history(market, { start, end, signal, daily = false, utcCloses = false } = {}) {
    if (!market.tokenId || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return [];
    const duration = end - start;
    const url = new URL(CLOB + '/prices-history');
    url.searchParams.set('market', market.tokenId);
    if (utcCloses) {
      // Whole-life daily sampling can omit UTC dates that have hourly observations.
      // The CLOB accepts bounded 14-day requests, including for archived tokens.
      const byDay = new Map();
      url.searchParams.set('fidelity', '60');
      for (let first = Math.ceil(start); first <= end;) {
        const last = Math.min(Math.floor(end), first + 14 * DAY - 1);
        url.searchParams.set('startTs', first);
        url.searchParams.set('endTs', last);
        const result = await readPage(url, signal, true);
        if (!Array.isArray(result.history)) throw new Error('Polymarket returned unreadable price history.');
        for (const point of cleanHistory(result.history, first, last)) byDay.set(Math.floor(point.t / DAY), point);
        first = last + 1;
      }
      return [...byDay.values()];
    }
    if (!daily && duration <= 14 * DAY) {
      url.searchParams.set('startTs', Math.floor(start));
      url.searchParams.set('endTs', Math.ceil(end));
      url.searchParams.set('fidelity', duration <= 2 * DAY ? '5' : '30');
    } else {
      // Longer explicit windows are rejected by CLOB. The whole-life series
      // preserves old observations, including prices for closed contracts.
      url.searchParams.set('interval', 'max');
      url.searchParams.set('fidelity', daily ? '1440' : '720');
    }
    const result = await window.ElectionAPI.json(url.href, { signal });
    if (!Array.isArray(result.history)) throw new Error('Polymarket returned unreadable price history.');
    return cleanHistory(result.history, start, end);
  }

  window.ElectionPolymarket = Object.freeze({ list, discoverPage, history });
})();

(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const DAY = 86400;
  const venues = ['kalshi', 'polymarket'];
  const sourceName = (key) => ({ kalshi: 'Kalshi', polymarket: 'Polymarket' })[key] || key;
  const adapters = { kalshi: window.ElectionKalshi, polymarket: window.ElectionPolymarket };
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const icons = {
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    coverage:
      '<circle cx="12" cy="12" r="8.5"/><path d="M7 12a5 5 0 0 1 5-5m0 5 7-7"/><circle cx="12" cy="12" r="1.2"/>',
    move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>',
    reset: '<path d="M5 9a7.5 7.5 0 1 1 0 7M5 4v5h5"/>',
    overview:
      '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9m-10 4h6"/>',
    backtest: '<path d="M3 4v16h18M6 15l4-5 4 3 6-8m-4 0h4v4"/>',
    database:
      '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v6c0 4 16 4 16 0v-6"/>',
    refresh:
      '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a7.4 7.4 0 0 1 12-4l3 3M4 16l3 3a7.4 7.4 0 0 0 12-4"/>',
    filters: '<path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    poly: '<path d="m3.5 7 16-5v20l-16-5V7Zm0 0 16 5-16 5"/>',
    all: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4m-18 5 9 4 9-4"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    out: '<path d="M8 5h11v11M19 5 5 19"/>',
    play: '<path d="m7 4 13 8-13 8z"/>',
  };
  function icon(name) {
    return (
      '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' +
      (icons[name] || '') +
      '</svg>'
    );
  }
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
  const snap = window.ElectionSnapshot || { markets: [], featuredIds: [], history: {} };
  const kalshiSnap = window.KalshiSnapshot || { markets: [] };
  const sourceSnap = { polymarket: snap, kalshi: kalshiSnap };
  const colors = ['var(--plot-series-1)', 'var(--plot-series-2)', 'var(--plot-series-3)'];
  const isNumeric = (x) => typeof x === 'number' && Number.isFinite(x);
  const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const pct = (p) => (isNumeric(p) ? fmt.format(p * 100) + '%' : '—');
  const cents = (p) =>
    isNumeric(p) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(p * 100) + '¢' : '—';
  const dateOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const fullDate = new Intl.DateTimeFormat('en-US', { ...dateOptions, year: 'numeric' });
  const shortDate = new Intl.DateTimeFormat('en-US', dateOptions);
  const formatDate = (d, format = fullDate) => {
    if (d == null || d === '') return '—';
    const stamp = new Date(d);
    return Number.isFinite(stamp.getTime()) ? format.format(stamp) : '—';
  };
  const asOf = (d) =>
    d ? formatDate(d, shortDate) + ', ' + new Date(d).toISOString().slice(11, 16) + ' UTC' : '';
  function volumeText(m) {
    if (!isNumeric(m.volume)) return '—';
    const amount = compact.format(m.volume);
    if (m.volumeUnit === 'USD') return '$' + amount;
    return m.volumeUnit === 'contracts' ? amount + (m.volume === 1 ? ' contract' : ' contracts') : amount;
  }
  function sourceLabel(key) {
    if (key === 'kalshi')
      return '<span class="venue-icon kalshi"><svg class="kalshi-wordmark" aria-hidden="true" focusable="false" viewBox="0 0 300 88" fill="currentColor"><use href="#kalshi-wordmark"/></svg></span><span class="sr-only">Kalshi</span>';
    return (key === 'polymarket' ? '<span class="venue-icon polymarket">' + icon('poly') + '</span>' : '') + esc(sourceName(key));
  }
  const sourceTag = (key) => '<span class="venue-tag">' + sourceLabel(key) + '</span>';
  const nowSec = () => Math.floor(Date.now() / 1000);
  const unique = (markets) => [...new Map(markets.map((m) => [m.id, m])).values()];
  const snapshots = (mode, source) => (mode === 'live' ? sourceSnap[source] : { markets: [] });
  const data = {};
  for (const mode of ['live', 'archive']) {
    data[mode] = {};
    for (const source of venues) {
      const seed = snapshots(mode, source);
      data[mode][source] = {
        markets: seed.markets || [],
        at: seed.asOf || null,
        fetched: false,
        busy: false,
        cursor: null,
        warning: '',
        error: '',
      };
    }
  }
  let page = '',
    source = 'all',
    query = '',
    pageNo = 0,
    currentRows = [];
  let countryFilter = null,
    atlas;
  let atlasInputs = [];
  const liveTimes = new WeakMap();
  let liveForm, liveScan, liveView = null, liveMessage = '', livePaintTimer, liveSearchStarted = false;
  const tableSize = 8;
  const defaultBoardSort = { key: 'volume', direction: -1 };
  let boardSort = defaultBoardSort;
  function resetBoardOrder() {
    boardSort = defaultBoardSort;
    pageNo = 0;
  }
  const namesOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const sortButtons = [...$('market-head').querySelectorAll('button[data-sort]')];
  function outcomeLabel(market) {
    if (market.label && market.label.toLowerCase() !== 'yes') return market.label;
    return market.title !== market.eventTitle ? market.title : 'Yes contract';
  }
  function sortBoard(rows, mode) {
    const sort = boardSort;
    for (const button of sortButtons) {
      if (button.dataset.sort === 'value') button.textContent = mode === 'live' ? 'Yes price' : 'Result';
      if (button.dataset.sort === sort.key)
        button.parentElement.setAttribute('aria-sort', sort.direction === 1 ? 'ascending' : 'descending');
      else button.parentElement.removeAttribute('aria-sort');
    }
    const values = {
      name: (m) => m.eventTitle || m.title,
      source: (m) => sourceName(m.source),
      value: (m) => mode === 'live' ? m.price : m.outcome,
      volume: (m) => isNumeric(m.volume) ? m.volume : null,
      date: (m) => window.ElectionSettlement.dateFor(m, mode)?.ms,
    };
    // Read dates and other keys once per contract, before paging the filtered result.
    return rows.map((market) => ({ market, value: values[sort.key](market) })).sort((a, b) => {
      if ((a.value == null) !== (b.value == null)) return a.value == null ? 1 : -1;
      let order = a.value == null ? 0 : typeof a.value === 'string' ? namesOrder.compare(a.value, b.value) : a.value - b.value;
      if (!order && sort.key === 'name') order = namesOrder.compare(outcomeLabel(a.market), outcomeLabel(b.market));
      return order * sort.direction || namesOrder.compare(a.market.source, b.market.source) || namesOrder.compare(a.market.id, b.market.id);
    }).map((entry) => entry.market);
  }
  const boardSettlement = window.ElectionSettlement.create($('board-settlement'), {
    onChange() {
      resetBoardOrder();
      renderBoard();
    },
  });
  const modeForPage = () =>
    page === 'overview' ? 'live' : page === 'backtest' ? $('test-mode').value : 'archive';
  const sourcesFor = (filter) => (filter === 'all' ? venues : [filter]);
  const marketOrder = new WeakMap();
  function orderedMarkets(mode, filter = 'all', view = null) {
    // Rotate events within each venue and then venues. Volume units differ by exchange.
    const queues = sourcesFor(filter).map((key) => {
      const input = view?.[key] ?? data[mode][key].markets;
      if (marketOrder.has(input)) return marketOrder.get(input);
      const groups = new Map();
      for (const market of input) {
        const event = market.eventTitle || market.title;
        if (!groups.has(event)) groups.set(event, []);
        groups.get(event).push(market);
      }
      const rows = [];
      for (let i = 0, active = [...groups.values()]; active.length; i++) {
        active = active.filter((group) => group[i]);
        for (const group of active) rows.push(group[i]);
      }
      marketOrder.set(input, rows);
      return rows;
    });
    if (queues.length === 1) return queues[0];
    const output = [];
    for (let i = 0; queues.some((queue) => i < queue.length); i++) {
      for (const queue of queues) if (queue[i]) output.push(queue[i]);
    }
    return output;
  }
  function visibleLive() {
    return liveScan?.hasRows ? liveScan.rows : liveView;
  }
  function liveAction() {
    if (liveForm.busy) liveForm.cancel();
    else liveForm.fetchAll();
  }
  function applyLive(_markets, _assign, result, options) {
    const rows = liveScan.rows;
    const at = new Date().toISOString();
    const unrestricted = options.count === 'all' && !options.from && !options.to &&
      !options.query && !options.excludedCountries.length;
    for (const key of sourcesFor(options.source)) {
      const state = data.live[key];
      if (unrestricted && result.completedSources.includes(key)) {
        state.markets = rows[key];
        state.at = at;
        state.fetched = true;
        state.completeStarted = liveScan.started;
      } else if (rows[key].length) {
        state.markets = unique(state.markets.concat(rows[key]));
      }
    }
    liveView = unrestricted && options.source === 'all' && result.exhausted ? null : rows;
    if (!liveView) {
      window.ElectionDiscovery.saveLive({ started: liveScan.started, at, rows }).catch(() => {
        // Private browsing and storage limits still allow the current session to use the complete catalog.
      });
    }
    if (page === 'overview') {
      pageNo = 0;
      if (options.source !== 'all' && source !== 'all') source = options.source;
    }
  }
  async function restoreLive() {
    let saved;
    try { saved = await window.ElectionDiscovery.readLive(); } catch { return; }
    if (liveSearchStarted || !saved || !Number.isFinite(Date.parse(saved.at))) return;
    if (!venues.every((key) => Array.isArray(saved.rows?.[key]) &&
        !(Date.parse(data.live[key].at) > Date.parse(saved.at)))) return;
    for (const key of venues) {
      Object.assign(data.live[key], { markets: saved.rows[key], at: saved.at, fetched: true, completeStarted: saved.started });
    }
    liveProgress('Saved live catalog · ' + asOf(saved.at) + '.');
    if (page === 'overview' || (page === 'backtest' && modeForPage() === 'live')) updateViews();
  }
  function liveProgress(message) {
    liveMessage = message;
    if (page !== 'overview') return;
    $('catalog-status').textContent = message;
    $('atlas-status').textContent = message;
    $('atlas-status').hidden = !message;
  }
  function receiveLivePage({ source, markets }) {
    if (!markets.length || !liveScan) return;
    const stamp = new Date().toISOString();
    for (const market of markets) liveTimes.set(market, stamp);
    liveScan.rows[source] = liveScan.rows[source].concat(markets);
    liveScan.hasRows = true;
    if (page === 'overview' && !livePaintTimer) {
      livePaintTimer = setTimeout(() => {
        livePaintTimer = null;
        if (page === 'overview') updateViews();
      }, 600);
    }
  }
  function shortError(error) {
    if (error?.status === 429) return 'rate limit reached';
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'request timed out';
    if (Number.isFinite(error?.status)) return 'HTTP ' + error.status;
    return 'connection unavailable';
  }
  function statusMessage(mode, filter) {
    return sourcesFor(filter)
      .map((key) => {
        const s = data[mode][key];
        if (s.busy) return 'Loading ' + sourceName(key) + '…';
        if (s.error) {
          const directKalshi =
            key === 'kalshi' && document.querySelector('meta[name="election-api"]').content === 'direct';
          const recovery = directKalshi
            ? 'Start the included local server with node server.mjs to load Kalshi.'
            : 'Refresh to retry.';
          const retained = s.markets.length ? ' Showing previously loaded contracts.' : '';
          return sourceName(key) + ' — ' + s.error + '.' + retained + ' ' + recovery;
        }
        return s.warning;
      })
      .filter(Boolean)
      .join(' ');
  }
  const canFetchMore = (mode, filter) =>
    sourcesFor(filter).some((key) => {
      const s = data[mode][key];
      return !s.busy && (!s.fetched || s.cursor);
    });
  function updateViews() {
    const mode = modeForPage();
    const filter = page === 'backtest' ? 'all' : source;
    const states = sourcesFor(filter).map((key) => data[mode][key]);
    const busy = states.some((s) => s.busy);
    $('refresh-button').disabled = page === 'archive' && busy;
    $('refresh-button').classList.toggle('busy-icon', page === 'archive' && busy);
    const liveBusy = liveForm.busy;
    $('refresh-label').textContent = page === 'backtest' ? 'Fetch options' : page === 'overview'
      ? (liveBusy ? 'Cancel fetch' : 'Fetch all live') : 'Refresh archive';
    $('refresh-button').firstElementChild.innerHTML = icon(page === 'backtest' ? 'filters' : page === 'overview' && liveBusy ? 'x' : 'refresh');
    $('refresh-button').setAttribute('aria-label', $('refresh-label').textContent);
    $('refresh-button').title = $('refresh-label').textContent;
    const times = states
      .map((s) => s.at)
      .filter(Boolean)
      .sort();
    const prefix = states.every((s) => s.fetched)
      ? 'Fetched'
      : states.some((s) => s.fetched)
        ? 'Mixed data · oldest'
        : 'Snapshot';
    $('freshness').dataset.state = busy ? 'busy' : states.every((s) => s.fetched) ? 'fetched' : 'snapshot';
    $('freshness').textContent = busy
      ? 'Requesting exchange data…'
      : times.length
        ? prefix + ' · ' + asOf(times[0])
        : 'On-demand exchange data';
    if (!atlas) {
      atlas = window.ElectionAtlas.create({
        openMarket: openDetail,
        showCountry: filterByCountry,
        loadMore: liveAction,
        sourceName,
        sourceTag,
        cents,
      });
    }
    const view = visibleLive();
    const inputs = venues.map((key) => view?.[key] ?? data.live[key].markets);
    if (!inputs.every((rows, index) => rows === atlasInputs[index])) {
      atlas.update(orderedMarkets('live', 'all', view));
      atlasInputs = inputs;
    }
    if (page === 'overview') {
      atlas.requestState({
        busy: liveBusy,
        message: liveMessage,
      });
      if (liveBusy || liveView) {
        $('freshness').dataset.state = liveBusy ? 'busy' : 'fetched';
        $('freshness').textContent = liveBusy ? 'Fetching live contracts…' : 'Live search results';
      }
      $('show-live-library').hidden = !liveView || liveBusy;
    }
    if (page === 'backtest') {
      $('freshness').dataset.state = 'ondemand';
      $('freshness').textContent = 'On-demand contract search';
      if ($('trading-replay').hidden) window.ElectionTestUI.update({
        busy,
        message: statusMessage(mode, 'all'),
      });
    } else renderBoard();
  }
  async function loadCatalog(mode, keys, append = false) {
    const jobs = keys.filter((key) => {
      const s = data[mode][key];
      return !s.busy && (!append || !s.fetched || s.cursor);
    });
    if (page === 'archive' && mode === 'archive' && jobs.length) resetBoardOrder();
    for (const key of jobs) {
      const s = data[mode][key];
      s.busy = true;
      s.error = s.warning = '';
    }
    if (mode === modeForPage()) updateViews();
    await Promise.all(
      jobs.map(async (key) => {
        const s = data[mode][key];
        try {
          const result = await adapters[key].list({ mode, cursor: append ? s.cursor : undefined });
          s.markets = unique(append && s.fetched ? s.markets.concat(result.markets) : result.markets);
          s.at = new Date().toISOString();
          s.fetched = true;
          s.cursor = result.nextCursor;
          s.warning = result.warning || '';
        } catch (e) {
          s.error = shortError(e);
        } finally {
          s.busy = false;
          if (mode === modeForPage()) updateViews();
        }
      }),
    );
  }
  function filteredBoard(mode, needle) {
    const view = mode === 'live' ? visibleLive() : null;
    const available = sourcesFor(source).flatMap((key) => view?.[key] ?? data[mode][key].markets);
    const all =
      mode === 'live' && countryFilter
        ? available.filter((m) => atlas.countriesFor(m).includes(countryFilter))
        : available;
    const rows = all.filter(
      (m) =>
        boardSettlement.matches(m) &&
        (!needle ||
          [m.eventTitle, m.title, m.label, m.id, sourceName(m.source)].some((s) =>
            String(s || '')
              .toLowerCase()
              .includes(needle),
          )),
    );
    return { rows: sortBoard(rows, mode), total: all.length };
  }
  let boardResults;
  function renderBoard(pageOnly = false) {
    const mode = modeForPage(), live = mode === 'live', needle = query.trim().toLowerCase();
    boardSettlement.setMode(mode);
    const chip = $('country-filter');
    chip.hidden = !live || !countryFilter;
    if (!chip.hidden) {
      chip.firstElementChild.textContent = atlas.countryName(countryFilter);
      chip.setAttribute('aria-label', 'Clear country filter: ' + atlas.countryName(countryFilter));
    }
    if (!pageOnly || !boardResults) boardResults = filteredBoard(mode, needle);
    const { rows, total } = boardResults;
    const maxPage = Math.max(0, Math.ceil(rows.length / tableSize) - 1);
    pageNo = Math.min(pageNo, maxPage);
    const start = pageNo * tableSize;
    currentRows = rows.slice(start, start + tableSize);
    $('market-rows').innerHTML = currentRows
      .map((m, i) => {
        const settlement = window.ElectionSettlement.dateFor(m, mode);
        const settlementDate = settlement
          ? window.ElectionSettlement.labelFor(m, settlement) + ' ' + formatDate(settlement.ms)
          : 'Unlisted';
        const secondary = outcomeLabel(m);
        const price =
          '<span class="price-block"><span class="number' + (isNumeric(m.price) ? ' outcome-yes' : '') + '">' +
          cents(m.price) +
          '</span>' +
          (isNumeric(m.price)
            ? '<span class="price-track" aria-hidden="true"><b style="width:' +
              Math.min(1, Math.max(0, m.price)) * 100 +
              '%"></b></span>'
            : '') +
          '</span>';
        const result =
          m.outcome == null
            ? 'Unconfirmed'
            : '<span class="result-pill ' +
              (m.outcome ? 'outcome-yes' : 'no outcome-no') +
              '">' +
              (m.outcome ? 'Yes' : 'No') +
              '</span>';
        return (
          '<tr data-row="' +
          i +
          '"><td><button class="market-link" aria-label="' +
          esc('Open ' + m.title + ' on ' + sourceName(m.source)) +
          '">' +
          esc(m.eventTitle || m.title) +
          '</button><span class="market-sub">' +
          esc(secondary) +
          '</span></td><td>' +
          sourceTag(m.source) +
          '</td><td>' +
          (live ? price : result) +
          '</td><td class="volume-col nowrap"><span class="number">' +
          volumeText(m) +
          '</span></td><td class="date-col nowrap">' +
          settlementDate +
          (live && m.closeAt ? '<span class="market-sub">Closes ' + formatDate(m.closeAt) + '</span>' : '') +
          '</td><td>' +
          icon('right') +
          '</td></tr>'
        );
      })
      .join('');
    const count = rows.length;
    const filtered = Boolean(needle || boardSettlement.active);
    $('row-range').textContent = count
      ? fmt.format(start + 1) + '–' + fmt.format(start + currentRows.length) + ' of ' + fmt.format(count) + (filtered ? ' matching' : ' loaded')
      : '0 contracts';
    $('loaded-count').textContent =
      (filtered ? fmt.format(count) + ' of ' : '') +
      fmt.format(total) +
      (total === 1 ? ' contract' : ' contracts') +
      (live && countryFilter ? ' in ' + atlas.countryName(countryFilter) : ' loaded');
    $('board-empty').hidden = !!count;
    $('board-empty').textContent = boardSettlement.invalid
      ? 'Adjust the settlement date range to see matching contracts.'
      : filtered
        ? 'No loaded contracts match these filters.'
        : countryFilter && live
          ? 'No loaded contracts for this country and exchange.'
          : 'No contracts to display yet.';
    $('previous').disabled = pageNo === 0;
    $('next').disabled = pageNo >= maxPage;
    $('fetch-more').disabled = !live && !canFetchMore(mode, source);
    $('fetch-more-label').textContent = live ? 'Fetch options' : 'Fetch more';
    $('catalog-status').textContent = live ? liveMessage : statusMessage(mode, source);
    document
      .querySelectorAll('#venue-filters button')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.source === source)));
  }
  const chartColors = colors;
  const featureMarkets = snap.featuredIds.map((id) => snap.markets.find((m) => m.id === id)).filter(Boolean);
  const feature = {
    days: 90,
    end: Math.floor(Date.parse(snap.asOf) / 1000),
    series: snap.history,
    controller: null,
    busy: false,
    pendingDays: null,
    error: '',
  };
  function rangeButtons(host, value, onClick) {
    host.innerHTML = [7, 30, 90]
      .map(
        (n) =>
          '<button type="button" aria-label="' +
          n +
          ' days" aria-pressed="' +
          (value === n) +
          '" data-days="' +
          n +
          '">' +
          n +
          'D</button>',
      )
      .join('');
    host.onclick = (e) => {
      const b = e.target.closest('button[data-days]');
      if (b) onClick(Number(b.dataset.days));
    };
  }
  function renderFeature() {
    if (!featureMarkets.length) {
      $('feature').hidden = true;
      return;
    }
    // This curated snapshot tracks three specific Yes contracts from the same race.
    $('feature-title').textContent =
      snap.eventTitle === 'Presidential Election Winner 2028'
        ? '2028 U.S. presidential election'
        : snap.eventTitle;
    rangeButtons($('feature-ranges'), feature.pendingDays || feature.days, fetchFeature);
    const from = feature.end - feature.days * DAY;
    const series = featureMarkets.map((m, i) => ({
      name: m.label,
      color: chartColors[i],
      points: (feature.series[m.id] || []).filter((p) => p.t >= from && p.t <= feature.end),
    }));
    $('feature-legend').innerHTML = series
      .map(
        (line, index) => `
      <button class="legend-row" data-candidate="${index}" aria-label="View ${esc(line.name)} contract">
        <i class="legend-dot" style="--series:${line.color}"></i>
        <span class="legend-name">${esc(line.name)}</span>
        <span class="legend-value">${pct(line.points.at(-1)?.p)}</span>
      </button>`,
      )
      .join('');
    window.ElectionChart.draw($('feature-chart'), { series, start: from, end: feature.end, dark: true });
    const last = Math.max(0, ...series.map((s) => s.points.at(-1)?.t || 0));
    $('feature-note').textContent = feature.busy
      ? 'Loading price history…'
      : feature.error ||
        (last ? 'Last observation · ' + asOf(last * 1000) : 'No observations for this period');
  }
  async function fetchFeature(days) {
    feature.controller?.abort();
    const controller = new AbortController();
    feature.controller = controller;
    feature.pendingDays = days;
    feature.busy = true;
    feature.error = '';
    renderFeature();
    const end = nowSec(),
      start = end - days * DAY;
    const results = await Promise.allSettled(
      featureMarkets.map((m) => adapters.polymarket.history(m, { start, end, signal: controller.signal })),
    );
    if (controller.signal.aborted) return;
    feature.busy = false;
    feature.pendingDays = null;
    const failures = results.filter((r) => r.status === 'rejected').length;
    if (!failures) {
      feature.days = days;
      feature.end = end;
      feature.series = Object.fromEntries(results.map((r, i) => [featureMarkets[i].id, r.value]));
    } else
      feature.error =
        'History refresh failed · showing last loaded data through ' + formatDate(feature.end * 1000);
    renderFeature();
  }
  let detailMarket = null,
    detailController;
  const detailDialog = $('detail-dialog');
  function detailStat(name, value, color = '') {
    return '<div class="detail-stat"><span>' + esc(name) + '</span><strong class="' + color + '">' + esc(value) + '</strong></div>';
  }
  function clearDetail() {
    detailController?.abort();
    const host = $('detail-chart');
    if (host) window.ElectionChart.clear(host);
    detailMarket = null;
  }
  async function detailHistory(days) {
    detailController?.abort();
    const controller = new AbortController();
    detailController = controller;
    const market = detailMarket;
    if (!market) return;
    rangeButtons($('detail-ranges'), days, detailHistory);
    const host = $('detail-chart');
    window.ElectionChart.clear(host);
    host.innerHTML = '<p class="chart-msg">Loading exchange prices…</p>';
    const finalDate = Date.parse(market.settledAt || market.closeAt);
    const end =
      page === 'overview'
        ? nowSec()
        : Math.min(nowSec(), Number.isFinite(finalDate) ? Math.floor(finalDate / 1000) : nowSec());
    const start = end - days * DAY;
    $('detail-note').textContent = 'Requesting ' + sourceName(market.source) + ' price history.';
    try {
      const points = await adapters[market.source].history(market, { start, end, signal: controller.signal });
      if (controller.signal.aborted) return;
      window.ElectionChart.draw(host, {
        series: [{ name: market.label || 'Yes', color: 'var(--plot-series-1)', points }],
        start,
        end,
        dark: false,
      });
      $('detail-note').textContent =
        points.length +
        ' observed prices · ' +
        formatDate(start * 1000) +
        ' – ' +
        formatDate(end * 1000) +
        ' (UTC)';
    } catch (e) {
      if (controller.signal.aborted) return;
      host.innerHTML = '<p class="chart-msg">Price history could not be loaded.</p>';
      $('detail-note').textContent =
        sourceName(market.source) + ': ' + shortError(e) + '. Select a period to retry.';
    }
  }
  function openDetail(m) {
    clearDetail();
    detailMarket = m;
    const settled = m.outcome === 0 || m.outcome === 1;
    const settlement = window.ElectionSettlement.dateFor(m, modeForPage());
    const safeURL =
      (m.source === 'kalshi' && m.url?.startsWith('https://kalshi.com/')) ||
      (m.source === 'polymarket' && m.url?.startsWith('https://polymarket.com/'));
    const priceLabel = m.source === 'kalshi' ? 'Last Yes trade' : 'Yes price';
    const stats = [
      detailStat(
        settled ? 'Settlement' : priceLabel,
        settled ? (m.outcome ? 'Yes · $1' : 'No · $0') : cents(m.price),
        settled ? (m.outcome ? 'outcome-yes' : 'outcome-no') : isNumeric(m.price) ? 'outcome-yes' : '',
      ),
      detailStat('Lifetime volume', volumeText(m)),
      detailStat(
        settlement ? window.ElectionSettlement.labelFor(m, settlement) + ' (UTC)' : 'Settlement date (UTC)',
        settlement ? formatDate(settlement.ms) : 'Unlisted',
      ),
      detailStat(
        settled ? 'Opened (UTC)' : 'Yes bid / ask',
        settled ? formatDate(m.openedAt || m.openAt) : cents(m.yesBid) + ' / ' + cents(m.yesAsk),
      ),
    ].join('');
    const listing = data[modeForPage()][m.source];
    const quoteTime = liveTimes.get(m) || (listing.markets.includes(m) ? listing.at : sourceSnap[m.source].asOf);
    const closeTime = m.settlementBasis === 'resolved-close' ? m.settledAt : m.closeAt;
    const metadata = [
      closeTime && 'Trading close ' + formatDate(closeTime) + ' UTC',
      quoteTime && 'Listing as of ' + asOf(quoteTime),
    ]
      .filter(Boolean)
      .join(' · ');
    const exchangeLink = safeURL
      ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">View on ${esc(sourceName(m.source))} ${icon('out')}</a>`
      : '<span></span>';
    const addButton =
      (settled && m.settledAt) || page === 'overview'
        ? `<button class="btn-primary" id="add-test">${icon('backtest')} Add to backtest</button>`
        : '';
    $('detail-content').innerHTML = `
      ${sourceTag(m.source)}
      <h2 class="detail-title" id="contract-title">${esc(m.title)}</h2>
      <p class="detail-subtitle">${esc(m.eventTitle)}</p>
      <div class="detail-stats">${stats}</div>
      <p class="detail-quote-time">${esc(metadata)}</p>
      <div class="detail-panel">
        <div class="plot-head">
          <h3>Yes price history</h3>
          <div class="range" id="detail-ranges" aria-label="Contract chart period"></div>
        </div>
        <div id="detail-chart" class="plot-host" role="group" aria-label="Historical Yes prices"></div>
        <p class="detail-caption" id="detail-note" aria-live="polite"></p>
      </div>
      <div class="detail-footer">${exchangeLink}${addButton}${addButton ? '<button type="button" class="text-button" id="add-trading-test">Add to time-frame trading</button>' : ''}</div>`;
    detailDialog.setAttribute('aria-labelledby', 'contract-title');
    if (!detailDialog.open) detailDialog.showModal();
    if ($('add-test'))
      $('add-test').onclick = () => {
        window.ElectionTestUI.add(m, settled ? 'archive' : 'live');
        detailDialog.close();
        location.hash = 'backtest';
      };
    if ($('add-trading-test')) $('add-trading-test').onclick = () => {
      tradingUI.addMarket(m);
      detailDialog.close();
      location.hash = 'backtest-trading';
    };
    detailHistory(90);
  }

  const pages = {
    overview: ['Election atlas', ''],
    archive: [
      'Election archive',
      'Explore closed election contracts, settlement outcomes and historical prices.',
    ],
    backtest: [
      'Historical backtest',
      'Test multiple election strategies together and compare their results.',
    ],
  };
  function navigate() {
    const target = location.hash.slice(1);
    const trading = target === 'backtest-trading';
    const nextPage = trading ? 'backtest' : Object.hasOwn(pages, target) ? target : 'overview';
    if (page === nextPage && (page !== 'backtest' || trading === !$('trading-replay').hidden)) return;
    if (page === 'backtest') {
      if ($('trading-replay').hidden) window.ElectionTestUI.leave();
      else tradingUI.leave();
    }
    $('trading-replay').hidden = !trading;
    $('portfolio-replay').hidden = trading;
    for (const [id, active] of [['section-portfolio', !trading], ['section-trading', trading]]) {
      if (active) $(id).setAttribute('aria-current', 'page');
      else $(id).removeAttribute('aria-current');
    }
    page = nextPage;
    document.body.dataset.page = page;
    $('atlas-map').inert = page !== 'overview';
    $('atlas-map').setAttribute('aria-hidden', String(page !== 'overview'));
    countryFilter = null;
    resetBoardOrder();
    source = 'all';
    query = '';
    $('search').value = '';
    $('route-intro').hidden = page === 'overview';
    $('page-title').textContent = page === 'overview' ? '' : pages[page][0];
    document.title = pages[page][0];
    $('page-description').textContent = trading ? 'Replay buy and sell rules over a selected date range.' : pages[page][1];
    document.querySelectorAll('#main-nav a').forEach((a) => {
      if (a.dataset.page === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('board-view').hidden = page === 'backtest';
    $('backtest-view').hidden = page !== 'backtest';
    $('feature').hidden = page !== 'overview' || !featureMarkets.length;
    $('atlas').hidden = page !== 'overview';
    $('live-options').hidden = page !== 'overview';
    $('explorer-title').textContent = page === 'overview' ? 'Market explorer' : 'Historical markets';
    const badge = $('mode-badge');
    badge.classList.toggle('archive', page !== 'overview');
    badge.innerHTML = '<b></b>' + (page === 'overview' ? 'Active' : 'Closed');
    if (page === 'overview') {
      renderFeature();
      updateViews();
    } else if (page === 'backtest') {
      if (trading) tradingUI.enter();
      updateViews();
    } else {
      const mode = modeForPage();
      const needed = venues.filter((key) => !data[mode][key].fetched && !data[mode][key].busy);
      if (needed.length) loadCatalog(mode, needed);
      else updateViews();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function filterByCountry(id) {
    countryFilter = id;
    source = 'all';
    query = '';
    resetBoardOrder();
    $('search').value = '';
    updateViews();
    const explorer = $('explorer-title');
    explorer.setAttribute('tabindex', '-1');
    explorer.focus({ preventScroll: true });
    explorer.closest('.explorer').scrollIntoView({ block: 'start' });
  }
  $('country-filter').onclick = () => {
    countryFilter = null;
    resetBoardOrder();
    renderBoard();
    $('search').focus({ preventScroll: true });
  };
  $('venue-filters').innerHTML = ['all', ...venues]
    .map(
      (k) =>
        '<button type="button" data-source="' +
        k +
        '" aria-pressed="' +
        (k === 'all') +
        '">' +
        (k === 'all' ? icon('all') + 'All exchanges' : sourceLabel(k)) +
        '</button>',
    )
    .join('');
  $('venue-filters').onclick = (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    source = button.dataset.source;
    resetBoardOrder();
    const mode = modeForPage();
    if (mode === 'live') {
      updateViews();
      return;
    }
    const needed = sourcesFor(source).filter((key) => !data[mode][key].fetched);
    if (needed.length) loadCatalog(mode, needed);
    else updateViews();
  };
  $('search').oninput = (e) => {
    query = e.target.value;
    resetBoardOrder();
    renderBoard();
  };
  $('feature-legend').onclick = (event) => {
    const button = event.target.closest('button[data-candidate]');
    if (!button) return;
    const saved = featureMarkets[Number(button.dataset.candidate)];
    const listing = data.live.polymarket.markets.find((market) => market.id === saved.id);
    openDetail(listing || saved);
  };
  $('market-rows').onclick = (e) => {
    const row = e.target.closest('tr[data-row]');
    if (row) openDetail(currentRows[Number(row.dataset.row)]);
  };
  $('market-head').onclick = (event) => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    const direction = boardSort.key === key ? -boardSort.direction : ['name', 'source'].includes(key) ? 1 : -1;
    boardSort = { key, direction };
    pageNo = 0;
    renderBoard();
  };
  $('previous').onclick = () => {
    if (pageNo > 0) pageNo--;
    renderBoard(true);
  };
  $('next').onclick = () => {
    pageNo++;
    renderBoard(true);
  };
  $('fetch-more').onclick = () => {
    if (page === 'overview') {
      $('live-options').open = true;
      (liveForm.busy ? $('live-fetch-cancel') : $('live-fetch-count')).focus();
    } else loadCatalog('archive', sourcesFor(source), true);
  };
  $('show-live-library').onclick = () => {
    liveView = null;
    resetBoardOrder();
    liveProgress('Showing all loaded live contracts.');
    updateViews();
  };
  $('refresh-button').onclick = () => {
    if (page === 'backtest') {
      if (!$('trading-replay').hidden) {
        $('tw-discovery').scrollIntoView({ block: 'center' });
        $('tw-query').focus({ preventScroll: true });
        return;
      }
      $('contract-fetch').scrollIntoView({ block: 'center' });
      ($('fetch-count').disabled ? $('fetch-cancel') : $('fetch-count')).focus({ preventScroll: true });
      return;
    }
    if (page === 'overview') liveAction();
    else loadCatalog('archive', sourcesFor(source));
  };
  $('sources-button').onclick = $('footer-sources').onclick = () => $('source-dialog').showModal();
  $('explorer-scope-toggle').onclick = (event) => {
    const note = $('explorer-scope');
    note.hidden = !note.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!note.hidden));
  };
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.querySelector('.close-dialog').onclick = () => dialog.close();
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  });
  detailDialog.addEventListener('close', clearDetail);
  $('snapshot-dates').textContent = venues
    .map(
      (key) =>
        sourceName(key) +
        ' opening snapshot · ' +
        formatDate(sourceSnap[key].asOf) +
        ' ' +
        (sourceSnap[key].asOf || '').slice(11, 16) +
        ' UTC',
    )
    .join('  /  ');
  $('source-dialog').setAttribute('aria-label', 'Data sources and methodology');
  liveForm = window.ElectionContractFetch.create($('live-fetch'), {
    catalog: true,
    onStart() {
      liveSearchStarted = true;
      if (page === 'overview') resetBoardOrder();
      liveScan = { rows: { kalshi: [], polymarket: [] }, hasRows: false, started: Date.now() };
    },
    onPage: receiveLivePage,
    onStatus: liveProgress,
    apply: applyLive,
    onBusyChange() {
      if (!liveForm.busy) {
        clearTimeout(livePaintTimer);
        livePaintTimer = null;
        liveScan = null;
      }
      if (page === 'overview' || (page === 'backtest' && modeForPage() === 'live')) updateViews();
    },
  });
  liveForm.setContext('live');
  window.ElectionTestUI.init({
    getMarkets: (mode = 'archive') => orderedMarkets(mode),
    catalogTime: (mode, key, market) => Date.parse(liveTimes.get(market) || data[mode][key].at) || 0,
    fullLiveScanTime: (key) => data.live[key]?.completeStarted || 0,
    changeMode: () => { if (page === 'backtest') updateViews(); },
    history: (m, options) => adapters[m.source].history(m, options),
    sourceName,
    formatDate,
    esc,
    sourceTag,
  });
  const tradingUI = window.ElectionTradingUI.create({
    history: (m, options) => adapters[m.source].history(m, options),
    formatDate, esc, sourceTag, sourceName,
  });
  window.addEventListener('hashchange', navigate);
  navigate();
  restoreLive();
})();

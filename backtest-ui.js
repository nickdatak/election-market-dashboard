(() => {
  'use strict';

  const DEFAULT_COUNT = 6;
  const DAY = 86400;
  const $ = (id) => document.getElementById(id);
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const feeText = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 5 }).format;
  const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });
  const cents = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const keyFor = (market) => market.source + ':' + market.id;
  const today = () => new Date().toISOString().slice(0, 10);
  const signedMoney = (n) => (n >= 0.005 ? '+' : '') + dollars.format(Math.abs(n) < 0.005 ? 0 : n);
  const returnText = (n) => percent.format(Math.abs(n) < 0.00005 ? 0 : n);
  const valueClass = (n, resolution = 0.01) =>
    !Number.isFinite(n) || Math.abs(n) < resolution / 2 ? '' : n > 0 ? 'positive' : 'negative';
  const describe = (n, noun) => n + ' ' + noun + (n === 1 ? '' : 's');

  // Market assignments are independent for each strategy and each replay mode.
  const books = { archive: new Map(), live: new Map() };
  const batches = { archive: null, live: null };
  const sharedAssignments = { archive: null, live: null };
  const fetchedMarkets = { archive: new Map(), live: new Map() };
  const showAll = { archive: new Set(), live: new Set() };
  const defaultsApplied = { archive: false, live: false };
  let api, editor, firstStrategyId, pickerSettlement, fetchForm;
  let mode = 'archive',
    activeRun = null,
    hasResult = false;
  let catalog = new Map();
  let shownMarkets = [];
  const pageSize = 100;
  let pickerPage = 0;
  let catalogState = { busy: false, message: '' };

  function isBatch() {
    const id = editor.activeId();
    return batches[mode] !== null && !showAll[mode].has(id);
  }

  function assignments(id = editor.activeId(), forMode = mode) {
    const book = books[forMode];
    if (!book.has(id)) book.set(id, new Map());
    return book.get(id);
  }
  function eligible(market, forMode = mode) {
    return window.ElectionDiscovery.eligible(market, forMode);
  }
  function updateCounts() {
    const strategies = editor.list();
    const counts = new Map();
    const unique = new Set();
    for (const strategy of strategies) {
      const markets = assignments(strategy.id);
      counts.set(strategy.id, markets.size);
      for (const key of markets.keys()) unique.add(key);
    }
    editor.setCounts(counts);
    const active = strategies.find((s) => s.id === editor.activeId());
    $('selection-count').textContent = assignments().size + ' selected';
    $('selection-description').innerHTML =
      'Choose contracts for <strong>' + api.esc(active.name || 'this strategy') + '</strong>.';
    fetchForm.setContext(mode);
    $('portfolio-count').textContent =
      strategies.length +
      (strategies.length === 1 ? ' strategy' : ' strategies') +
      ' · ' +
      describe(unique.size, 'contract');
    $('clear-selection').disabled = !assignments().size;
    $('assign-shown').disabled = !shownMarkets.some((market) => !assignments().has(keyFor(market)));
    $('cancel-run').hidden = !activeRun;
    const button = $('run-button');
    fetchForm.setRunBusy(Boolean(activeRun));
    button.disabled = activeRun !== null || fetchForm.busy || !unique.size;
    button.lastElementChild.textContent = activeRun ? 'Running strategies…' : 'Run all strategies';
  }
  function prompt(message) {
    $('test-output').innerHTML = '<p class="result-readout">' + api.esc(message) + '</p>';
  }
  function invalidate() {
    if (activeRun || hasResult) prompt('The portfolio changed. Run the backtest again for updated results.');
    activeRun?.abort();
    activeRun = null;
    hasResult = false;
  }
  function chooseDefaults() {
    // Seed only the original strategy. Newly added strategies have explicit assignments.
    if (!editor.list().some((s) => s.id === firstStrategyId)) return;
    const target = assignments(firstStrategyId);
    const venues = new Map();
    for (const market of catalog.values()) {
      if (!venues.has(market.source)) venues.set(market.source, []);
      venues.get(market.source).push(market);
    }
    const queues = [...venues.values()].map((rows) => {
      rows.sort((a, b) => (b.volume || 0) - (a.volume || 0));
      const seen = new Set(),
        first = [],
        others = [];
      for (const m of rows) {
        const event = m.eventTitle || m.title;
        (seen.has(event) ? others : first).push(m);
        seen.add(event);
      }
      return first.concat(others);
    });
    for (let i = 0; target.size < DEFAULT_COUNT && queues.some((q) => q[i]); i++) {
      for (const q of queues) if (q[i] && target.size < DEFAULT_COUNT) target.set(keyFor(q[i]), q[i]);
    }
    if (target.size) defaultsApplied[mode] = true;
  }
  function renderCatalog(resetScroll = false) {
    if (resetScroll) pickerPage = 0;
    const list = $('contract-list');
    const scroll = resetScroll ? 0 : list.scrollTop;
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const selected = assignments();
    const merged = new Map(catalog);
    const restricted = isBatch();
    const assignedElsewhere = new Map();
    for (const strategy of editor.list()) {
      for (const [key, market] of assignments(strategy.id)) {
        if (!restricted && !merged.has(key)) merged.set(key, market);
        if (strategy.id === editor.activeId()) continue;
        if (!assignedElsewhere.has(key)) assignedElsewhere.set(key, []);
        assignedElsewhere.get(key).push(strategy.name || 'Untitled strategy');
      }
    }
    const source = $('test-source').value;
    const query = $('test-search').value.trim().toLowerCase();
    const filtered = [...merged.values()].filter(
      (m) =>
        (source === 'all' || source === m.source) &&
        pickerSettlement.matches(m) &&
        [m.title, m.eventTitle, m.label, m.id, m.source].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(query),
        ),
    );
    filtered.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || keyFor(a).localeCompare(keyFor(b)));
    shownMarkets = filtered;
    const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
    pickerPage = Math.min(pickerPage, lastPage);
    const start = pickerPage * pageSize;
    const visibleRows = filtered.slice(start, start + pageSize);
    $('picker-pages').hidden = lastPage === 0;
    $('picker-prev').disabled = pickerPage === 0;
    $('picker-next').disabled = pickerPage === lastPage;
    $('picker-range').textContent = (start + 1) + '–' + (start + visibleRows.length) + ' of ' + filtered.length;
    $('assign-shown').textContent = lastPage ? 'Select all matching' : 'Select all shown';
    list.innerHTML = visibleRows
      .map((m) => {
        const key = keyFor(m),
          checked = selected.has(key),
          others = assignedElsewhere.get(key);
        const settlement = window.ElectionSettlement.dateFor(m, mode);
        let date = settlement
          ? window.ElectionSettlement.labelFor(m, settlement) + ' ' + api.formatDate(settlement.ms)
          : 'Settlement date unlisted';
        if (restricted && mode === 'archive' && m.settlementBasis === 'resolved-close')
          date = 'Recorded close ' + api.formatDate(m.settledAt) + ' · ' + date;
        if (restricted && (m.discoveryListedAt || m.listedAt)) {
          const listed = m.discoveryListedAt ? 'Election listed ' : 'Contract listed ';
          date = listed + api.formatDate(m.discoveryListedAt || m.listedAt) + ' · ' + date;
        }
        const close = mode === 'live' && m.closeAt ? ' · Closes ' + api.formatDate(m.closeAt) : '';
        const volume = m.volume == null ? 'Volume unlisted' : 'Volume ' +
          (m.source === 'polymarket' ? '$' + cents.format(m.volume) : cents.format(m.volume) + ' contracts');
        const shared = others?.length
          ? ' · Also in ' + others[0] + (others.length > 1 ? ' +' + (others.length - 1) : '')
          : '';
        return `<label class="contract-choice">
        <input type="checkbox" data-key="${api.esc(key)}" ${checked ? 'checked' : ''}>
        <span class="choice-title">${api.esc(m.title)}<span class="market-sub">${api.esc(volume + ' · ' + date + close + shared)}</span></span>
        ${api.sourceTag(m.source)}
      </label>`;
      })
      .join('');
    if (!filtered.length) {
      const text = merged.size
        ? 'No contracts match these filters.'
        : !isBatch() && catalogState.busy
          ? 'Loading election contracts…'
          : isBatch() ? 'This fetch returned no matching contracts.' : 'Fetch contracts above to build your selection.';
      list.innerHTML = '<p class="empty">' + text + '</p>';
    }
    if (focusKey)
      [...list.querySelectorAll('input')]
        .find((el) => el.dataset.key === focusKey)
        ?.focus({ preventScroll: true });
    list.scrollTop = scroll;
    $('use-loaded').hidden = !isBatch();
    const shown =
      filtered.length === merged.size
        ? describe(merged.size, 'eligible contract') + '.'
        : filtered.length + ' of ' + merged.size + ' shown.';
    const hiddenSelected = selected.size - filtered.filter((m) => selected.has(keyFor(m))).length;
    const hiddenNote = hiddenSelected ? hiddenSelected + ' selected outside these filters.' : '';
    $('test-catalog-status').textContent = [shown, hiddenNote, restricted ? '' : catalogState.message]
      .filter(Boolean)
      .join(' ');
    updateCounts();
  }
  function update(state) {
    catalogState = { ...catalogState, ...state };
    const all = new Map(api.getMarkets(mode).map((market) => [keyFor(market), market]));
    for (const [key, { market, fetchedAt }] of fetchedMarkets[mode]) {
      if (!all.has(key) && mode === 'live' && api.fullLiveScanTime?.(market.source) >= fetchedAt) continue;
      if (!all.has(key) || !(api.catalogTime?.(mode, market.source, all.get(key)) > fetchedAt)) all.set(key, market);
    }
    if (mode === 'live') {
      for (const set of books.live.values()) {
        for (const [key, market] of set) {
          if (!all.has(key) && api.fullLiveScanTime?.(market.source)) {
            set.delete(key);
            invalidate();
          }
        }
      }
    }
    const available = isBatch() ? batches[mode].map((key) => all.get(key)) : [...all.values()];
    catalog = new Map(available.filter((m) => eligible(m)).map((m) => [keyFor(m), m]));
    const fields = ['outcome', 'settledAt', 'settlementBasis', 'closeAt', 'tradingClosedAt', 'tokenId', 'seriesTicker', 'feeRate', 'feeMultiplier', 'feesEnabled', 'feeWaiverUntil'];
    for (const m of all.values()) {
      const key = keyFor(m);
      for (const set of books[mode].values()) {
        const prior = set.get(key);
        if (!prior || prior === m) continue;
        if (!eligible(m)) {
          set.delete(key);
          invalidate();
        } else {
          if (fields.some((f) => prior[f] !== m[f])) invalidate();
          set.set(key, m);
        }
      }
    }
    if (editor.activeId() === firstStrategyId && !defaultsApplied[mode] && !catalogState.busy && !$('backtest-view').hidden) chooseDefaults();
    renderCatalog();
  }
  function applyFetch(markets, replace) {
    pickerPage = 0;
    const fetchedAt = Date.now();
    for (const market of markets) fetchedMarkets[mode].set(keyFor(market), { market, fetchedAt });
    batches[mode] = markets.map(keyFor);
    showAll[mode].clear();
    defaultsApplied[mode] = true;
    if (replace) {
      invalidate();
      sharedAssignments[mode] = new Map(markets.map((market) => [keyFor(market), market]));
      for (const { id } of editor.list()) books[mode].set(id, new Map(sharedAssignments[mode]));
    }
    $('test-search').value = '';
    $('test-source').value = 'all';
    pickerSettlement.clear();
    update();
    $('contract-list').scrollTop = 0;
  }
  function modeCopy() {
    const live = mode === 'live';
    pickerSettlement.setMode(mode);
    $('test-date-field').hidden = !live;
    $('test-asof').disabled = !live;
    $('test-asof').max = today();
    const horizon = live
      ? 'Each active contract uses up to 90 days ending on the UTC replay date. A position still open at the cutoff uses its latest observed price on a UTC day after entry.'
      : 'Each contract uses up to 90 days before settlement. Polymarket uses its reported resolution time or the last update of a final oracle record. If both are missing, the replay uses the recorded close. Settlement-date filters require a reported or final oracle date. A winning share pays $1.';
    $('method-text').textContent = horizon;
    $('test-search').placeholder = live ? 'Find an active contract' : 'Find a settled contract';
    $('test-search').setAttribute('aria-label', $('test-search').placeholder);
  }
  function switchMode(next) {
    if (next === mode || !Object.hasOwn(books, next)) return;
    invalidate();
    mode = next;
    pickerPage = 0;
    $('test-mode').value = mode;
    $('test-search').value = '';
    $('test-source').value = 'all';
    catalog = new Map();
    catalogState = { busy: false, message: '' };
    modeCopy();
    prompt('Run the backtest to compare strategies and inspect their trades.');
    renderCatalog(true);
    api.changeMode(mode);
  }
  function add(market, forMode = 'archive') {
    if (!Object.hasOwn(books, forMode) || !eligible(market, forMode)) return false;
    if (editor.activeId() === firstStrategyId) defaultsApplied[forMode] = true;
    switchMode(forMode);
    const key = keyFor(market),
      selected = assignments();
    if (isBatch() && !catalog.has(key)) showAll[mode].add(editor.activeId());
    if (!selected.has(key)) {
      selected.set(key, market);
      invalidate();
    }
    update();
    return true;
  }
  function selectionChanged(event) {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    const selected = assignments();
    if (editor.activeId() === firstStrategyId) defaultsApplied[mode] = true;
    const key = checkbox.dataset.key;
    if (checkbox.checked) {
      let m = catalog.get(key);
      if (!m)
        for (const group of books[mode].values()) {
          if (group.has(key)) {
            m = group.get(key);
            break;
          }
        }
      if (m) selected.set(key, m);
    } else selected.delete(key);
    invalidate();
    if (!catalog.has(key)) {
      renderCatalog();
    } else {
      updateCounts();
    }
  }
  function strategyChanged({ kind, id }) {
    invalidate();
    if (kind === 'add') {
      for (const replay of ['archive', 'live']) {
        if (sharedAssignments[replay]) books[replay].set(id, new Map(sharedAssignments[replay]));
      }
    }
    if (kind === 'remove') {
      books.archive.delete(id);
      books.live.delete(id);
      for (const mode of ['live', 'archive']) {
        showAll[mode].delete(id);
      }
    }
    if (kind === 'edit') updateCounts();
    else {
      update();
      $('contract-list').scrollTop = 0;
    }
  }

  const changeLabels = {
    priceAtLeast: 'price ≥',
    priceAtMost: 'price ≤',
    risesBy: 'daily rise ≥',
    fallsBy: 'daily fall ≥',
    crossesAbove: 'crosses up through',
    crossesBelow: 'crosses down through',
    gainFromEntry: 'gain from entry ≥',
    lossFromEntry: 'loss from entry ≥',
  };
  function buyLabel(side) {
    return side === 'no'
      ? '<span class="outcome-no">Buy No</span>'
      : '<span class="outcome-yes">Buy Yes</span>';
  }
  function describeConditions(conditions, match) {
    return conditions.map((c) => {
      const move = ['risesBy', 'fallsBy', 'gainFromEntry', 'lossFromEntry'].includes(c.type);
      return changeLabels[c.type] + ' ' + (move ? cents.format(c.value * 100) + ' pp' : percent.format(c.value));
    }).join(match === 'all' ? ' AND ' : ' OR ');
  }
  function describeRule(strategy, live) {
    const exit = strategy.exitConditions.length
      ? 'Sell when ' + describeConditions(strategy.exitConditions, strategy.exitMatch)
      : live ? 'Hold through replay cutoff' : 'Hold to settlement';
    return buyLabel(strategy.side) + ' · ' + dollars.format(strategy.stake) + ' per trade · ' +
      api.esc(describeConditions(strategy.conditions, strategy.match)) + '<br>' + api.esc(exit);
  }
  function comparison(result, plans, failures) {
    const rows = result.strategies
      .map((s, i) => {
        const t = s.totals,
          plan = plans[i],
          failed = plan.markets.filter((m) => failures.has(keyFor(m))).length;
        const unavailable = plan.markets.length > 0 && failed === plan.markets.length;
        const count = plan.markets.length;
        return `<tr data-strategy-id="${api.esc(s.id)}">
        <td><span class="strategy-result-name">${api.esc(s.name)}</span><div class="rule-summary">${describeRule(s, result.settings.mode === 'live')}</div></td>
        <td>${count}${failed ? `<span class="market-sub">${failed} unavailable</span>` : ''}</td><td>${t.count}</td>
        <td>${dollars.format(t.staked)}</td><td>${feeText(t.fees)}</td><td class="${valueClass(t.profit)}">${unavailable ? '—' : signedMoney(t.profit)}</td>
        <td class="${valueClass(t.roi, 0.0001)}">${t.roi === null ? '—' : returnText(t.roi)}</td></tr>`;
      })
      .join('');
    return `<h3 class="result-subtitle">Strategy comparison</h3><div class="table-scroll">
      <table id="strategy-comparison" class="result-table strategy-comparison"><thead><tr><th>Strategy</th><th>Assigned</th><th>Trades</th><th>Staked</th><th>Fees</th><th>Net P&amp;L</th><th>Return</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  function valuationCell(t, live) {
    if (t.status === 'sold') {
      return `<td><strong>Sold · ${cents.format(t.exitPrice * 100)}¢</strong><span class="market-sub">${api.esc(api.formatDate(t.exitedAt))}</span>
        <span class="market-sub">Signal ${cents.format(t.exitSignalPrice * 100)}¢ · ${api.esc(api.formatDate(t.exitSignalAt))}</span>
        <span class="market-sub">${api.esc(describeConditions(t.exitTriggers, 'all'))}</span></td>`;
    }
    if (live) {
      const age = t.staleDays ? ' · ' + describe(t.staleDays, 'day') + ' before cutoff' : '';
      return `<td><span class="number">Open · ${cents.format(t.markPrice * 100)}¢</span><span class="market-sub">${api.esc(api.formatDate(t.markedAt) + age)}</span></td>`;
    }
    const dateLabel = t.settlementBasis === 'resolved-close' ? 'Market close · ' : t.settlementBasis === 'oracle-final' ? 'Oracle finalized · ' : '';
    return `<td>Settled <span class="result-pill ${t.outcome ? 'outcome-yes' : 'no outcome-no'}">${t.outcome ? 'Yes' : 'No'}</span>
      <span class="market-sub">${api.esc(dateLabel + api.formatDate(t.settledAt))}</span></td>`;
  }
  function tradeLedger(trades, live) {
    if (!trades.length)
      return '<p class="no-trades">No simulated trades met the entry rules with the available data.</p>';
    const rows = trades
      .map(
        (t) => `<tr>
      <td class="trade-identity">${api.esc(t.strategyName)}<span class="market-sub">${buyLabel(t.side)} · ${dollars.format(t.stake)}</span></td>
      <td>${api.esc(t.title)}<span class="market-sub">${api.esc(api.sourceName(t.source))}</span></td>
      <td class="nowrap">${api.esc(api.formatDate(t.enteredAt))}<span class="market-sub">${cents.format(t.entryPrice * 100)}¢</span></td>
      ${valuationCell(t, live)}<td class="number">${feeText(t.fee)}${t.status === 'sold' ? `<span class="market-sub">Buy ${feeText(t.entryFee)} · Sell ${feeText(t.exitFee)}</span>` : ''}</td><td class="number">${dollars.format(t.proceeds ?? t.markedValue ?? t.payout)}</td>
      <td class="number ${valueClass(t.profit)}">${signedMoney(t.profit)}</td>
      <td class="number ${valueClass(t.profit / (t.stake + t.entryFee), 0.0001)}">${returnText(t.profit / (t.stake + t.entryFee))}</td></tr>`,
      )
      .join('');
    return `<h3 class="result-subtitle">Trade ledger</h3><div class="table-scroll"><table class="result-table" id="trade-ledger">
      <thead><tr><th>Strategy / side</th><th>Contract</th><th>Entry</th><th>${live ? 'Exit or mark' : 'Exit or settlement'}</th><th>Fees</th><th>Gross value</th><th>Net P&amp;L</th><th>Return</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function details(title, rows) {
    if (!rows.length) return '';
    const body = rows
      .map(
        (m) =>
          `<li><strong>${api.esc(m.title)}</strong> · ${api.esc(api.sourceName(m.source))} · ${api.esc(m.strategyName)} · ${api.esc(m.reason)}</li>`,
      )
      .join('');
    return `<details class="skip-detail"><summary>${title} (${rows.length})</summary><ul>${body}</ul></details>`;
  }
  function showResults(result, plans, failures, uniqueCount) {
    const t = result.totals,
      live = result.settings.mode === 'live';
    const noData = failures.size === uniqueCount;
    const rate = live ? t.positiveRate : t.winRate;
    const metrics = [
      [live && !t.soldCount ? 'Marked P&L' : 'Net P&L', noData ? '—' : signedMoney(t.profit), valueClass(t.profit)],
      ['Return on entry cost', t.roi === null ? '—' : returnText(t.roi), valueClass(t.roi, 0.0001)],
      [live ? 'Positive trades' : 'Win rate', rate === null ? '—' : percent.format(rate), ''],
      ['Amount staked', dollars.format(t.staked), ''],
    ];
    const valuation = live
      ? 'Active replay through ' + api.formatDate(result.settings.asOf) + ' UTC.'
      : 'Settled contract replay.';
    const failed = failures.size ? ' ' + describe(failures.size, 'price request') + ' failed.' : '';
    const assigned = plans.reduce((count, plan) => count + plan.markets.length, 0);
    const scope =
      assigned === uniqueCount
        ? describe(uniqueCount, 'contract')
        : describe(assigned, 'assignment') + ' across ' + describe(uniqueCount, 'contract');
    const readout = `${valuation} ${scope} · ${describe(t.count, 'trade')} · ${t.soldCount} sold by rule · ${t.count - t.soldCount} ${live ? 'marked open' : 'held to settlement'} · ${result.skipped.length} skipped.${failed}`;
    const failureRows = [...failures].map(([key, m]) => ({
      ...m,
      strategyName: plans
        .filter((p) => p.markets.some((m) => keyFor(m) === key))
        .map((s) => s.name)
        .join(', '),
    }));
    $('test-output').innerHTML = `<p class="result-readout">${api.esc(readout)}</p>
      <div class="metric-grid">${metrics.map(([label, value, cls]) => `<div class="metric"><span>${api.esc(label)}</span><strong class="${cls}">${api.esc(value)}</strong></div>`).join('')}</div>
      <p class="portfolio-exposure">Trading fees <strong>${feeText(t.fees)}</strong> · Peak open stake <strong>${dollars.format(t.peakOpenStake)}</strong> · Maximum simultaneous positions <strong>${t.maxConcurrent}</strong></p>
      ${t.count ? '<div id="performance-charts"></div>' : ''}
      ${comparison(result, plans, failures)}${tradeLedger(result.trades, live)}
      ${details('Skipped assignments', result.skipped)}${details('Price requests that failed', failureRows)}`;
    if (t.count) {
      window.ElectionBacktestCharts?.draw($('performance-charts'), result, { signedMoney, returnText, valueClass });
    }
  }
  async function run(event) {
    event.preventDefault();
    $('test-asof').max = today();
    if (activeRun || fetchForm.busy || !editor.validate() || !$('strategy-form').reportValidity()) return;
    const plans = editor
      .list()
      .map((strategy) => ({ ...strategy, markets: [...assignments(strategy.id).values()] }));
    const unique = new Map();
    for (const plan of plans) for (const market of plan.markets) unique.set(keyFor(market), market);
    const marketSet = [...unique.values()].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
    if (!marketSet.length) return;
    const settings = { mode, fees: $('test-fees').checked };
    if (mode === 'live') {
      const date = $('test-asof').value || today();
      settings.asOf = Math.min(Date.parse(date + 'T23:59:59.999Z'), Date.now());
    }
    const controller = new AbortController();
    activeRun = controller;
    hasResult = false;
    updateCounts();
    const samples = new Map(),
      failures = new Map();
    const progress = () =>
      prompt(
        'Loading shared daily prices · ' +
          (samples.size + failures.size) +
          ' of ' +
          marketSet.length +
          ' contracts for ' + plans.length + (plans.length === 1 ? ' strategy' : ' strategies') + '.',
      );
    progress();
    try {
      for (const market of marketSet) {
        if (controller.signal.aborted) return;
        try {
          const cutoff =
            settings.mode === 'live' ? settings.asOf / 1000 : new Date(market.settledAt).getTime() / 1000;
          const marketEnd = market.tradingClosedAt || (settings.mode === 'archive' ? market.closeAt : null);
          const close = marketEnd ? new Date(marketEnd).getTime() / 1000 : cutoff;
          const start = Math.floor(cutoff - 90 * DAY);
          const end = Math.floor(Number.isFinite(close) ? Math.min(close, cutoff) : cutoff);
          const history =
            start < end
              ? await api.history(market, { start, end, daily: true, signal: controller.signal })
              : [];
          if (!Array.isArray(history)) throw new Error('The exchange returned an unreadable price series.');
          samples.set(keyFor(market), { ...market, history });
        } catch (error) {
          if (controller.signal.aborted) return;
          failures.set(keyFor(market), {
            ...market,
            reason: error?.message || 'The exchange request failed.',
          });
        }
        if (controller.signal.aborted) return;
        progress();
      }
      if (controller.signal.aborted) return;
      const hydrated = plans.map((plan) => ({
        ...plan,
        markets: plan.markets.map((m) => samples.get(keyFor(m))).filter(Boolean),
      }));
      const result = window.ElectionBacktest.runStrategies(hydrated, settings);
      showResults(result, plans, failures, unique.size);
      hasResult = true;
      const resultsPanel = $('results');
      if (!$('backtest-view').hidden && resultsPanel.getBoundingClientRect().top > window.innerHeight * 0.8) {
        resultsPanel.scrollIntoView({ block: 'start' });
      }
    } catch (error) {
      if (!controller.signal.aborted)
        prompt(error?.message || 'The portfolio simulation could not be calculated.');
    } finally {
      if (activeRun === controller) {
        activeRun = null;
        updateCounts();
      }
    }
  }

  function init(dependencies) {
    api = dependencies;
    fetchForm = window.ElectionContractFetch.create($('contract-fetch'), { apply: applyFetch, onBusyChange: updateCounts });
    pickerSettlement = window.ElectionSettlement.create($('picker-settlement'), {
      onChange: () => renderCatalog(true),
    });
    editor = window.ElectionStrategyEditor.create($('strategy-editor'), {
      onChange: strategyChanged,
      onSelect: () => {
        pickerPage = 0;
        update();
        $('contract-list').scrollTop = 0;
      },
    });
    firstStrategyId = editor.activeId();
    $('test-mode').value = mode;
    $('test-asof').value = today();
    $('test-mode').addEventListener('change', () => switchMode($('test-mode').value));
    $('test-fees').addEventListener('change', () => { invalidate(); updateCounts(); });
    $('test-asof').addEventListener('input', () => {
      invalidate();
      updateCounts();
    });
    $('test-search').addEventListener('input', () => renderCatalog(true));
    $('test-source').addEventListener('change', () => renderCatalog(true));
    $('contract-list').addEventListener('change', selectionChanged);
    for (const [id, step] of [['picker-prev', -1], ['picker-next', 1]]) {
      $(id).addEventListener('click', () => {
        pickerPage += step;
        renderCatalog();
        $('contract-list').scrollTop = 0;
      });
    }
    $('clear-selection').addEventListener('click', () => {
      if (editor.activeId() === firstStrategyId) defaultsApplied[mode] = true;
      assignments().clear();
      invalidate();
      renderCatalog();
    });
    $('assign-shown').addEventListener('click', () => {
      if (editor.activeId() === firstStrategyId) defaultsApplied[mode] = true;
      for (const market of shownMarkets) assignments().set(keyFor(market), market);
      invalidate();
      renderCatalog();
    });
    $('use-loaded').addEventListener('click', () => {
      showAll[mode].add(editor.activeId());
      update();
    });
    $('cancel-run').addEventListener('click', cancelRun);
    $('strategy-form').addEventListener('submit', run);
    modeCopy();
    updateCounts();
    prompt('Run the backtest to compare strategies and inspect their trades.');
  }
  function cancelRun() {
    if (!activeRun) return;
    activeRun.abort();
    activeRun = null;
    prompt('Backtest canceled.');
    updateCounts();
  }
  function leave() {
    fetchForm.cancel();
    cancelRun();
  }
  window.ElectionTestUI = Object.freeze({ init, update, add, leave, mode: () => mode });
})();

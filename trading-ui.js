(() => {
  'use strict';

  const DAY = 86400000;
  const $ = (name) => document.getElementById('tw-' + name);
  const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
  const yesterday = () => Math.floor(Date.now() / DAY) * DAY - DAY;
  const usd = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format;
  const fees = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:5 }).format;
  const pct = new Intl.NumberFormat('en-US', { style:'percent', maximumFractionDigits:2 }).format;
  const num = new Intl.NumberFormat('en-US', { maximumFractionDigits:1 }).format;
  const tone = (value) => value > 0.000001 ? 'positive' : value < -0.000001 ? 'negative' : '';
  const signed = (value) => (value >= .005 ? '+' : '') + usd(Math.abs(value) < .005 ? 0 : value);

  function create({ history, formatDate, esc, sourceTag, sourceName }) {
    const { sample, run, keyFor, inspectHistory } = window.ElectionTrading;
    const { possiblePriceDays, tradingBounds } = window.ElectionDiscovery;
    const priceCache = new Map();
    let pool = [], search = null, picked = new Map(), lastResult = null, editedDates = false;
    let fetchRequest = null, runRequest = null, planNumber = 0, ledgerPage = 0;
    function dates() {
      return { start: $('from').valueAsNumber, end: $('to').valueAsNumber + DAY - 1 };
    }
    function historySettings() {
      const { start, end } = dates();
      const windowDays = Math.floor(end / DAY) - Math.floor(start / DAY) + 1;
      return { start, end, windowDays, days: $('days').valueAsNumber,
        minDays: $('min-days').value === '' ? windowDays : $('min-days').valueAsNumber };
    }
    function updateHistoryRule() {
      const { minDays, days, windowDays } = historySettings();
      $('min-days').max = String(Math.max(3, windowDays || 3));
      $('min-days').placeholder = windowDays >= 3 ? 'All ' + windowDays + ' days' : 'Entire window';
      $('to').setCustomValidity(windowDays < 3 ? 'Choose a trading window of at least 3 UTC days for a buy and sell.' : '');
      $('history-rule').textContent = windowDays >= 3 && minDays >= 3 && minDays <= windowDays && days >= 1 && days <= 90
        ? 'Requires ' + minDays + ' consecutive tradable daily closes inside the window and ' + days + ' preceding daily closes for the average.'
        : 'Choose at least 3 consecutive trading days. Leave the minimum blank to require the entire window.';
    }
    function requestBounds(m, settings) {
      const { opened, closed } = tradingBounds(m);
      return { start: Math.ceil(Math.max(opened, settings.start - settings.days * DAY) / 1000),
        end: Math.floor(Math.min(settings.end, closed - 1) / 1000) };
    }
    function cachedPrices(m, bounds) {
      const saved = priceCache.get(keyFor(m));
      return saved && saved.tokenId === m.tokenId && saved.seriesTicker === m.seriesTicker &&
        saved.start <= bounds.start && saved.end >= bounds.end ? saved.rows : null;
    }
    function qualifiedMarket(m, rows, settings) {
      const coverage = inspectHistory(m, rows, settings);
      return coverage.days >= settings.minDays ? { ...m, history:rows, coverage } : null;
    }
    async function verifyMarket(m, settings, signal) {
      if (possiblePriceDays(m, settings.start, settings.end, settings.days) < settings.minDays) return null;
      const bounds = requestBounds(m, settings);
      let rows = cachedPrices(m, bounds);
      if (!rows) {
        rows = await history(m, { ...bounds, daily:true, utcCloses:true, signal });
        signal.throwIfAborted();
        if (!Array.isArray(rows)) throw Error('Unreadable price history');
        const key = keyFor(m);
        priceCache.delete(key);
        priceCache.set(key, { ...bounds, tokenId:m.tokenId, seriesTicker:m.seriesTicker, rows });
        if (priceCache.size > 500) priceCache.delete(priceCache.keys().next().value);
      }
      return qualifiedMarket(m, rows, settings);
    }
    function controls() {
      const random = $('method').value === 'random';
      $('size-label').textContent = random ? 'Sample size' : 'Maximum to show';
      $('fetch').disabled = Boolean(fetchRequest || runRequest);
      $('fetch').textContent = fetchRequest ? 'Fetching contracts…' : random ? 'Fetch random sample' : 'Fetch contracts to choose';
      $('redraw').hidden = !random || !search?.markets.length;
      $('redraw').disabled = Boolean(fetchRequest || runRequest);
      $('cancel-fetch').hidden = !fetchRequest;
      $('stop').hidden = !runRequest;
      $('run').disabled = !picked.size || Boolean(fetchRequest || runRequest);
      $('preview').disabled = $('run').disabled;
      $('clear').disabled = !picked.size;
      $('selected').textContent = num(picked.size) + ' selected';
    }
    function invalidate() {
      if (runRequest) runRequest.abort();
      runRequest = null;
      if (lastResult) {
        window.ElectionChart.clear($('price-chart'));
        $('results').hidden = true;
        lastResult = null;
      }
      $('run-note').textContent = '';
      controls();
    }
    function cancelFetch() {
      if (!fetchRequest) return;
      fetchRequest.abort();
      fetchRequest = null;
      $('fetch-note').textContent = 'Fetch canceled. Your previous selection is available.';
      controls();
    }
    function cancelRun() {
      if (!runRequest) return;
      invalidate();
      $('run-note').textContent = 'Trading backtest canceled.';
    }
    function available() {
      const rows = new Map(picked);
      for (const m of pool) rows.set(keyFor(m), m);
      return rows;
    }
    function renderPicker() {
      const term = $('find').value.trim().toLowerCase();
      const rows = [...available().values()].filter((m) => (!$('picked-only').checked || picked.has(keyFor(m))) &&
        [m.title, m.eventTitle, m.label, m.id, m.source].some((s) => String(s || '').toLowerCase().includes(term)))
        .sort((a,b) => (b.volume ?? -1) - (a.volume ?? -1) || a.title.localeCompare(b.title));
      $('list').innerHTML = rows.map((m) => {
        const key = keyFor(m);
        const volume = m.volume == null ? 'Volume unlisted' : (m.source === 'polymarket' ? '$' + num(m.volume) : num(m.volume) + ' contracts') + ' traded';
        return `<label class="contract-choice"><input type="checkbox" data-key="${esc(key)}" ${picked.has(key) ? 'checked' : ''}>
          <span class="choice-title">${esc(m.title)}<span class="market-sub">${esc(m.id)} · ${esc(volume)}</span>
          <span class="market-sub">${m.coverage.days} consecutive trading days · ${esc(formatDate(m.coverage.from))} – ${esc(formatDate(m.coverage.through))} UTC</span></span>
          ${sourceTag(m.source)}</label>`;
      }).join('') || '<p class="empty">' + (term || $('picked-only').checked ? 'No matching contracts in this view.' :
        search ? 'No contracts passed the history check.' : 'Fetch contracts or add one from its market details.') + '</p>';
      $('pool-note').textContent = num(available().size) + ' verified · ' + num(rows.length) + ' shown';
      controls();
    }
    function validateDates() {
      for (const id of ['from','to']) $(id).max = isoDay(yesterday());
      updateHistoryRule();
      return ['from','to','min-days','days'].every((id) => $(id).reportValidity());
    }
    async function fetchPool(event, reuse = false) {
      event.preventDefault();
      if (fetchRequest || runRequest || !validateDates() || !$('discovery').reportValidity()) return;
      const controller = new AbortController();
      fetchRequest = controller;
      controls();
      try {
        const settings = historySettings(), target = $('size').valueAsNumber;
        const random = $('method').value === 'random';
        const verified = [], nextPicked = random ? new Map() : new Map(picked);
        const checkedKeys = new Set();
        let short = 0, failed = 0, firstError = '';
        async function checkBatch(batch) {
          const fresh = batch.filter((m) => !checkedKeys.has(keyFor(m)));
          const ordered = random && fresh.length ? sample(fresh, fresh.length) :
            fresh.sort((a,b) => (b.volume ?? -1) - (a.volume ?? -1) || keyFor(a).localeCompare(keyFor(b)));
          for (const candidate of ordered) {
            controller.signal.throwIfAborted();
            const key = keyFor(candidate);
            checkedKeys.add(key);
            $('fetch-note').textContent = 'Checking daily prices · ' + verified.length + ' of ' + target +
              ' verified · ' + checkedKeys.size + ' candidates checked.';
            let market;
            try { market = await verifyMarket(candidate, settings, controller.signal); }
            catch (error) {
              controller.signal.throwIfAborted();
              failed++;
              firstError ||= error.message;
            }
            controller.signal.throwIfAborted();
            if (market) {
              verified.push(market);
              if (random || nextPicked.has(key)) nextPicked.set(key, market);
            } else {
              if (market === null) short++;
              nextPicked.delete(key);
            }
            if (verified.length === target) return true;
          }
          return false;
        }
        let r = reuse && search && (target <= pool.length || search.exhausted || search.markets.length >= 500) ? search : null;
        if (r) await checkBatch(r.markets);
        else r = await window.ElectionDiscovery.fetch({
          mode: $('status').value, source: $('source').value, count: 500, newest: true, electionIndex: true,
          tradingFrom: $('from').value, tradingThrough: $('to').value, includedCountry: $('country').value,
          tradingMinDays:settings.minDays, tradingWarmup:settings.days,
          query: $('query').value, signal: controller.signal, onCandidates:checkBatch,
          onProgress: (p) => { if (fetchRequest === controller) $('fetch-note').textContent =
            'Searching ' + sourceName(p.source) + ' · ' + verified.length + ' of ' + target + ' verified · ' + num(p.scanned) + ' listings checked.'; },
        });
        if (fetchRequest !== controller) return;
        if (!r.markets.length && r.issues.length) throw Error(r.issues.join(' '));
        search = r;
        pool = verified;
        picked = nextPicked;
        invalidate();
        $('find').value = '';
        $('picked-only').checked = false;
        $('fetch-note').textContent = (r.issues.length || failed ? 'Partial results · ' : '') + verified.length + ' of ' + target +
          (random ? ' requested contracts selected. ' : ' requested contracts available to choose. ') + checkedKeys.size + ' of ' + r.markets.length +
          ' date matches checked. ' + (short ? short + ' had short or incomplete price history. ' : '') +
          (failed ? failed + ' price requests failed. ' + firstError + '. ' : '') + r.issues.join(' ');
        renderPicker();
      } catch (e) {
        if (fetchRequest === controller) $('fetch-note').textContent = 'Fetch interrupted. ' + e.message;
      } finally {
        if (fetchRequest === controller) { fetchRequest = null; controls(); }
      }
    }
    function addPlan() {
      const plan = $('plan-template').content.firstElementChild.cloneNode(true);
      const name = 'Strategy ' + ++planNumber;
      plan.querySelector('legend').textContent = name;
      plan.querySelector('[data-field=name]').value = name;
      plan.querySelector('.tw-remove').setAttribute('aria-label', 'Remove ' + name);
      for (const action of ['Buy','Sell']) {
        const buy = action === 'Buy';
        const row = document.createElement('div');
        row.className = 'tw-rule';
        row.dataset.action = action.toLowerCase();
        row.innerHTML = `<h3 class="tw-${buy ? 'buy' : 'sell'}">${action} when</h3>
          <label>Reference<select data-rule="basis" aria-label="${action} reference"><option value="level">Price level</option>
            <option value="average">Moving average</option><option value="change">Previous daily close</option></select></label>
          <label>Direction<select data-rule="direction" aria-label="${action} direction"><option value="below">At or below</option>
            <option value="above">At or above</option></select></label>
          <label><span data-unit>Price (%)</span><input data-rule="amount" aria-label="${action} threshold (%)" type="number" required min="0" max="100" step="any" value="${buy ? 40 : 60}"></label>`;
        row.querySelector('[data-rule=direction]').value = buy ? 'below' : 'above';
        plan.querySelector('.tw-signals').append(row);
      }
      $('strategies').append(plan);
      for (const button of $('strategies').querySelectorAll('.tw-remove')) button.hidden = $('strategies').children.length === 1;
      return plan;
    }
    function readPlans() {
      return [...$('strategies').children].map((plan) => {
        const field = (key) => plan.querySelector('[data-field=' + key + ']');
        function rule(type) {
          const row = plan.querySelector('[data-action=' + type + ']');
          const read = (key) => row.querySelector('[data-rule=' + key + ']').value;
          return { basis:read('basis'), direction:read('direction'), amount:Number(read('amount')) };
        }
        const buyFrom = field('buy-from').value ? field('buy-from').valueAsNumber : -Infinity;
        const buyThrough = field('buy-to').value ? field('buy-to').valueAsNumber + DAY - 1 : Infinity;
        if (buyThrough < buyFrom) throw Error('The buy-date limit ends before it begins for ' + field('name').value + '.');
        return { name:field('name').value.trim() || 'Untitled strategy', side:field('side').value,
          stake:field('stake').valueAsNumber, buy:rule('buy'), sell:rule('sell'), buyFrom, buyThrough };
      });
    }

    function drawPrice() {
      if (!lastResult) return;
      const { result } = lastResult, key = $('chart-contract').value;
      const rows = result.series.get(key) || [];
      const display = $('chart-side').value, series = [];
      for (const [side, color] of [['Yes','var(--gain)'],['No','var(--loss)']]) {
        if (display !== 'both' && display !== side.toLowerCase()) continue;
        const project = (n) => side === 'Yes' ? n : 1 - n;
        for (const average of [false, true]) {
          if (average && !$('show-avg').checked) continue;
          series.push({ name: side + (average ? ' · ' + result.settings.days + '-day average' : ' price'),
            color, pattern:average ? 'dashed' : 'solid',
            points:rows.filter((r) => !average || r.average !== null).map((r) => ({ t:r.t/1000, p:project(average ? r.average : r.p) })) });
        }
      }
      $('price-legend').innerHTML = series.map((s) => `<span><i class="${s.pattern === 'dashed' ? 'average' : ''}" style="color:${s.color}"></i>${esc(s.name)}</span>`).join('');
      const fills = [];
      for (const t of result.trades) {
        if (keyFor(t.market) !== key || (display !== 'both' && display !== t.side)) continue;
        fills.push({ t:t.enteredAt/1000, p:t.entryPrice, action:'Buy', name:t.strategy + ' · Buy ' + t.side });
        if (t.status === 'Sold' || t.status === 'Window sale')
          fills.push({ t:t.endedAt/1000, p:t.exitPrice, action:'Sell', name:t.strategy + ' · Sell ' + t.side });
      }
      if (fills.length) $('price-legend').insertAdjacentHTML('beforeend', '<span>▲ Buy</span><span>▼ Sell</span>');
      window.ElectionChart.draw($('price-chart'), { series, fills, daily:true, start:result.settings.start/1000, end:result.settings.end/1000 });
    }
    function paintLedger() {
      const { result, missing } = lastResult;
      const pageSize = 50, count = result.trades.length;
      const part = result.trades.slice(ledgerPage * pageSize, (ledgerPage + 1) * pageSize);
      const percent = (p) => pct(p);
      const rows = part.map((t) => `<tr><td>${esc(t.strategy)}<span class="market-sub outcome-${t.side}">${t.side === 'yes' ? 'Buy Yes' : 'Buy No'}</span></td>
        <td>${esc(t.market.title)}<span class="market-sub">${esc(sourceName(t.market.source))} · ${esc(t.market.id)}</span></td>
        <td>${formatDate(t.enteredAt)} · ${percent(t.entryPrice)}<span class="market-sub">Signal ${formatDate(t.buySignal)}</span></td>
        <td>${t.status} · ${percent(t.exitPrice)}<span class="market-sub">${formatDate(t.endedAt)}${t.exitSignal ? ' · Signal ' + formatDate(t.exitSignal) : ''}</span></td>
        <td>${usd(t.stake)}</td><td>${fees(t.entryFee + t.exitFee)}</td><td class="${tone(t.profit)}">${signed(t.profit)}</td></tr>`).join('');
      $('ledger').innerHTML = '<h3>Trade ledger</h3>' + (count ? '<div class="table-scroll"><table class="result-table"><thead><tr><th>Strategy</th><th>Contract</th><th>Buy fill</th><th>Exit or mark</th><th>Stake</th><th>Fees</th><th>Net P&amp;L</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="tw-note">No simulated buys filled under these rules.</p>') +
        (count > pageSize ? `<div class="tw-actions tw-ledger-foot"><button type="button" data-page-step="-1" class="text-button" ${ledgerPage ? '' : 'disabled'}>Previous</button>
        ${ledgerPage*pageSize+1}–${ledgerPage*pageSize+part.length} of ${num(count)} positions
        <button type="button" data-page-step="1" class="text-button" ${(ledgerPage+1)*pageSize>=count ? 'disabled' : ''}>Next</button></div>` : '') +
        (missing.length ? '<details><summary>Contracts without usable history (' + missing.length + ')</summary><ul>' +
          missing.map(([m,reason])=>'<li>' + esc(m.title) + ' · ' + esc(m.id) + ' · ' + esc(reason) + '</li>').join('') + '</ul></details>' : '');
    }
    function showResults(result, markets, missing, preview) {
      lastResult = { result, missing };
      ledgerPage = 0;
      const t = result.totals;
      const coverage = markets.length - missing.length;
      const metrics = [
        ['Net P&L',coverage ? signed(t.profit) : '—',tone(t.profit)],['Return on entry cost',t.roi === null ? '—' : pct(t.roi),tone(t.roi)],
        ['Buys filled',num(t.count),''],['Trading fees',fees(t.fees),''],
      ];
      $('summary').innerHTML = '<p class="result-readout">' + formatDate(result.settings.start) + ' – ' + formatDate(result.settings.end) +
        ' UTC · ' + coverage + ' of ' + markets.length + ' contracts with prices · ' + (t.count-t.open) + ' closed positions · ' + t.open + ' marked open.</p>' +
        '<div class="metric-grid">' + metrics.map(([k,v,c]) => `<div class="metric"><span>${esc(k)}</span><strong class="${c}">${esc(v)}</strong></div>`).join('') + '</div>' +
        '<div class="table-scroll"><table class="result-table"><thead><tr><th>Strategy</th><th>Buys</th><th>Realized P&amp;L</th><th>Open P&amp;L</th><th>Fees</th><th>Return</th></tr></thead><tbody>' +
        result.strategies.map((s) => { const v=s.totals; return `<tr><td>${esc(s.name)}</td><td>${v.count}</td><td class="${tone(v.realized)}">${coverage?signed(v.realized):'—'}</td><td class="${tone(v.marked)}">${coverage?signed(v.marked):'—'}</td><td>${fees(v.fees)}</td><td class="${tone(v.roi)}">${v.roi===null?'—':pct(v.roi)}</td></tr>`; }).join('') + '</tbody></table></div>';
      $('result-title').textContent = preview ? 'Price preview' : 'Trading results';
      if (preview) {
        $('summary').innerHTML = '<p class="result-readout">' + formatDate(result.settings.start) + ' – ' + formatDate(result.settings.end) +
          ' UTC · ' + coverage + ' of ' + markets.length + ' contracts with daily prices.</p>';
      }
      const chooser = $('chart-contract');
      chooser.replaceChildren(...markets.filter((m)=>result.series.has(keyFor(m))).map((m)=> new Option(sourceName(m.source) + ' · ' + m.title + ' · ' + m.id, keyFor(m))));
      const withPrices = markets.find((m)=>result.series.get(keyFor(m))?.length);
      if (withPrices) chooser.value = keyFor(withPrices);
      $('results').hidden = false;
      drawPrice();
      $('performance').replaceChildren();
      if (t.count) window.ElectionBacktestCharts.draw($('performance'), result, {
        signedMoney:signed, returnText:pct, valueClass:tone,
      });
      if (preview) {
        $('ledger').innerHTML = missing.length ? '<details><summary>Missing prices (' + missing.length + ')</summary><ul>' +
          missing.map(([m,reason])=>'<li>' + esc(m.title) + ' · ' + esc(reason) + '</li>').join('') + '</ul></details>' : '';
      } else paintLedger();
      $('results').scrollIntoView({ block:'start' });
    }

    async function simulate(event, preview = false) {
      event.preventDefault();
      if (!picked.size || fetchRequest || runRequest || !validateDates() || !(preview ? $('days').reportValidity() : $('rules').reportValidity())) return;
      let plans;
      try { plans = preview ? [] : readPlans(); } catch (error) { $('run-note').textContent = error.message; return; }
      invalidate();
      const controller = new AbortController();
      runRequest = controller;
      controls();
      const settings = { ...historySettings(), fees:$('fees').checked, liquidate:$('end-mode').value === 'sell' };
      const all = [...picked.values()].sort((a,b) => (b.volume ?? -1) - (a.volume ?? -1));
      try {
        $('run-note').textContent = 'Calculating from verified daily prices…';
        await new Promise((resolve) => setTimeout(resolve, 0));
        controller.signal.throwIfAborted();
        const result = run(all, plans, settings);
        const missing = result.rejected.map(({ market, coverage }) =>
          [market, coverage.days + ' consecutive days verified, ' + settings.minDays + ' required']);
        showResults(result, all, missing, preview);
        $('run-note').textContent = preview ? 'Prices loaded.' : 'Run complete.';
      } catch (error) {
        if (runRequest === controller) $('run-note').textContent = error.message || 'Trading replay failed.';
      } finally {
        if (runRequest === controller) { runRequest = null; controls(); }
      }
    }

    async function addMarket(m) {
      cancelFetch();
      invalidate();
      const mode = window.ElectionDiscovery.eligible(m, 'archive') ? 'archive' : 'live';
      if (!picked.size) {
        if ($('status').value !== 'both' && mode !== $('status').value) { $('status').value = mode; pool = []; search = null; }
        const { closed } = tradingBounds(m), { start, windowDays } = historySettings();
        if (!editedDates && closed <= start && windowDays >= 3) {
          const end = Math.min(yesterday(), (Math.ceil(closed / DAY) - 1) * DAY);
          $('from').value = isoDay(end - (windowDays-1)*DAY);
          $('to').value = isoDay(end);
          pool = []; search = null;
        }
      }
      $('method').value = 'manual';
      if (!validateDates() || !inScope(m)) {
        $('fetch-note').textContent = 'This contract is outside the current filters. Adjust the filters to include it.';
        controls(); return;
      }
      const controller = new AbortController();
      fetchRequest = controller;
      controls();
      $('fetch-note').textContent = 'Checking daily prices for ' + m.title + '…';
      try {
        const market = await verifyMarket(m, historySettings(), controller.signal);
        controller.signal.throwIfAborted();
        if (market) {
          picked.set(keyFor(m), market);
          $('picked-only').checked = false; $('find').value = '';
        }
        $('fetch-note').textContent = market ? m.title + ' added with ' + market.coverage.days + ' consecutive trading days.' :
          m.title + ' has insufficient consecutive price history for this window.';
        renderPicker();
      } catch (error) {
        if (fetchRequest === controller) $('fetch-note').textContent = 'Could not verify ' + m.title + '. ' + error.message;
      } finally {
        if (fetchRequest === controller) { fetchRequest = null; controls(); }
      }
    }
    function inScope(m) {
      const status = $('status').value;
      return (status === 'both' ? ['live','archive'].some((mode)=>window.ElectionDiscovery.eligible(m, mode)) :
        window.ElectionDiscovery.eligible(m, status)) &&
        ($('source').value === 'all' || m.source === $('source').value) &&
        (!$('country').value || window.ElectionGeography.countryIds(m).includes($('country').value));
    }
    function resetSearch(id) {
      cancelFetch();
      search = null; pool = [];
      if (id === 'from' || id === 'to') editedDates = true;
      updateHistoryRule();
      const settings = historySettings(), prior = picked.size;
      const coverageChanged = ['from','to','days','min-days'].includes(id);
      const valid = ['from','to','days','min-days'].every((key)=>$(key).validity.valid);
      for (const [key, market] of picked) {
        let keep = valid && inScope(market) && !(id === 'query' && $('method').value === 'random');
        if (keep && coverageChanged) {
          const rows = cachedPrices(market, requestBounds(market, settings));
          const verified = rows && qualifiedMarket(market, rows, settings);
          if (verified) picked.set(key, verified); else keep = false;
        }
        if (!keep) picked.delete(key);
      }
      if (coverageChanged || prior !== picked.size) invalidate();
      $('fetch-note').textContent = 'Fetch to verify contracts for these settings.' +
        (prior !== picked.size ? ' Removed ' + (prior - picked.size) + ' previous selections.' : '');
      renderPicker();
    }
    const end = yesterday();
    $('from').value = isoDay(end-59*DAY); $('to').value = isoDay(end);
    $('from').max = $('to').max = isoDay(end);
    updateHistoryRule();
    for (const c of [...window.ElectionCountries.features].sort((a,b)=>a.name.localeCompare(b.name))) $('country').add(new Option(c.name,c.id));
    addPlan();
    $('discovery').addEventListener('submit',fetchPool);
    for (const id of ['from','to','min-days','days','status','source','query','country'])
      $(id).addEventListener('input', () => resetSearch(id));
    $('method').addEventListener('change', () => { cancelFetch(); controls(); });
    $('size').addEventListener('input', cancelFetch);
    $('redraw').addEventListener('click', (event) => fetchPool(event, true));
    $('cancel-fetch').addEventListener('click',cancelFetch);
    $('stop').addEventListener('click',cancelRun);
    $('find').addEventListener('input',renderPicker);
    $('picked-only').addEventListener('change',renderPicker);
    $('clear').addEventListener('click',() => { cancelFetch(); picked.clear(); invalidate(); renderPicker(); });
    $('list').addEventListener('change',(e) => {
      const box = e.target.closest('[data-key]');
      if (!box) return;
      cancelFetch();
      const key = box.dataset.key;
      if (box.checked) picked.set(key,available().get(key)); else picked.delete(key);
      invalidate();
      if ($('picked-only').checked) renderPicker(); else controls();
    });
    $('add-rule').addEventListener('click', () => { const plan=addPlan(); invalidate(); plan.querySelector('input').focus(); });
    $('strategies').addEventListener('click',(e) => {
      if (!e.target.closest('.tw-remove')) return;
      e.target.closest('.tw-plan').remove();
      if ($('strategies').children.length===1) $('strategies').querySelector('.tw-remove').hidden=true;
      invalidate();
    });
    $('rules').addEventListener('input',(e) => {
      invalidate();
      if (e.target.matches('[data-rule=basis]')) {
        const row=e.target.closest('.tw-rule'), relative=e.target.value!=='level';
        const unit=relative?'Distance (pp)':'Price (%)';
        row.querySelector('[data-unit]').textContent=unit;
        const amount=row.querySelector('[data-rule=amount]');
        amount.setAttribute('aria-label',(row.dataset.action==='buy'?'Buy':'Sell')+' '+unit);
        amount.value=relative?'5':row.dataset.action==='buy'?'40':'60';
      }
      if (e.target.matches('[data-field=name]')) {
        const plan=e.target.closest('.tw-plan');
        plan.querySelector('legend').textContent=e.target.value;
        plan.querySelector('.tw-remove').setAttribute('aria-label','Remove '+e.target.value);
      }
    });
    $('rules').addEventListener('submit',simulate);
    $('preview').addEventListener('click',(event) => simulate(event, true));
    for (const id of ['chart-contract','chart-side','show-avg']) $(id).addEventListener('change',drawPrice);
    $('ledger').addEventListener('click',(e) => { const button=e.target.closest('[data-page-step]'); if(button){ledgerPage+=Number(button.dataset.pageStep);paintLedger();} });
    return { enter:renderPicker, leave() { cancelFetch(); cancelRun(); }, addMarket };
  }

  window.ElectionTradingUI = Object.freeze({ create });
})();

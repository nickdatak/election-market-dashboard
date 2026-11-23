(() => {
  'use strict';

  function create(form, { apply, onBusyChange, onStart, onPage, onStatus, catalog = false }) {
    const prefix = catalog ? 'live-fetch-' : 'fetch-';
    const fields = document.getElementById('contract-fetch-template').content.cloneNode(true);
    if (catalog) {
      fields.querySelector('.fetch-assign').remove();
      fields.querySelector('.fetch-inclusion').remove();
      fields.querySelector('.fetch-recency').remove();
      for (const node of fields.querySelectorAll('[id]')) node.id = node.id.replace(/^fetch-/, prefix);
      for (const node of fields.querySelectorAll('[aria-describedby]'))
        node.setAttribute('aria-describedby', node.getAttribute('aria-describedby').replace(/\bfetch-/g, prefix));
    }
    form.replaceChildren(fields);
    const field = (id) => form.querySelector('#' + prefix + id);
    const count = field('count'),
      source = field('source'),
      from = field('from'),
      to = field('to');
    const excludeCountry = field('country'),
      includeCountry = field('include-country'),
      query = field('query'),
      assign = field('assign');
    const recency = field('recency');
    const status = field('status'),
      submit = field('submit'),
      cancelButton = field('cancel');
    const countries = new Map(
      [...window.ElectionCountries.features]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((feature) => [feature.id, feature.name]),
    );
    for (const [id, name] of countries) {
      excludeCountry.add(new Option(name, id));
      includeCountry?.add(new Option(name, id));
    }

    const contexts = new Map();
    const number = new Intl.NumberFormat('en-US').format;
    let contextKey = '',
      mode = 'archive',
      excluded = new Set(),
      request = null,
      runBusy = false;

    function paint() {
      field('fields').disabled = Boolean(request);
      if (assign) assign.disabled = Boolean(request);
      submit.disabled = Boolean(request) || runBusy;
      cancelButton.hidden = !request;
      submit.textContent = request ? 'Fetching…' : assign?.checked ? 'Fetch and assign' : 'Fetch contracts';
      field('country-note').hidden = !excluded.size;
      const chips = field('exclusions');
      chips.replaceChildren();
      for (const id of excluded) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.dataset.country = id;
        chip.textContent = countries.get(id) + ' ×';
        chip.setAttribute('aria-label', 'Remove ' + countries.get(id) + ' exclusion');
        chip.disabled = Boolean(request);
        chips.append(chip);
      }
      for (const option of excludeCountry.options)
        option.disabled = excluded.has(option.value) || Boolean(option.value && option.value === includeCountry?.value);
      if (includeCountry)
        for (const option of includeCountry.options) option.disabled = excluded.has(option.value);
    }
    function report(message) {
      status.textContent = message;
      onStatus?.(message);
    }
    function cancel(notify = true) {
      if (!request) return;
      request.abort();
      request = null;
      report(catalog ? 'Fetch canceled. Previous listings restored.' : 'Fetch canceled. Your previous selection is available.');
      paint();
      if (notify) onBusyChange();
    }
    function setContext(nextMode) {
      const key = nextMode;
      if (contextKey === key) return;
      cancel(false);
      if (contextKey)
        contexts.set(contextKey, {
          count: count.value,
          source: source.value,
          recency: recency?.value,
          from: from.value,
          to: to.value,
          query: query.value,
          assign: assign?.checked,
          includedCountry: includeCountry?.value,
          countries: [...excluded],
          status: status.textContent,
        });
      mode = nextMode;
      contextKey = key;
      const saved = contexts.get(key);
      count.value = saved?.count ?? (catalog ? '' : '500');
      if (!catalog) count.max = '500';
      count.required = false;
      count.placeholder = catalog ? 'All contracts' : '500';
      if (recency) recency.value = saved?.recency ?? 'election';
      source.value = saved?.source ?? 'all';
      from.value = saved?.from ?? '';
      to.value = saved?.to ?? '';
      validateDates();
      query.value = saved?.query ?? '';
      if (assign) assign.checked = saved?.assign ?? true;
      excluded = new Set(saved?.countries);
      excludeCountry.value = '';
      if (includeCountry) includeCountry.value = saved?.includedCountry ?? '';
      status.textContent = saved?.status ?? '';
      field('date-note').textContent = (catalog ? 'Leave the maximum blank for all matches. ' : 'Up to 500 recent matches across the selected exchanges. ') +
        (mode === 'live' ? 'Dates filter expected settlement or resolution in UTC.' : 'Both settlement dates are inclusive, in UTC.');
      paint();
    }
    async function fetchMatches(allLive = false) {
      if (request || runBusy) return;
      const target = allLive || (catalog && count.value === '') ? 'all' : count.value === '' ? 500 : count.valueAsNumber;
      if (!allLive && !form.reportValidity()) return;
      if (target !== 'all' && (!Number.isSafeInteger(target) || target < 1)) {
        status.textContent = 'Enter a positive whole contract count.';
        count.focus();
        return;
      }
      const controller = new AbortController();
      const shouldAssign = Boolean(assign?.checked);
      request = controller;
      const options = {
        mode,
        newest: !catalog,
        electionIndex: recency?.value === 'election',
        source: allLive ? 'all' : source.value,
        count: target,
        from: allLive ? '' : from.value,
        to: allLive ? '' : to.value,
        query: allLive ? '' : query.value.trim(),
        includedCountry: includeCountry?.value || '',
        excludedCountries: allLive ? [] : [...excluded],
        signal: controller.signal,
        onPage,
        onProgress({ found, scanned, pages, source: venue }) {
          if (request !== controller) return;
          const exchange = venue === 'kalshi' ? 'Kalshi' : 'Polymarket';
          const matches = target === 'all' ? number(found) + ' matched' : number(found) + ' of ' + number(target) + ' matches';
          report((catalog ? 'Searching ' : 'Checking newest matches on ') + exchange + ' · ' + matches + ' · ' + number(scanned) + ' listings checked · ' + number(pages) + ' pages.');
        },
      };
      onStart?.(options);
      paint();
      onBusyChange();
      try {
        const result = await window.ElectionDiscovery.fetch(options);
        if (request !== controller) return;
        const found = result.markets.length;
        const problem = result.issues.join(' ');
        if (!found && problem) {
          report('Search incomplete. 0 verified matches. Previous contracts kept. ' + problem);
          return;
        }
        apply(result.markets, shouldAssign, result, options);
        const belowMax = result.exhausted && target !== 'all' && found < target;
        const quantity = belowMax
          ? (found ? 'All ' : '') + number(found) + ' matching ' + (found === 1 ? 'contract' : 'contracts')
          : number(found) + (target === 'all' ? ' live contracts' : ' of ' + number(target));
        const summary = quantity + ' fetched' +
          (shouldAssign ? ' and assigned to every strategy' : '') +
          (belowMax ? ' (maximum ' + number(target) + ')' : '') +
          ' · ' +
          number(result.scanned) +
          ' listings checked.';
        let breakdown = '';
        if (catalog && options.source === 'all' && target === 'all') {
          const kalshi = result.markets.filter((market) => market.source === 'kalshi').length;
          breakdown = ' Kalshi ' + kalshi.toLocaleString() + ' · Polymarket ' + (found - kalshi).toLocaleString() + '.';
        }
        report((problem ? 'Partial results · ' : '') + summary + breakdown + (problem ? ' ' + problem : ''));
      } catch (error) {
        if (request === controller) report(error.message || 'The contract search failed.');
      } finally {
        if (request === controller) {
          request = null;
          paint();
          onBusyChange();
        }
      }
    }
    function validateDates() {
      const reversed = from.value && to.value && from.valueAsNumber > to.valueAsNumber;
      to.setCustomValidity(reversed ? 'Choose an end date on or after the start date.' : '');
    }
    from.addEventListener('input', validateDates);
    to.addEventListener('input', validateDates);
    includeCountry?.addEventListener('change', paint);
    excludeCountry.addEventListener('change', () => {
      if (!excludeCountry.value) return;
      excluded.add(excludeCountry.value);
      excludeCountry.value = '';
      paint();
    });
    field('exclusions').addEventListener('click', (event) => {
      const chip = event.target.closest('button[data-country]');
      if (!chip || request) return;
      excluded.delete(chip.dataset.country);
      paint();
      excludeCountry.focus();
    });
    assign?.addEventListener('change', paint);
    cancelButton.addEventListener('click', () => cancel());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      validateDates();
      fetchMatches();
    });
    return {
      setContext,
      cancel,
      fetchAll: () => fetchMatches(true),
      get busy() {
        return Boolean(request);
      },
      setRunBusy(value) {
        runBusy = value;
        submit.disabled = Boolean(request) || runBusy;
      },
    };
  }
  window.ElectionContractFetch = Object.freeze({ create });
})();

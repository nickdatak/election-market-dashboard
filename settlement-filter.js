(() => {
  'use strict';

  const DAY = 86_400_000;
  const stamp = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i;

  function dateValue(value, kind) {
    if (typeof value !== 'string') return null;
    const parts = stamp.exec(value);
    if (!parts) return null;
    const [, day, time, zone] = parts;
    const midnight = Date.parse(day);
    // Date.parse can roll an impossible day such as February 30 into March.
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return null;
    const ms = time ? Date.parse(day + 'T' + time + (zone || 'Z')) : midnight;
    return Number.isFinite(ms) ? { day: new Date(ms).toISOString().slice(0, 10), ms, kind } : null;
  }

  function dateFor(market, mode) {
    if (!market) return null;
    const reported =
      market.settlementBasis === 'resolved-close' ? null : dateValue(market.settledAt, 'reported');
    return reported || (mode === 'live' ? dateValue(market.expectedResolutionAt, 'expected') : null);
  }

  function labelFor(market, date) {
    if (date?.kind === 'expected')
      return market.source === 'kalshi' ? 'Expected resolution' : 'Expected settlement';
    if (market.settlementBasis === 'oracle-final') return 'Oracle finalized';
    return market.source === 'polymarket' ? 'Resolved' : 'Settled';
  }

  function create(details, { onChange } = {}) {
    const prefix = details.id;
    details.classList.add('settlement-filter');
    details.innerHTML = `
      <summary>Settlement date <span class="settlement-summary-state"></span></summary>
      <div class="settlement-panel">
        <p class="settlement-note" id="${prefix}-note"></p>
        <div class="settlement-fields">
          <label class="settlement-bound" for="${prefix}-from">From
            <input type="date" id="${prefix}-from" aria-describedby="${prefix}-note ${prefix}-error">
          </label>
          <label class="settlement-bound" for="${prefix}-to">Through
            <input type="date" id="${prefix}-to" aria-describedby="${prefix}-note ${prefix}-error">
          </label>
          <div class="settlement-actions">
            <label class="settlement-undated" for="${prefix}-undated">
              <input type="checkbox" id="${prefix}-undated">Undated only
            </label>
            <button type="button" class="settlement-clear" id="${prefix}-clear">Clear dates</button>
          </div>
        </div>
        <p class="settlement-error" id="${prefix}-error" role="status"></p>
      </div>`;

    const summary = details.querySelector('.settlement-summary-state');
    const note = details.querySelector('.settlement-note');
    const error = details.querySelector('.settlement-error');
    const [from, to] = details.querySelectorAll('input[type="date"]');
    const undated = details.querySelector('input[type="checkbox"]');
    const clear = details.querySelector('button');
    const empty = () => ({ from: '', to: '', undated: false });
    const states = { live: empty(), archive: empty() };
    let mode = 'live';
    let minMs, endMs, active, invalid;

    function update() {
      const state = states[mode];
      state.from = from.value;
      state.to = to.value;
      state.undated = undated.checked;
      from.disabled = to.disabled = state.undated;
      minMs = state.from ? from.valueAsNumber : -Infinity;
      endMs = state.to ? to.valueAsNumber + DAY : Infinity;
      const incomplete = !state.undated && (from.validity.badInput || to.validity.badInput);
      const reversed = !state.undated && minMs >= endMs;
      invalid = incomplete || reversed;
      active = Boolean(invalid || state.from || state.to || state.undated);
      from.setAttribute('aria-invalid', String(reversed || (incomplete && from.validity.badInput)));
      to.setAttribute('aria-invalid', String(reversed || (incomplete && to.validity.badInput)));
      clear.setAttribute('aria-disabled', String(!active));
      error.textContent = reversed
        ? 'Choose an end date on or after the start date.'
        : incomplete
          ? 'Enter a complete date or clear the dates.'
          : '';

      let selection = '';
      if (invalid) selection = 'Check dates';
      else if (state.undated) selection = 'Undated only';
      else if (state.from && state.to)
        selection = state.from === state.to ? state.from : state.from + ' – ' + state.to;
      else if (state.from) selection = 'From ' + state.from;
      else if (state.to) selection = 'Through ' + state.to;
      summary.textContent = selection;
    }

    function restore() {
      const state = states[mode];
      from.value = state.from;
      to.value = state.to;
      undated.checked = state.undated;
      note.textContent =
        mode === 'live'
          ? 'Dates are in UTC. Until settlement is reported, Kalshi uses the expected outcome date and Polymarket uses the expected settlement date.'
          : 'Dates are in UTC. Kalshi reports when a contract settled and Polymarket reports when it resolved.';
      update();
    }

    function changed() {
      update();
      onChange?.();
    }

    from.addEventListener('input', changed);
    to.addEventListener('input', changed);
    undated.addEventListener('change', changed);
    clear.addEventListener('click', () => {
      if (!active) return;
      states[mode] = empty();
      restore();
      onChange?.();
    });
    restore();

    return {
      clear() {
        states[mode] = empty();
        restore();
      },
      setMode(next) {
        if (next === mode) return;
        mode = next;
        restore();
      },
      matches(market) {
        if (invalid) return false;
        if (!active) return true;
        const date = dateFor(market, mode);
        if (states[mode].undated) return date === null;
        return date !== null && date.ms >= minMs && date.ms < endMs;
      },
      get active() {
        return active;
      },
      get invalid() {
        return invalid;
      },
    };
  }

  window.ElectionSettlement = Object.freeze({ dateFor, labelFor, create });
})();

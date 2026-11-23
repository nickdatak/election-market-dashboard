(() => {
  'use strict';

  const conditionTypes = {
    priceAtLeast: 'Price at least',
    priceAtMost: 'Price at most',
    risesBy: 'Rises by at least',
    fallsBy: 'Falls by at least',
    crossesAbove: 'Crosses above',
    crossesBelow: 'Crosses below',
  };
  const changeTypes = new Set(['risesBy', 'fallsBy']);
  const dayComparisonTypes = new Set(['crossesAbove', 'crossesBelow', ...changeTypes]);
  const exitTypes = { ...conditionTypes, gainFromEntry: 'Gain from entry ≥', lossFromEntry: 'Loss from entry ≥' };
  const stakeLimits = { min: '0.01', max: '1000000', step: '0.01' };
  const priceLimits = { min: '0.1', max: '99.9', step: '0.1' };
  const symbols = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    remove: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const icon = (name) =>
    `<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${symbols[name]}</svg>`;
  const escape = (text) =>
    String(text).replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
    );
  const asNumber = (text) => (text.trim() ? Number(text) : NaN);
  const unitFor = (type) => (changeTypes.has(type) || type === 'gainFromEntry' || type === 'lossFromEntry' ? 'pp' : '%');

  function create(host, { onChange = () => {}, onSelect = () => {} } = {}) {
    let sequence = 0;
    function newStrategy() {
      sequence++;
      return {
        id: 'strategy-' + sequence,
        name: 'Strategy ' + sequence,
        side: 'yes',
        stake: '100',
        match: 'all',
        conditions: [{ type: 'priceAtLeast', amount: '50' }],
        exitMatch: 'any',
        exitConditions: [],
      };
    }

    const drafts = [newStrategy()];
    let active = drafts[0];
    let counts = new Map();
    const displayName = (draft) => draft.name.trim() || 'Unnamed strategy';
    const field = (selector) => host.querySelector(selector);
    host.classList.add('strategy-editor');
    host.innerHTML = `
      <div class="strategy-switcher">
        <div class="strategy-tabs" role="tablist" aria-label="Strategies"></div>
        <button class="strategy-add" type="button" data-action="add-strategy">${icon('plus')} Add strategy</button>
      </div>
      <div id="strategy-settings" class="strategy-settings" role="tabpanel"></div>`;

    const tabList = field('.strategy-tabs');
    const panel = field('#strategy-settings');

    function renderTabs() {
      tabList.innerHTML = drafts
        .map(
          (draft) => `
        <div class="strategy-tab" role="presentation">
          <button type="button" role="tab" id="tab-${draft.id}" aria-controls="strategy-settings"
            data-strategy-id="${draft.id}"${drafts.length > 1 ? ' aria-keyshortcuts="Delete"' : ''}>
            <span class="strategy-tab-name"></span><span class="strategy-tab-count" aria-hidden="true"></span>
          </button>
          ${drafts.length > 1 ? `<button type="button" class="strategy-tab-remove" data-action="remove-strategy" data-remove-id="${draft.id}">${icon('remove')}</button>` : ''}
        </div>`,
        )
        .join('');
      syncTabs();
    }

    function syncTabs() {
      for (const [index, item] of Array.from(tabList.children).entries()) {
        const draft = drafts[index];
        const tab = item.querySelector('[role="tab"]');
        const remove = item.querySelector('.strategy-tab-remove');
        const count = counts.get(draft.id) || 0;
        const name = displayName(draft);
        const label = name + ', ' + count + ' assigned ' + (count === 1 ? 'contract' : 'contracts');
        tab.setAttribute('aria-selected', String(draft === active));
        tab.tabIndex = draft === active ? 0 : -1;
        tab.setAttribute('aria-label', label);
        tab.title = label;
        tab.querySelector('.strategy-tab-name').textContent = name;
        tab.querySelector('.strategy-tab-count').textContent = count;
        if (remove) {
          remove.setAttribute('aria-label', 'Remove ' + name);
          remove.title = 'Remove ' + name;
          remove.tabIndex = tab.tabIndex;
        }
      }
    }

    function conditionRow(condition, index, exit) {
      const options = Object.entries(exit ? exitTypes : conditionTypes)
        .map(
          ([value, label]) =>
            `<option value="${value}"${condition.type === value ? ' selected' : ''}>${label}</option>`,
        )
        .join('');
      return `<div class="strategy-condition" data-index="${index}">
        <select data-field="type">${options}</select>
        <span class="rule-number">
          <input${!exit && index === 0 ? ' id="threshold"' : ''} type="number" data-field="value" min="${priceLimits.min}" max="${priceLimits.max}" step="${priceLimits.step}" value="${escape(condition.amount)}" required>
          <span class="rule-unit" aria-hidden="true">${unitFor(condition.type)}</span>
        </span>
        <button type="button" data-action="remove-condition" class="strategy-remove-rule" aria-label="Remove ${exit ? 'exit' : 'entry'} condition ${index + 1}" title="Remove ${exit ? 'exit' : 'entry'} condition ${index + 1}"${!exit && active.conditions.length === 1 ? ' disabled' : ''}>${icon('remove')}</button>
      </div>`;
    }

    function conditionsFor(element) {
      return element.closest('.strategy-rules').dataset.group === 'exit' ? active.exitConditions : active.conditions;
    }

    function syncRules() {
      const side = active.side === 'no' ? 'No' : 'Yes';
      for (const row of panel.querySelectorAll('.strategy-condition')) {
        const index = Number(row.dataset.index);
        const condition = conditionsFor(row)[index];
        const group = row.closest('.strategy-rules').dataset.group;
        const unit = unitFor(condition.type) === 'pp' ? 'percentage points' : 'percent';
        const label = (group === 'exit' ? 'Exit' : 'Entry') + ' condition ' + (index + 1);
        row
          .querySelector('[data-field="type"]')
          .setAttribute('aria-label', label + ' on the ' + side + ' price');
        row
          .querySelector('[data-field="value"]')
          .setAttribute(
            'aria-label',
            label + ', ' + side + ' price, ' + exitTypes[condition.type].toLowerCase() + ', ' + unit,
          );
        const suffix = row.querySelector('.rule-unit');
        suffix.textContent = unitFor(condition.type);
        suffix.title = unit;
      }
      const reference =
        side === 'Yes'
          ? 'Uses the daily observed Yes price.'
          : 'Uses the No price implied by 100% minus the observed Yes price.';
      const consecutive = active.conditions.some((c) => dayComparisonTypes.has(c.type))
        ? ' Changes and crossings compare consecutive UTC days.'
        : '';
      field('[data-group="entry"] .strategy-rule-help').textContent = reference + consecutive;
      const fromEntry = active.exitConditions.some((c) => c.type === 'gainFromEntry' || c.type === 'lossFromEntry');
      field('[data-group="exit"] .strategy-rule-help').textContent = active.exitConditions.length
        ? 'Sell ' + side + ' at the following UTC day’s close if a tradable price is available.' +
          (fromEntry ? ' Gains and losses use percentage points from the entry price.' : '')
        : 'Without an exit rule, hold until settlement or the live replay cutoff.';
    }

    function ruleGroup(exit) {
      const group = exit ? 'exit' : 'entry';
      const title = exit ? 'Exit' : 'Entry';
      const rules = exit ? active.exitConditions : active.conditions;
      const match = exit ? active.exitMatch : active.match;
      return `<div class="strategy-rules" data-group="${group}" role="group" aria-labelledby="${group}-rules-label">
        <div class="strategy-rules-head">
          <h3 id="${group}-rules-label">${title} conditions</h3>
          <select id="${exit ? 'strategy-exit-match' : 'strategy-match'}" class="strategy-match" aria-label="Combine ${group} conditions"${rules.length < 2 ? ' hidden' : ''}>
            <option value="all"${match === 'all' ? ' selected' : ''}>Match all (AND)</option>
            <option value="any"${match === 'any' ? ' selected' : ''}>Match any (OR)</option>
          </select>
        </div>
        <div class="strategy-condition-list">${rules.map((c, i) => conditionRow(c, i, exit)).join('')}</div>
        <button class="strategy-add-rule" type="button" data-action="${exit ? 'add-exit-condition' : 'add-condition'}">${icon('plus')} Add ${group} condition</button>
        <p class="strategy-rule-help"></p>
      </div>`;
    }

    function renderPanel() {
      panel.setAttribute('aria-labelledby', 'tab-' + active.id);
      panel.innerHTML = `
        <div class="strategy-name-field">
          <label for="strategy-name">Strategy name</label>
          <input id="strategy-name" type="text" autocomplete="off" required value="${escape(active.name)}">
        </div>
        <div class="strategy-position">
          <div class="strategy-side-field">
            <span class="strategy-field-label" id="strategy-side-label">Buy side</span>
            <div class="strategy-sides" role="group" aria-labelledby="strategy-side-label">
              <button type="button" data-side="yes" aria-pressed="${active.side === 'yes'}">Yes</button>
              <button type="button" data-side="no" aria-pressed="${active.side === 'no'}">No</button>
            </div>
          </div>
          <label class="strategy-stake" for="stake">Stake per contract
            <span class="rule-number"><input id="stake" type="number" min="${stakeLimits.min}" max="${stakeLimits.max}" step="${stakeLimits.step}" value="${escape(active.stake)}" required><span aria-hidden="true">USD</span></span>
          </label>
        </div>
        ${ruleGroup(false)}
        ${ruleGroup(true)}`;
      syncRules();
    }

    function select(id) {
      const target = drafts.find((draft) => draft.id === id);
      if (!target || target === active) return;
      active = target;
      syncTabs();
      renderPanel();
      onSelect(id);
    }

    function notify(kind, id = active.id) {
      onChange({ kind, id, activeId: active.id });
    }

    function focusTab() {
      field('[role="tab"][aria-selected="true"]').focus();
    }

    function removeStrategy(id) {
      const index = drafts.findIndex((draft) => draft.id === id);
      if (drafts.length === 1 || index < 0) return;
      drafts.splice(index, 1);
      if (active.id === id) {
        active = drafts[Math.min(index, drafts.length - 1)];
        renderPanel();
      }
      renderTabs();
      notify('remove', id);
      focusTab();
    }

    host.addEventListener('keydown', (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (!tab) return;
      if (event.key === 'Delete') {
        event.preventDefault();
        if (!event.repeat) removeStrategy(tab.dataset.strategyId);
        return;
      }
      const index = drafts.findIndex((draft) => draft.id === tab.dataset.strategyId);
      const keys = {
        ArrowRight: (index + 1) % drafts.length,
        ArrowLeft: (index - 1 + drafts.length) % drafts.length,
        Home: 0,
        End: drafts.length - 1,
      };
      if (!Object.hasOwn(keys, event.key)) return;
      event.preventDefault();
      select(drafts[keys[event.key]].id);
      focusTab();
    });

    host.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.dataset.strategyId) {
        select(button.dataset.strategyId);
        return;
      }
      if (button.dataset.side) {
        if (active.side === button.dataset.side) return;
        active.side = button.dataset.side;
        for (const side of panel.querySelectorAll('[data-side]'))
          side.setAttribute('aria-pressed', String(side.dataset.side === active.side));
        syncRules();
        notify('edit');
        return;
      }
      switch (button.dataset.action) {
        case 'add-strategy': {
          active = newStrategy();
          drafts.push(active);
          renderTabs();
          renderPanel();
          notify('add');
          field('#strategy-name').focus();
          field('#strategy-name').select();
          // Bring the new tab into view inside the horizontal tab strip.
          tabList.scrollLeft = tabList.scrollWidth;
          break;
        }
        case 'remove-strategy':
          removeStrategy(button.dataset.removeId);
          break;
        case 'add-condition':
        case 'add-exit-condition': {
          const group = button.closest('.strategy-rules').dataset.group;
          const rules = conditionsFor(button);
          const type = group === 'entry' ? 'risesBy' : rules.length ? 'lossFromEntry' : 'gainFromEntry';
          rules.push({ type, amount: type === 'gainFromEntry' ? '10' : '5' });
          renderPanel();
          notify('edit');
          panel.querySelector(`[data-group="${group}"] .strategy-condition:last-child select`).focus();
          break;
        }
        case 'remove-condition': {
          const group = button.closest('.strategy-rules').dataset.group;
          const rules = conditionsFor(button);
          if (group === 'entry' && rules.length === 1) return;
          const index = Number(button.closest('.strategy-condition').dataset.index);
          rules.splice(index, 1);
          renderPanel();
          notify('edit');
          const area = panel.querySelector(`[data-group="${group}"]`);
          const next = area.querySelectorAll('.strategy-condition select')[Math.min(index, rules.length - 1)];
          (next || area.querySelector('.strategy-add-rule')).focus();
          break;
        }
      }
    });

    host.addEventListener('change', (event) => {
      const input = event.target;
      if (input.id === 'strategy-match') active.match = input.value;
      else if (input.id === 'strategy-exit-match') active.exitMatch = input.value;
      else if (input.dataset.field === 'type') {
        const condition = conditionsFor(input)[Number(input.closest('.strategy-condition').dataset.index)];
        condition.type = input.value;
        syncRules();
      } else return;
      notify('edit');
    });

    host.addEventListener('input', (event) => {
      const input = event.target;
      if (input.id === 'strategy-name') {
        active.name = input.value;
        input.setCustomValidity('');
        syncTabs();
      } else if (input.id === 'stake') active.stake = input.value;
      else if (input.dataset.field === 'value') {
        conditionsFor(input)[Number(input.closest('.strategy-condition').dataset.index)].amount = input.value;
      } else return;
      notify('edit');
    });

    function list() {
      const rule = ({ type, amount }) => ({ type, value: asNumber(amount) / 100 });
      return drafts.map((draft) => ({
        id: draft.id,
        name: draft.name.trim(),
        side: draft.side,
        stake: asNumber(draft.stake),
        match: draft.match,
        conditions: draft.conditions.map(rule),
        exitMatch: draft.exitMatch,
        exitConditions: draft.exitConditions.map(rule),
      }));
    }

    // Mirror the visible number input's native constraints for inactive panels.
    const checkNumber = document.createElement('input');
    checkNumber.type = 'number';
    checkNumber.required = true;
    function numberIsValid(text, limits) {
      Object.assign(checkNumber, limits);
      checkNumber.value = text;
      return checkNumber.validity.valid;
    }

    function validate() {
      for (const draft of drafts) {
        let selector;
        if (!draft.name.trim()) selector = '#strategy-name';
        else if (!numberIsValid(draft.stake, stakeLimits)) selector = '#stake';
        else {
          for (const [group, rules] of [['entry', draft.conditions], ['exit', draft.exitConditions]]) {
            const invalid = rules.findIndex((c) => !numberIsValid(c.amount, priceLimits));
            if (invalid >= 0) {
              selector = `[data-group="${group}"] .strategy-condition[data-index="${invalid}"] [data-field="value"]`;
              break;
            }
          }
        }
        if (selector) {
          select(draft.id);
          const input = field(selector);
          if (selector === '#strategy-name') input.setCustomValidity('Give this strategy a name.');
          input.focus();
          input.reportValidity();
          return false;
        }
      }
      return true;
    }

    function setCounts(value) {
      counts = value instanceof Map ? new Map(value) : new Map(Object.entries(value || {}));
      syncTabs();
    }

    renderTabs();
    renderPanel();
    return { list, activeId: () => active.id, select, validate, setCounts };
  }

  window.ElectionStrategyEditor = Object.freeze({ create });
})();

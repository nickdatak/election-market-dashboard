(() => {
  'use strict';

  const day = 86400000;
  let chartId = 0;
  const date = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  function node(tag, className, label) {
    const element = document.createElement(tag);
    element.className = className;
    if (label !== undefined) element.textContent = label;
    return element;
  }

  function scaleFor(points) {
    let min = 0;
    let max = 0;
    for (const { pnl } of points) {
      min = Math.min(min, pnl);
      max = Math.max(max, pnl);
    }
    if (min === max) return { min: -1, max: 1, ticks: [1, 0.5, 0, -0.5, -1] };
    const target = Math.max((max - min) / 4, 0.01);
    const unit = 10 ** Math.floor(Math.log10(target));
    const step = [1, 2, 5, 10].find((n) => n * unit >= target) * unit;
    const top = Math.ceil(max / step);
    const bottom = Math.floor(min / step);
    const ticks = Array.from({ length: top - bottom + 1 }, (_, index) => (top - index) * step);
    return { min: ticks.at(-1), max: ticks[0], ticks };
  }

  function drawCurve(panel, points, live, { signedMoney, valueClass }, series = [], customTitle) {
    const title = customTitle || (live ? 'Marked portfolio P&L' : 'Realized portfolio P&L');
    panel.querySelector('h3').textContent = title;
    const readout = panel.querySelector('.curve-reading strong');
    const stamp = panel.querySelector('time');
    const plot = panel.querySelector('.equity-plot');
    const cursor = panel.querySelector('.equity-cursor');
    const labels = panel.querySelector('.equity-y');
    const dates = panel.querySelector('.equity-dates');
    const caption = panel.querySelector('.performance-note');
    caption.textContent = live
      ? 'Open positions use their latest daily mark. A sale fixes the position’s P&L after fees.'
      : 'Fees are booked at each fill. A sale or settlement realizes the position’s P&L.';

    const first = points[0].t;
    const duration = Math.max(1, points.at(-1).t - first);
    const scale = scaleFor(series.length ? series.flatMap((line) => line.points) : points);
    const x = (t) => ((t - first) / duration) * 1000;
    const y = (pnl) => ((scale.max - pnl) / (scale.max - scale.min)) * 160;
    const zeroY = y(0);
    const zeroOffset = zeroY / 160;
    const axisMoney = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: Math.max(Math.abs(scale.min), scale.max) >= 10000 ? 'compact' : 'standard',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });

    let grid = '';
    for (const tick of scale.ticks) {
      labels.append(node('span', '', axisMoney.format(tick)));
      const height = y(tick);
      grid += `<line class="equity-rule${tick === 0 ? ' zero' : ''}" x1="0" x2="1000" y1="${height}" y2="${height}"/>`;
    }
    const axisDate = duration <= day ? time : duration > 540 * day ? month : date;
    const startLabel = axisDate.format(first);
    const middleLabel = axisDate.format(first + duration / 2);
    const endLabel = axisDate.format(first + duration);
    dates.append(node('span', '', startLabel));
    if (middleLabel !== startLabel && middleLabel !== endLabel)
      dates.append(node('span', 'middle-date', middleLabel));
    dates.append(node('span', '', endLabel));

    function stepPath(observations) {
      let path = 'M0 ' + y(0).toFixed(3);
      for (const point of observations) path += 'H' + x(point.t).toFixed(3) + 'V' + y(point.pnl).toFixed(3);
      return path + 'H1000';
    }
    const line = stepPath(points);
    let flat = '';
    for (let i = 1; i < points.length; i++) {
      if (points[i - 1].pnl === 0) flat += `M${x(points[i - 1].t)} ${zeroY}H${x(points[i].t)}`;
    }
    const svg = plot.querySelector('svg');
    const gradientId = 'pnl-gradient-' + ++chartId;
    svg.innerHTML = `<defs>
        <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2="160">
          <stop offset="${zeroOffset}" stop-color="var(--gain)"/>
          <stop offset="${zeroOffset}" stop-color="var(--loss)"/>
        </linearGradient>
      </defs>${grid}
      <path class="equity-area" style="fill:url(#${gradientId})" d="${line}V${zeroY}H0Z"/>
      <path class="equity-line" style="stroke:url(#${gradientId})" d="${line}"/>
      <path class="equity-line equity-flat" d="${flat}"/>`;

    const legend = panel.querySelector('.curve-legend');
    const values = [];
    if (series.length) {
      svg.querySelectorAll('path').forEach((path) => path.remove());
      cursor.classList.add('compare');
      for (const [i, item] of series.entries()) {
        const color = 'hsl(' + (245 + i * 137.51) % 360 + ' 65% var(--curve-lightness))';
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', stepPath(item.points));
        path.setAttribute('class', 'equity-line strategy-line');
        path.style.stroke = color;
        if (i % 3) path.setAttribute('stroke-dasharray', i % 3 === 1 ? '7 3' : '2 3');
        svg.append(path);
        const row = node('li', 'legend-item');
        const swatch = node('i', '');
        swatch.style.borderColor = color;
        swatch.style.borderTopStyle = ['solid', 'dashed', 'dotted'][i % 3];
        const value = node('strong', '');
        row.append(swatch, node('span', '', item.name), value);
        legend.append(row);
        values.push(value);
      }
      readout.hidden = true;
    }
    function valueAt(rows, t) {
      let low = 0, high = rows.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (rows[mid].t <= t) low = mid + 1;
        else high = mid;
      }
      return low ? rows[low - 1].pnl : 0;
    }

    plot.setAttribute('aria-label', title + ' in US dollars by observation');
    plot.setAttribute('aria-valuemax', String(points.length));
    let active = -1;
    function select(index) {
      if (index === active) return;
      active = index;
      const { t, pnl } = points[index];
      const iso = new Date(t).toISOString();
      const clock = iso.slice(17, 19) === '00' ? time.format(t) : iso.slice(11, 19);
      const when = date.format(t) + ' · ' + clock + ' UTC';
      const value = signedMoney(pnl);
      const tone = valueClass(pnl);
      readout.className = tone;
      readout.textContent = value;
      stamp.dateTime = iso;
      stamp.textContent = when;
      cursor.className = 'equity-cursor ' + (series.length ? 'compare' : tone);
      cursor.style.left = x(t) / 10 + '%';
      cursor.style.setProperty('--mark-height', (y(pnl) / 160) * 100 + '%');
      plot.setAttribute('aria-valuenow', String(index + 1));
      const readings = series.map((item, i) => {
        const pnl = valueAt(item.points, t);
        values[i].textContent = signedMoney(pnl);
        values[i].className = valueClass(pnl);
        return item.name + ' ' + values[i].textContent;
      });
      plot.setAttribute('aria-valuetext', when + ', ' + (readings.length ? readings.join(', ') : value));
    }
    function inspect(event) {
      const bounds = plot.getBoundingClientRect();
      const target =
        first + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * duration;
      let low = 0;
      let high = points.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (points[middle].t < target) low = middle + 1;
        else high = middle;
      }
      if (low > 0 && target - points[low - 1].t <= points[low].t - target) low--;
      select(low);
    }
    plot.addEventListener('pointerdown', inspect);
    plot.addEventListener('pointermove', inspect);
    plot.addEventListener('pointerleave', () => {
      if (document.activeElement !== plot) select(points.length - 1);
    });
    plot.addEventListener('blur', () => select(points.length - 1));
    plot.addEventListener('keydown', (event) => {
      const keys = {
        ArrowLeft: active - 1,
        ArrowDown: active - 1,
        ArrowRight: active + 1,
        ArrowUp: active + 1,
        Home: 0,
        End: points.length - 1,
      };
      if (!Object.hasOwn(keys, event.key)) return;
      event.preventDefault();
      select(Math.max(0, Math.min(keys[event.key], points.length - 1)));
    });
    select(points.length - 1);
  }

  function drawComparison(panel, strategies, live, { signedMoney, returnText, valueClass }) {
    const rows = panel.querySelector('.strategy-bars');
    const buttons = panel.querySelectorAll('button');
    const axis = panel.querySelector('.strategy-axis');
    const caption = panel.querySelector('.performance-note');
    function show(metric) {
      const roi = metric === 'roi';
      const resolution = roi ? 0.0001 : 0.01;
      const format = roi ? (n) => (n >= resolution / 2 ? '+' : '') + returnText(n) : signedMoney;
      const values = strategies.map(({ totals }) => (totals.count ? totals[metric] : null));
      const limit = values.reduce((max, value) => Math.max(max, Math.abs(value || 0)), resolution);
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.value === metric));
      rows.replaceChildren();
      strategies.forEach(({ name }, i) => {
        const value = values[i];
        const tone = valueClass(value, resolution);
        const row = node('li', 'strategy-bar-row');
        const header = node('div', 'strategy-bar-label');
        header.append(node('span', '', name), node('strong', tone, value === null ? '—' : format(value)));
        row.append(header);
        if (value !== null) {
          const track = node('div', 'strategy-bar-track');
          track.setAttribute('aria-hidden', 'true');
          const bar = node('i', 'strategy-bar ' + (tone || 'neutral'));
          const width = tone ? (Math.abs(value) / limit) * 50 : 0;
          if (tone) bar.style.width = width + '%';
          bar.style.left = (value < 0 ? 50 - width : 50) + '%';
          track.append(bar);
          row.append(track);
        }
        rows.append(row);
      });
      axis.replaceChildren(...[-limit, 0, limit].map((value) => node('span', '', format(value))));
      caption.textContent = roi
        ? (live ? 'Net' : 'Realized') + ' P&L divided by stakes plus entry fees.'
        : (live ? 'Net' : 'Realized') + ' P&L across each strategy’s trades.';
    }
    buttons.forEach((button) => button.addEventListener('click', () => show(button.value)));
    show('roi');
  }

  function draw(host, result, formatters) {
    const live = result.settings.mode === 'live' || result.settings.mode === 'trading';
    const helpId = 'equity-help-' + ++chartId;
    const curve = live ? result.markedEquity : result.equity;
    host.className = 'performance-charts';
    host.setAttribute('aria-live', 'off');
    host.innerHTML = `
      <section class="performance-panel performance-history">
        <div class="performance-head"><h3></h3><select aria-label="P&amp;L chart view" class="curve-view"></select></div>
        <div class="curve-body"><div class="curve-reading"><strong></strong><time></time></div>
        <ul class="curve-legend"></ul><div class="equity-grid">
          <div class="equity-y" aria-hidden="true"></div>
          <div class="equity-plot" role="slider" tabindex="0" aria-valuemin="1" aria-describedby="${helpId}">
            <svg aria-hidden="true" viewBox="0 0 1000 160" preserveAspectRatio="none"></svg>
            <div class="equity-cursor" aria-hidden="true"></div>
          </div>
          <div class="equity-dates" aria-hidden="true"></div>
        </div>
        <span id="${helpId}" class="sr-only">Use the arrow keys to inspect observations. Home and End select the first and last.</span>
        <p class="performance-note"></p></div>
      </section>
      <section class="performance-panel performance-strategies">
        <div class="performance-head">
          <h3>Strategy performance</h3>
          <div class="performance-switch" role="group" aria-label="Strategy comparison metric">
            <button type="button" value="roi">Return</button>
            <button type="button" value="profit">P&amp;L</button>
          </div>
        </div>
        <ul class="strategy-bars"></ul>
        <div class="strategy-axis" aria-hidden="true"></div>
        <p class="performance-note"></p>
      </section>`;
    const history = host.querySelector('.performance-history');
    if (curve?.length) {
      const picker = history.querySelector('.curve-view');
      picker.add(new Option('Portfolio total', 'portfolio'));
      picker.add(new Option('Compare strategies', 'compare'));
      const series = result.strategies.map((s, i) => {
        picker.add(new Option(s.name, String(i)));
        return { name: s.name, points: (live ? s.markedEquity : s.equity) || [] };
      });
      const template = history.querySelector('.curve-body').cloneNode(true);
      picker.value = series.length > 1 ? 'compare' : 'portfolio';
      function drawView() {
        history.querySelector('.curve-body').replaceWith(template.cloneNode(true));
        const view = picker.value;
        const item = view === 'portfolio' || view === 'compare' ? null : series[Number(view)];
        if (item && !item.points.length) {
          history.querySelector('h3').textContent = item.name;
          history.querySelector('.curve-body').replaceChildren(node('p', 'performance-note', 'No trades for this strategy.'));
          return;
        }
        drawCurve(history, item ? item.points : curve, live, formatters, view === 'compare' ? series : [],
          view === 'compare' ? 'Strategy P&L over time' : item ? item.name + ' P&L' :
            live && result.totals.soldCount ? 'Net portfolio P&L' : '');
      }
      picker.addEventListener('change', drawView);
      drawView();
    } else history.remove();
    drawComparison(host.querySelector('.performance-strategies'), result.strategies, live, formatters);
  }

  window.ElectionBacktestCharts = Object.freeze({ draw });
})();

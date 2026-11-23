(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const DAY = 86400;
  const charts = new WeakMap();
  const seriesPatterns = ['solid', 'dashed', 'dotted'];
  const axisDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const axisTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const longDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  let nextId = 0;

  function element(tag, attributes, content) {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes || {})) node.setAttribute(name, value);
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function clear(host) {
    const chart = charts.get(host);
    if (chart) {
      chart.abort.abort();
      chart.observer?.disconnect();
      charts.delete(host);
    }
    host.replaceChildren();
  }

  function nearest(items, target, time) {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (time(items[mid]) < target) low = mid + 1;
      else high = mid;
    }
    if (low === 0) return 0;
    if (low === items.length) return low - 1;
    return target - time(items[low - 1]) <= time(items[low]) - target ? low - 1 : low;
  }

  function percentage(value) {
    return Number((value * 100).toFixed(2)) + '%';
  }

  function scaleY(series, height) {
    let min = 1;
    let max = 0;
    for (const line of series) {
      for (const { p } of line.points) {
        min = Math.min(min, p);
        max = Math.max(max, p);
      }
    }
    const padding = Math.max(0.006, (max - min) * 0.05);
    const bottom = Math.max(0, min - padding);
    const top = Math.min(1, max + padding);
    const targetStep = (top - bottom) / (height >= 170 ? 5 : 4);
    const steps = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
    const step = steps.find((value) => value >= targetStep) || 1;
    const firstIndex = Math.floor(bottom / step);
    const lastIndex = Math.ceil(top / step);
    const ticks = [];
    for (let i = firstIndex; i <= lastIndex; i++) ticks.push(i * step);
    return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
  }

  function segmentsFor(points, gap, daily) {
    const groups = [];
    let group;
    for (const point of points) {
      const previous = group?.at(-1);
      if (!previous || (daily ? Math.floor(point.t / DAY) - Math.floor(previous.t / DAY) > 1 : point.t - previous.t > gap)) {
        group = [];
        groups.push(group);
      }
      group.push(point);
    }
    return groups;
  }

  function draw(host, { series = [], start, end, dark = false, daily = false, fills = [] } = {}) {
    clear(host);
    const selected = series
      .map((line, index) => {
        const distinct = new Map();
        for (const point of line.points || []) {
          if (!point || !Number.isFinite(point.t) || !Number.isFinite(point.p) || point.p < 0 || point.p > 1)
            continue;
          if ((Number.isFinite(start) && point.t < start) || (Number.isFinite(end) && point.t > end))
            continue;
          distinct.set(point.t, point);
        }
        return {
          name: line.name,
          color: line.color || `var(--plot-series-${(index % seriesPatterns.length) + 1}, currentColor)`,
          pattern: line.pattern || seriesPatterns[index % seriesPatterns.length],
          points: [...distinct.values()].sort((a, b) => a.t - b.t),
        };
      })
      .filter((line) => line.points.length);

    if (!selected.length) {
      const message = document.createElement('div');
      message.className = 'chart-msg';
      message.textContent = 'No recorded prices in this period.';
      host.append(message);
      return;
    }

    // Align near-simultaneous records from different contracts for keyboard navigation.
    const observed = selected.flatMap((line) => line.points.map((point) => point.t)).sort((a, b) => a - b);
    const times = [];
    for (const t of observed) {
      if (!times.length || t - times[times.length - 1] > 60) times.push(t);
    }
    const from = Number.isFinite(start) ? start : observed[0];
    const to = Math.max(from + 1, Number.isFinite(end) ? end : observed[observed.length - 1]);
    const duration = to - from;
    const id = 'election-plot-' + ++nextId;
    const svg = element('svg', {
      role: 'group',
      tabindex: '0',
      'aria-label': 'Price history for ' + selected.map((line) => line.name).join(', '),
      'aria-describedby': id + '-help',
      width: '100%',
      height: '100%',
    });
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.id = id + '-reading';
    tip.hidden = true;
    tip.setAttribute('role', 'status');
    tip.setAttribute('aria-live', 'polite');
    host.append(svg, tip);
    const abort = new AbortController();
    const events = { signal: abort.signal };
    let g;
    let guide;
    let markers;
    let active = -1;
    let lastSize = '';

    function hide() {
      active = -1;
      tip.hidden = true;
      if (guide) guide.setAttribute('visibility', 'hidden');
      markers?.replaceChildren();
    }

    function show(index) {
      if (!g || index < 0 || index >= times.length) return;
      const t = times[index];
      const x = g.x(t);
      active = index;
      guide.setAttribute('visibility', 'visible');
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      markers.replaceChildren();
      tip.replaceChildren();
      const date = new Date(t * 1000);
      const heading = document.createElement('strong');
      heading.textContent = longDate.format(date) + ' · ' + axisTime.format(date) + ' UTC';
      tip.append(heading);
      // Different series can be sampled several seconds apart. Omit series with no nearby observation.
      const tolerance = Math.max(60, Math.min((duration / g.plotWidth) * 3, 6 * 3600));
      for (const line of selected) {
        const sample = line.points[nearest(line.points, t, (item) => item.t)];
        if (Math.abs(sample.t - t) > tolerance) continue;
        markers.append(
          element('circle', {
            cx: g.x(sample.t),
            cy: g.y(sample.p),
            r: 3.4,
            stroke: 'var(--plot-surface, Canvas)',
            'stroke-width': 1.4,
            fill: line.color,
          }),
        );
        const row = document.createElement('p');
        const dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.dataset.pattern = line.pattern;
        dot.style.setProperty('--series', line.color);
        const value = document.createElement('em');
        value.textContent = percentage(sample.p);
        row.title = new Date(sample.t * 1000).toISOString();
        row.append(dot, document.createTextNode(line.name), value);
        tip.append(row);
      }
      for (const fill of fills) {
        if (Math.abs(fill.t - t) > 60) continue;
        const note = document.createElement('p');
        note.textContent = fill.name + ' · ' + percentage(fill.p);
        tip.append(note);
      }
      tip.hidden = false;
      const space = g.width - x - 12;
      const left = space >= tip.offsetWidth ? x + 10 : x - tip.offsetWidth - 10;
      tip.style.left = Math.max(0, Math.min(left, g.width - tip.offsetWidth)) + 'px';
      tip.style.top = Math.max(0, Math.min(g.top + 3, g.height - tip.offsetHeight)) + 'px';
    }

    function render() {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width < 70 || height < 50 || width + 'x' + height === lastSize) return;
      lastSize = width + 'x' + height;
      const left = 43,
        right = width - 7,
        top = 10,
        bottom = height - 25;
      const scale = scaleY(selected, height);
      g = {
        width,
        height,
        left,
        right,
        top,
        bottom,
        plotWidth: right - left,
        x: (t) => left + ((t - from) / duration) * (right - left),
        y: (p) => bottom - ((p - scale.min) / (scale.max - scale.min)) * (bottom - top),
      };
      svg.replaceChildren(
        element(
          'desc',
          { id: id + '-help' },
          'Use left and right arrow keys to explore observations. Home and End jump to the first and last reading.',
        ),
      );
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      const defs = element('defs');
      const gradient = element('linearGradient', {
        id: id + '-area',
        x1: '0%',
        y1: '0%',
        x2: '0%',
        y2: '100%',
      });
      gradient.append(
        element('stop', { offset: '0%', 'stop-color': selected[0].color, 'stop-opacity': '.09' }),
        element('stop', { offset: '100%', 'stop-color': selected[0].color, 'stop-opacity': '.01' }),
      );
      defs.append(gradient);
      svg.append(defs);

      const font = {
        fill: 'var(--plot-label, currentColor)',
        'font-family': 'var(--sans, Montserrat, sans-serif)',
        'font-size': '11.5',
        'font-weight': '460',
      };
      for (const tick of scale.ticks) {
        const y = g.y(tick);
        svg.append(
          element('line', {
            x1: left,
            x2: right,
            y1: y,
            y2: y,
            stroke: 'var(--plot-grid, GrayText)',
            'stroke-width': '.85',
          }),
          element('text', { ...font, x: left - 6, y: y + 3, 'text-anchor': 'end' }, percentage(tick)),
        );
      }
      const count = Math.max(2, Math.min(7, Math.floor(g.plotWidth / 78) + 1));
      for (let i = 0; i < count; i++) {
        const t = from + (duration * i) / (count - 1);
        const date = new Date(t * 1000);
        const text = duration < 2 * DAY ? axisTime.format(date) : axisDate.format(date);
        svg.append(
          element(
            'text',
            {
              ...font,
              x: g.x(t),
              y: height - 4,
              'text-anchor': i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle',
            },
            text,
          ),
        );
      }
      const gap = duration >= 15 * DAY ? 3 * DAY + 60 : Math.min(3 * DAY, Math.max(3600, duration / 8));
      for (const [i, line] of selected.entries()) {
        for (const group of segmentsFor(line.points, gap, daily)) {
          const first = group[0];
          const last = group[group.length - 1];
          const d = group
            .map(
              (point, index) =>
                (index === 0 ? 'M' : 'L') + g.x(point.t).toFixed(2) + ' ' + g.y(point.p).toFixed(2),
            )
            .join(' ');
          if (i === 0 && dark && group.length > 1) {
            svg.append(
              element('path', {
                d: d + ' L' + g.x(last.t) + ' ' + bottom + ' L' + g.x(first.t) + ' ' + bottom + ' Z',
                fill: 'url(#' + id + '-area)',
              }),
            );
          }
          if (group.length === 1) {
            svg.append(element('circle', { cx: g.x(first.t), cy: g.y(first.p), r: 1.7, fill: line.color }));
          } else {
            svg.append(
              element('path', {
                d,
                stroke: line.color,
                'stroke-width': 2,
                'data-pattern': line.pattern,
                fill: 'none',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
              }),
            );
          }
        }
        const last = line.points[line.points.length - 1];
        svg.append(
          element('circle', {
            cx: g.x(last.t),
            cy: g.y(last.p),
            r: 3.0,
            fill: line.color,
            stroke: 'var(--plot-surface, Canvas)',
            'stroke-width': 1.3,
          }),
        );
      }
      for (const fill of fills) {
        if (fill.t < from || fill.t > to) continue;
        const x = g.x(fill.t), y = g.y(fill.p), up = fill.action === 'Buy';
        const path = element('path', {
          d: up ? `M${x},${y-4}l4,7h-8z` : `M${x},${y+4}l4,-7h-8z`,
          fill: up ? 'var(--gain)' : 'var(--loss)', stroke: 'var(--plot-surface, Canvas)',
          'stroke-width': 1, 'data-fill': fill.action,
        });
        path.append(element('title', {}, fill.name + ' · ' + percentage(fill.p) + ' · ' + longDate.format(fill.t * 1000)));
        svg.append(path);
      }
      guide = element('line', {
        y1: top,
        y2: bottom,
        stroke: 'var(--plot-guide, currentColor)',
        'stroke-width': 1,
        'stroke-dasharray': '3 3',
        visibility: 'hidden',
        'pointer-events': 'none',
      });
      markers = element('g', { 'pointer-events': 'none' });
      svg.append(guide, markers);
      if (active >= 0) show(active);
    }

    svg.addEventListener(
      'pointermove',
      (event) => {
        if (!g) return;
        const x = event.clientX - svg.getBoundingClientRect().left;
        if (x < g.left || x > g.right) return hide();
        const index = nearest(times, from + ((x - g.left) / g.plotWidth) * duration, (value) => value);
        if (index !== active) show(index);
      },
      events,
    );
    svg.addEventListener('pointerleave', hide, events);
    svg.addEventListener('focus', () => show(times.length - 1), events);
    svg.addEventListener('blur', hide, events);
    svg.addEventListener(
      'keydown',
      (event) => {
        let next;
        if (event.key === 'ArrowLeft') next = active < 0 ? times.length - 1 : Math.max(0, active - 1);
        else if (event.key === 'ArrowRight') next = Math.min(times.length - 1, active + 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = times.length - 1;
        else if (event.key === 'Escape') return hide();
        else return;
        event.preventDefault();
        show(next);
      },
      events,
    );
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(render) : null;
    if (observer) observer.observe(host);
    else window.addEventListener('resize', render, events);
    charts.set(host, { abort, observer });
    render();
  }

  window.ElectionChart = Object.freeze({ draw, clear });
})();

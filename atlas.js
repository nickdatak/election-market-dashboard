(() => {
  'use strict';

  function countrySilhouette(canvas, feature) {
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!feature?.geometry || !feature.center) return;
    const rad = Math.PI / 180;
    const [lon, lat] = feature.center.map((v) => v * rad);
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const parts = [];
    for (const rings of polygons) {
      let area = 0,
        visible = 0;
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      const path = new Path2D();
      for (let j = 0; j < rings.length; j++) {
        let previous;
        for (const [longitude, latitude] of rings[j]) {
          const delta = longitude * rad - lon;
          const phi = latitude * rad;
          const east = Math.cos(phi) * Math.sin(delta);
          const north = Math.cos(lat) * Math.sin(phi) - Math.sin(lat) * Math.cos(phi) * Math.cos(delta);
          if (!previous) path.moveTo(east, -north);
          else path.lineTo(east, -north);
          if (j === 0) {
            if (previous) area += previous[0] * north - east * previous[1];
            if (Math.sin(lat) * Math.sin(phi) + Math.cos(lat) * Math.cos(phi) * Math.cos(delta) > 0)
              visible++;
            bounds[0] = Math.min(bounds[0], east);
            bounds[1] = Math.min(bounds[1], -north);
            bounds[2] = Math.max(bounds[2], east);
            bounds[3] = Math.max(bounds[3], -north);
          }
          previous = [east, north];
        }
        path.closePath();
      }
      if (visible > rings[0].length / 2) parts.push({ path, bounds, area: Math.abs(area) });
    }
    if (!parts.length) return;
    const largest = Math.max(...parts.map((part) => part.area));
    function extent(parts) {
      return [
        Math.min(...parts.map((part) => part.bounds[0])),
        Math.min(...parts.map((part) => part.bounds[1])),
        Math.max(...parts.map((part) => part.bounds[2])),
        Math.max(...parts.map((part) => part.bounds[3])),
      ];
    }
    // Fit the main land and surrounding islands. A distant, small overseas
    // territory otherwise reduces the recognizable outline to just a few pixels.
    const main = extent(parts.filter((part) => part.area >= largest * 0.2));
    const margin = Math.max(main[2] - main[0], main[3] - main[1]) * 0.25;
    const nearby = parts.filter(({ bounds: [x1, y1, x2, y2] }) => {
      const x = (x1 + x2) / 2,
        y = (y1 + y2) / 2;
      return x >= main[0] - margin && y >= main[1] - margin && x <= main[2] + margin && y <= main[3] + margin;
    });
    const [left, top, right, bottom] = extent(nearby);
    const scale = Math.min((canvas.width - 9) / (right - left), (canvas.height - 9) / (bottom - top));
    if (!Number.isFinite(scale)) return;
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      (canvas.width - scale * (right + left)) / 2,
      (canvas.height - scale * (bottom + top)) / 2,
    );
    const light = document.documentElement.dataset.theme === 'light';
    ctx.fillStyle = light ? 'rgba(83,73,103,.10)' : 'rgba(203,201,222,.1)';
    ctx.strokeStyle = light ? 'rgba(79,68,100,.85)' : 'rgba(211,209,227,.79)';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.55 / scale;
    for (const { path } of nearby) {
      ctx.fill(path, 'evenodd');
      ctx.stroke(path);
    }
  }

  function create({ openMarket, showCountry, loadMore, sourceName, sourceTag, cents }) {
    const $ = (id) => document.getElementById(id);
    const canvas = $('atlas-canvas');
    const select = $('atlas-country');
    const tip = $('atlas-tip');
    const callouts = $('atlas-callouts');
    const shape = $('country-shape');
    const features = new Map(window.ElectionCountries.features.map((f) => [f.id, f]));
    const countryName = (id) => features.get(id)?.name || '';
    const membership = new WeakMap();
    const byCountry = new Map();
    let current = null,
      pinned = null,
      hovering = null;
    let shownMarkets = [];
    let shapeId,
      labelOrder = [];
    const element = (type, cls, text) => {
      const el = document.createElement(type);
      el.className = cls;
      el.textContent = text;
      return el;
    };

    function makeLabel() {
      const tag = element('div', 'map-callout', '');
      const name = element('span', 'map-callout-name', '');
      const count = element('span', 'map-callout-count', '');
      tag.append(name, count);
      return { tag, name, count };
    }
    function fillLabel(label, id) {
      const n = byCountry.get(id).length;
      if (label.tag.dataset.country === id && label.tag.dataset.count === String(n)) return;
      label.tag.dataset.country = id;
      label.tag.dataset.count = String(n);
      label.name.textContent = countryName(id);
      label.count.textContent = n.toLocaleString('en-US') + (n === 1 ? ' contract' : ' contracts');
    }
    const labels = Array.from({ length: 2 }, () => {
      const label = makeLabel();
      const { tag } = label;
      tag.hidden = true;
      callouts?.append(tag);
      return label;
    });
    const panels = [
      ...document.querySelectorAll(
        '.mast, .page-head, .atlas-intro, #atlas-card, .atlas-navigation, #atlas-more',
      ),
    ];
    const labelBoxes = new Map();
    let measuredWidth = 0;

    function measureLabels(origin) {
      // Measure once per data/viewport change. The CSS controls the actual
      // offset, wrapping and compact treatment of each country name and count.
      const sample = document.createElement('div');
      sample.style.cssText = 'position:absolute;inset:0;visibility:hidden;pointer-events:none';
      const nodes = labelOrder.map((id) => {
        const label = makeLabel();
        fillLabel(label, id);
        label.tag.style.left = label.tag.style.top = '0px';
        sample.append(label.tag);
        return label.tag;
      });
      callouts.append(sample);
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        labelBoxes.set(node.dataset.country, {
          x: rect.left - origin.left,
          y: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        });
      }
      sample.remove();
      measuredWidth = window.innerWidth;
    }

    function positionLabels(projectCountry) {
      if (!callouts || !projectCountry || !callouts.getClientRects().length) return;
      const canvasRect = canvas.getBoundingClientRect();
      if (canvasRect.bottom <= 0 || canvasRect.top >= window.innerHeight) return;
      if (measuredWidth !== window.innerWidth) measureLabels(callouts.getBoundingClientRect());
      const occupied = panels
        .map((el) => el.getBoundingClientRect())
        .filter((box) => box.width && box.height);
      let used = 0;
      for (const id of labelOrder) {
        const point = projectCountry(id);
        if (!point || point.depth < 0.24) continue;
        const size = labelBoxes.get(id);
        const left = canvasRect.left + point.x + size.x;
        const top = canvasRect.top + point.y + size.y;
        const right = left + size.width;
        const bottom = top + size.height;
        if (left < 6 || top < 6 || right > window.innerWidth - 6 || bottom > window.innerHeight - 6) continue;
        if (
          occupied.some(
            (box) =>
              left < box.right + 8 && right > box.left - 8 && top < box.bottom + 8 && bottom > box.top - 8,
          )
        )
          continue;
        const label = labels[used++];
        fillLabel(label, id);
        label.tag.style.left = point.x.toFixed(2) + 'px';
        label.tag.style.top = point.y.toFixed(2) + 'px';
        label.tag.hidden = false;
        occupied.push({ left, top, right, bottom });
        if (used === labels.length) break;
      }
      for (let i = used; i < labels.length; i++) labels[i].tag.hidden = true;
    }

    function hideTip() {
      tip.hidden = true;
      if (callouts?.hidden) {
        callouts.hidden = false;
        queueLabels();
      }
    }

    function countriesFor(market) {
      if (!membership.has(market)) {
        membership.set(
          market,
          window.ElectionGeography.countryIds(market).filter((id) => features.has(id)),
        );
      }
      return membership.get(market);
    }

    function renderCard() {
      const markets = byCountry.get(current) || [];
      const country = countryName(current);
      if (current !== shapeId) {
        shapeId = current;
        countrySilhouette(shape, features.get(current));
      }
      $('atlas-card').dataset.pinned = String(Boolean(pinned));
      $('atlas-card').dataset.country = current || '';
      $('atlas-card-state').textContent = pinned ? 'Pinned country' : 'Country preview';
      $('atlas-unpin').hidden = !pinned;
      $('atlas-country-name').textContent = country || 'Country details';
      const venues = new Set(markets.map((m) => m.source)).size;
      $('atlas-country-summary').textContent = markets.length
        ? markets.length.toLocaleString('en-US') +
          ' ' +
          (markets.length === 1 ? 'contract' : 'contracts') +
          ' · ' +
          venues +
          ' ' +
          (venues === 1 ? 'exchange' : 'exchanges')
        : '';
      // Give different elections in a country a place in the limited preview.
      const events = new Set();
      const first = [],
        remaining = [];
      for (const m of markets) {
        const name = m.eventTitle || m.title;
        (events.has(name) ? remaining : first).push(m);
        events.add(name);
      }
      shownMarkets = first.concat(remaining).slice(0, 3);
      const items = shownMarkets.map((market, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.index = String(index);
        button.setAttribute('aria-label', 'Open ' + market.title + ' on ' + sourceName(market.source));
        const body = document.createElement('span');
        body.append(element('span', 'atlas-market-name', market.eventTitle || market.title));
        const label = market.label?.trim() || '';
        const sub = element('span', 'atlas-market-sub', '');
        if (label && label.toLowerCase() !== 'yes') {
          const outcome = label.toLowerCase() === 'no' ? element('span', 'outcome-no', label) : label;
          sub.append(outcome, ' · ');
        }
        if (sourceTag) sub.insertAdjacentHTML('beforeend', sourceTag(market.source));
        else sub.append(sourceName(market.source));
        body.append(sub);
        const price = element('span', 'atlas-market-price', cents(market.price));
        if (Number.isFinite(market.price)) price.classList.add('outcome-yes');
        price.title = 'Yes price';
        button.append(body, price);
        return button;
      });
      if (!items.length)
        items.push(
          element(
            'p',
            'atlas-no-data',
            country
              ? 'No active contracts are mapped here in the loaded listings.'
              : 'Load election markets to explore their countries.',
          ),
        );
      $('atlas-contracts').replaceChildren(...items);
      $('atlas-open-country').hidden = !markets.length;
      $('atlas-open-country').setAttribute('aria-label', 'Explore contracts in ' + country);
    }

    function preview(id, position) {
      hovering = id;
      if (!id) {
        hideTip();
        if (!pinned && current && !byCountry.has(current)) {
          current = preferredCountry();
          renderCard();
        }
        return;
      }
      if (!pinned && id !== current) {
        current = id;
        renderCard();
      }
      if (position) positionTip(position);
    }
    function pin(id, recenter = false) {
      if (!features.has(id)) {
        unpin();
        return;
      }
      pinned = id;
      current = id;
      renderer?.setSelected(id);
      if (recenter) renderer?.focus(id);
      select.value = byCountry.has(id) ? id : '';
      renderCard();
      $('atlas-announce').textContent =
        countryName(id) + ' pinned. ' + $('atlas-country-summary').textContent;
    }
    function preferredCountry() {
      let best = null,
        size = 0;
      for (const [id, markets] of byCountry) {
        if (markets.length > size) {
          best = id;
          size = markets.length;
        }
      }
      return best;
    }
    function unpin() {
      pinned = null;
      renderer?.setSelected(null);
      select.value = '';
      if (!byCountry.has(current)) current = preferredCountry();
      renderCard();
      $('atlas-announce').textContent = 'Country preview unlocked.';
    }

    // The picker and market overlay also work when a browser has canvas rendering disabled.
    let renderer = null;
    if (canvas.getContext?.('2d'))
      renderer = window.ElectionGlobe.create(canvas, {
        motionRegion: $('atlas').parentElement,
        onHover: preview,
        onSelect: (id) => (id ? pin(id) : unpin()),
        onViewChange: positionLabels,
      });
    if (!renderer) {
      canvas.hidden = true;
      $('atlas-fallback').hidden = false;
      for (const id of ['atlas-west', 'atlas-east', 'atlas-reset']) $(id).disabled = true;
    }
    let labelFrame = 0;
    function queueLabels() {
      if (labelFrame || !renderer) return;
      labelFrame = requestAnimationFrame(() => {
        labelFrame = 0;
        positionLabels(renderer.projectCountry);
      });
    }
    window.addEventListener('scroll', queueLabels, { passive: true });
    window.addEventListener('hashchange', queueLabels);
    window.addEventListener('electionthemechange', () => countrySilhouette(shape, features.get(current)));
    function positionTip(event) {
      if (event.pointerType === 'touch' || event.buttons || !hovering) {
        hideTip();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      tip.textContent = countryName(hovering);
      tip.hidden = false;
      if (callouts) callouts.hidden = true;
      const left = event.clientX - rect.left + 12;
      const top = event.clientY - rect.top - 30;
      tip.style.left = Math.max(4, Math.min(left, rect.width - tip.offsetWidth - 4)) + 'px';
      tip.style.top = Math.max(4, Math.min(top, rect.height - tip.offsetHeight - 4)) + 'px';
    }
    canvas.addEventListener('pointermove', positionTip);
    canvas.addEventListener('pointerleave', hideTip);
    canvas.addEventListener('pointerdown', hideTip);
    const steps = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, 15], ArrowDown: [0, -15] };
    function rotate(lon, lat) {
      hovering = null;
      hideTip();
      renderer?.rotate(lon, lat);
    }
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        renderer?.slowRotation();
      }
      if (Object.hasOwn(steps, e.key)) {
        e.preventDefault();
        rotate(...steps[e.key]);
      }
      if (e.key === 'Escape') unpin();
    });
    $('atlas-west').onclick = () => rotate(-25, 0);
    $('atlas-east').onclick = () => rotate(25, 0);
    $('atlas-reset').onclick = () => {
      hovering = null;
      hideTip();
      current = preferredCountry();
      unpin();
      renderer?.reset();
    };
    $('atlas-unpin').onclick = () => {
      unpin();
      select.focus({ preventScroll: true });
    };
    select.onchange = () => (select.value ? pin(select.value, true) : unpin());
    $('atlas-contracts').onclick = (e) => {
      const button = e.target.closest('button[data-index]');
      if (button && shownMarkets[Number(button.dataset.index)])
        openMarket(shownMarkets[Number(button.dataset.index)]);
    };
    $('atlas-open-country').onclick = () => {
      if (current && byCountry.has(current)) showCountry(current);
    };
    $('atlas-more').onclick = loadMore;

    function update(markets) {
      byCountry.clear();
      let mapped = 0;
      for (const market of markets) {
        const ids = countriesFor(market);
        if (ids.length) mapped++;
        for (const id of ids) {
          if (!byCountry.has(id)) byCountry.set(id, []);
          byCountry.get(id).push(market);
        }
      }
      for (const [id, count] of [['atlas-location-count', byCountry.size], ['atlas-market-count', mapped]]) {
        const text = count.toLocaleString('en-US');
        $(id).textContent = text;
        $(id).style.setProperty('--count-chars', text.length);
      }
      $('atlas-market-count').parentElement.title =
        mapped.toLocaleString('en-US') + ' of ' + markets.length.toLocaleString('en-US') + ' open contracts have a mapped location. One election can have many contracts.';
      const ids = [...byCountry.keys()].sort((a, b) => countryName(a).localeCompare(countryName(b), 'en'));
      if (select.length !== ids.length + 1 || ids.some((id, i) => select.options[i + 1].value !== id)) {
        select.replaceChildren(
          new Option('Find a country', ''),
          ...ids.map((id) => new Option(countryName(id), id)),
        );
      }
      select.disabled = !ids.length;
      select.value = pinned && byCountry.has(pinned) ? pinned : '';
      renderer?.setActive(ids);
      labelOrder = ids.slice().sort((a, b) => byCountry.get(b).length - byCountry.get(a).length);
      labelBoxes.clear();
      measuredWidth = 0;
      if (!pinned) {
        if (hovering) current = hovering;
        else if (!byCountry.has(current)) current = preferredCountry();
      }
      renderCard();
      positionLabels(renderer?.projectCountry);
    }
    function requestState({ busy, message }) {
      $('atlas-more').lastElementChild.textContent = busy ? 'Cancel fetch' : 'Fetch all live contracts';
      $('atlas-more').firstElementChild.hidden = busy;
      $('atlas-more').title = busy ? 'Cancel the current search' : 'Fetch every available active election contract on both exchanges';
      $('atlas-status').textContent = message;
      $('atlas-status').hidden = !message;
    }
    function setInteractive(enabled) {
      const map = $('atlas-map');
      map.inert = !enabled;
      map.setAttribute('aria-hidden', String(!enabled));
      renderer?.setAutoRotate(enabled);
    }
    return { update, requestState, countryName, countriesFor, setInteractive };
  }
  window.ElectionAtlas = Object.freeze({ create });
})();

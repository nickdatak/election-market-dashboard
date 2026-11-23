(() => {
  'use strict';

  const RAD = Math.PI / 180;
  const TAU = 2 * Math.PI;
  const HOME = [-30, 28];
  const IDLE_DEGREES_PER_SECOND = 2;
  // Pack the neutral land inks once. Each dot adds its own antialiased coverage.
  function packedInks(inks) {
    return inks.map((ink) => {
      const rgb = parseInt(ink.slice(1), 16);
      return (rgb >>> 16) | (rgb & 0x00ff00) | ((rgb & 0xff) << 16);
    });
  }
  const PALETTES = {
    dark: {
      inks: packedInks([
        '#555555', '#616161', '#6a6a6a', '#737373', '#7c7c7c', '#858585',
        '#8e8e8e', '#969696', '#9b9b9b', '#a1a1a1', '#a6a6a6', '#acacac',
      ]),
      ocean: ['#161618', '#111113', '#0b0b0d', '#060607'],
      rim: ['#444346', '#303033', '#1c1c1e'],
      hoverFill: 'rgba(210,218,233,.09)',
      hoverStroke: 'rgba(237,241,249,.63)',
      selectedStroke: 'rgba(221,205,255,.84)',
      halo: [
        'rgba(244,236,255,.98)',
        'rgba(220,205,255,.91)',
        'rgba(197,168,250,.45)',
        'rgba(173,144,230,.12)',
        'rgba(173,144,230,0)',
      ],
      pin: '#fffaff',
      pinRing: 'rgba(238,229,255,.92)',
    },
    light: {
      inks: packedInks([
        '#949494', '#898989', '#808080', '#797979', '#737373', '#6d6d6d',
        '#676767', '#626262', '#5d5d5d', '#595959', '#555555', '#515151',
      ]),
      ocean: ['#fffefa', '#f4f2ee', '#e5e2dd', '#cbc8c4'],
      rim: ['#b1adaa', '#a29d9a', '#898480'],
      // A slate backing gives white dots definition even on the brightest ocean.
      hoverFill: 'rgba(43,50,63,.76)',
      hoverStroke: 'rgba(42,48,62,.86)',
      selectedStroke: 'rgba(82,55,125,.95)',
      halo: [
        'rgba(89,57,141,.98)',
        'rgba(110,78,164,.82)',
        'rgba(130,94,186,.46)',
        'rgba(154,125,197,.16)',
        'rgba(154,125,197,0)',
      ],
      pin: '#4c2c79',
      pinEdge: 'rgba(255,253,249,.94)',
      pinRing: 'rgba(83,53,131,.92)',
    },
  };
  function currentPalette() {
    return document.documentElement.dataset.theme === 'light' ? PALETTES.light : PALETTES.dark;
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrap = (longitude) => ((((longitude + 180) % 360) + 360) % 360) - 180;
  const code = (id) => (typeof id === 'string' ? id.toUpperCase() : null);

  function unit(longitude, latitude) {
    const lon = longitude * RAD,
      lat = latitude * RAD;
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  }

  function camera(lon, lat) {
    return [Math.cos(lon * RAD), Math.sin(lon * RAD), Math.cos(lat * RAD), Math.sin(lat * RAD)];
  }

  function project(points, output, view) {
    const [cosLon, sinLon, cosLat, sinLat] = view;
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i],
        y = points[i + 1],
        z = points[i + 2];
      const forward = cosLon * x + sinLon * y;
      output[i] = -sinLon * x + cosLon * y;
      output[i + 1] = sinLat * forward - cosLat * z;
      output[i + 2] = cosLat * forward + sinLat * z;
    }
  }

  function makeRing(coordinates) {
    // A short great-circle segment projects smoothly at every camera angle.
    const input = coordinates.map((p) => unit(p[0], p[1]));
    if (input.length < 3) return null;
    const points = [];
    let sx = 0,
      sy = 0,
      sz = 0,
      nx = 0,
      ny = 0,
      nz = 0;
    for (let i = 0; i < input.length; i++) {
      const a = input[i],
        b = input[(i + 1) % input.length];
      const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
      if (dot > 1 - 1e-13) continue;
      const steps = Math.max(1, Math.ceil(Math.acos(dot) / (2.5 * RAD)));
      for (let j = 0; j < steps; j++) {
        const k = j / steps,
          h = 1 - k;
        const x = h * a[0] + k * b[0],
          y = h * a[1] + k * b[1],
          z = h * a[2] + k * b[2];
        const length = Math.hypot(x, y, z);
        points.push(x / length, y / length, z / length);
      }
      sx += a[0];
      sy += a[1];
      sz += a[2];
      nx += a[1] * b[2] - a[2] * b[1];
      ny += a[2] * b[0] - a[0] * b[2];
      nz += a[0] * b[1] - a[1] * b[0];
    }
    return points.length >= 9
      ? {
          points: new Float64Array(points),
          projected: new Float64Array(points.length),
          anticlockwise: nx * sx + ny * sy + nz * sz >= 0,
          area: Math.hypot(nx, ny, nz) / 2,
        }
      : null;
  }

  function countries(features) {
    return features.map((feature, index) => {
      const geometry = feature.geometry;
      const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.coordinates || [];
      const rings = [];
      let area = 0;
      for (const polygon of polygons) {
        for (let i = 0; i < polygon.length; i++) {
          const ring = makeRing(polygon[i]);
          if (ring) {
            rings.push(ring);
            area += i ? -ring.area : ring.area;
          }
        }
      }
      const id = code(feature.id);
      const center = feature.center;
      return {
        id,
        index,
        center,
        anchor: center?.length >= 2 ? unit(...center) : null,
        projectedAnchor: new Float64Array(3),
        rings,
        area: Math.max(0, area),
      };
    });
  }

  // Intersect the plane of a great-circle edge with the visible hemisphere.
  function horizon(p, a, b) {
    const k = p[a + 2] / (p[a + 2] - p[b + 2]);
    const x = p[a] + k * (p[b] - p[a]),
      y = p[a + 1] + k * (p[b + 1] - p[a + 1]);
    const length = Math.hypot(x, y);
    return [x / length, y / length];
  }

  function extendBounds(bounds, x, y) {
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
  }

  function drawRing(ring, fill, stroke, bounds, view) {
    const p = ring.projected;
    project(ring.points, p, view);
    let hidden = -1,
      visible = false;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 2] < 0) hidden = i;
      else {
        visible = true;
        extendBounds(bounds, p[i], p[i + 1]);
      }
    }
    if (!visible) return;
    if (hidden < 0) {
      const path = new Path2D();
      path.moveTo(p[0], p[1]);
      for (let i = 3; i < p.length; i += 3) path.lineTo(p[i], p[i + 1]);
      path.closePath();
      fill.addPath(path);
      stroke.addPath(path);
      return;
    }

    // Keep each visible stretch and connect exits to the next entry along the
    // true circular limb. A concave ring can leave several separate islands.
    const stretches = [];
    let stretch,
      a = hidden;
    for (let count = 0; count < p.length; count += 3) {
      const b = (a + 3) % p.length,
        nearA = p[a + 2] >= 0,
        nearB = p[b + 2] >= 0;
      if (!nearA && nearB) {
        const [x, y] = horizon(p, a, b);
        stretch = { start: Math.atan2(y, x), points: [x, y, p[b], p[b + 1]], used: false };
        stretches.push(stretch);
      } else if (nearA && nearB) {
        stretch.points.push(p[b], p[b + 1]);
      } else if (nearA) {
        const [x, y] = horizon(p, a, b);
        stretch.points.push(x, y);
        stretch.end = Math.atan2(y, x);
        stroke.moveTo(stretch.points[0], stretch.points[1]);
        for (let i = 2; i < stretch.points.length; i += 2)
          stroke.lineTo(stretch.points[i], stretch.points[i + 1]);
      }
      a = b;
    }
    // A true limb arc can bow past its endpoints, so keep conservative bounds.
    bounds[0] = -1;
    bounds[1] = -1;
    bounds[2] = 1;
    bounds[3] = 1;
    const turn = ring.anticlockwise ? -1 : 1;
    for (const first of stretches) {
      if (first.used) continue;
      let current = first;
      fill.moveTo(first.points[0], first.points[1]);
      do {
        current.used = true;
        for (let i = 2; i < current.points.length; i += 2)
          fill.lineTo(current.points[i], current.points[i + 1]);
        let next,
          closest = Infinity;
        for (const candidate of stretches) {
          if (candidate.used && candidate !== first) continue;
          const distance = ((candidate.start - current.end) * turn + TAU) % TAU;
          if (distance < closest) {
            closest = distance;
            next = candidate;
          }
        }
        fill.arc(0, 0, 1, current.end, next.start, ring.anticlockwise);
        current = next;
      } while (!current.used);
      fill.closePath();
    }
  }

  function landDots(features, rows) {
    // Intersect the latitude rings with the original polygons. Even/odd spans
    // preserve holes and enclaves, and each sample retains its country as it rotates.
    const parallels = Array.from({ length: rows }, (_, row) => {
      const lat = 90 - ((row + 0.5) * 180) / rows;
      const columns = Math.max(1, Math.round(2 * rows * Math.cos(lat * RAD)));
      return { lat, step: 360 / columns, offset: row % 2 ? 0.75 : 0.25, owners: new Uint16Array(columns) };
    });
    for (const [index, { geometry }] of features.entries()) {
      if (!geometry) continue;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const rings of polygons) {
        // Edges only visit the latitude rings they actually cross.
        const crossings = new Map();
        for (const ring of rings) {
          let [x0, y0] = ring[ring.length - 1];
          for (const [x1, y1] of ring) {
            if (y0 === y1) {
              x0 = x1;
              continue;
            }
            const north = Math.max(y0, y1), south = Math.min(y0, y1);
            const first = Math.max(0, Math.floor(((90 - north) * rows) / 180 - 0.5) + 1);
            for (let row = first; row < rows && parallels[row].lat >= south; row++) {
              if (!crossings.has(row)) crossings.set(row, []);
              crossings.get(row).push(x0 + ((parallels[row].lat - y0) * (x1 - x0)) / (y1 - y0));
            }
            x0 = x1;
            y0 = y1;
          }
        }
        for (const [row, longitudes] of crossings) {
          const { step, offset, owners } = parallels[row];
          longitudes.sort((a, b) => a - b);
          for (let i = 1; i < longitudes.length; i += 2) {
            const left = Math.max(0, Math.ceil((longitudes[i - 1] + 180) / step - offset));
            const right = Math.max(0, Math.ceil((longitudes[i] + 180) / step - offset));
            owners.fill(index + 1, left, right);
          }
        }
      }
    }
    const points = [];
    const owners = [];
    const sampled = new Uint8Array(features.length);
    for (const parallel of parallels) {
      for (let col = 0; col < parallel.owners.length; col++) {
        const owner = parallel.owners[col] - 1;
        if (owner < 0) continue;
        points.push(...unit((col + parallel.offset) * parallel.step - 180, parallel.lat));
        owners.push(owner);
        sampled[owner] = 1;
      }
    }
    // The dataset's interior label points keep tiny islands and city-states selectable
    // and visible even when their footprint falls between two latitude samples.
    features.forEach(({ center, geometry }, index) => {
      if (sampled[index] || !geometry || !center) return;
      points.push(...unit(...center));
      owners.push(index);
    });
    return {
      points: new Float32Array(points),
      projected: new Float32Array(points.length),
      owners: new Uint16Array(owners),
      rows,
    };
  }

  function dotLayer() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let image, pixels;

    function draw(dots, view, radius, colors, inspected) {
      const { points, projected, rows, owners } = dots;
      const major = (Math.PI / rows) * radius * 0.29;
      const side = 2 * Math.ceil(radius + major + 1);
      if (canvas.width !== side || !image) {
        canvas.width = canvas.height = side;
        image = ctx.createImageData(side, side);
        pixels = new Uint32Array(image.data.buffer);
      } else pixels.fill(0);

      const inverseMajorSq = 1 / (major * major);
      const center = side / 2;
      project(points, projected, view);
      for (let i = 0; i < projected.length; i += 3) {
        const depth = projected[i + 2];
        if (depth <= 0.025) continue;
        const x = projected[i],
          y = projected[i + 1];
        const light = Math.max(0, -0.47 * x - 0.35 * y + 0.81 * depth);
        const illumination = 0.12 + 0.88 * Math.pow(0.58 * depth + 0.42 * light, 0.8);
        const rgb = owners[i / 3] === inspected
          ? 0xffffff
          : colors[Math.round(illumination * (colors.length - 1))];
        const cx = center + x * radius,
          cy = center + y * radius;
        // Project a surface circle as an ellipse. For subpixel widths, retain
        // its fractional coverage as opacity so the horizon tapers smoothly.
        const minor = major * (0.06 + 0.94 * depth);
        const opacity = Math.min(1, minor / 0.6);
        const inverseMinorSq = 1 / Math.max(0.36, minor * minor);
        const radial = Math.sqrt(x * x + y * y);
        const nx = radial ? x / radial : 1,
          ny = radial ? y / radial : 0;
        const mxx = inverseMajorSq + (inverseMinorSq - inverseMajorSq) * nx * nx;
        const myy = inverseMajorSq + (inverseMinorSq - inverseMajorSq) * ny * ny;
        const mxy = (inverseMinorSq - inverseMajorSq) * nx * ny;
        const left = Math.floor(cx - major - 0.5),
          right = Math.ceil(cx + major - 0.5);
        const top = Math.floor(cy - major - 0.5),
          bottom = Math.ceil(cy + major - 0.5);
        for (let py = top; py <= bottom; py++) {
          const dy = py + 0.5 - cy;
          for (let px = left; px <= right; px++) {
            const dx = px + 0.5 - cx;
            const gx = mxx * dx + mxy * dy,
              gy = mxy * dx + myy * dy;
            const distance = dx * gx + dy * gy;
            // Signed distance to the edge, estimated along its screen normal.
            const coverage = 0.5 + (1 - distance) / (2 * Math.sqrt(gx * gx + gy * gy));
            if (coverage <= 0) continue;
            const alpha = Math.round(255 * Math.min(1, coverage) * opacity);
            const index = py * side + px;
            if (pixels[index] >>> 24 < alpha) pixels[index] = rgb | (alpha << 24);
          }
        }
      }
      ctx.putImageData(image, 0, 0);
    }
    return { canvas, draw };
  }

  // Reuse the atlas's land samples and projection at a smaller scale during startup.
  function drawOpeningGlobe(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !window.ElectionCountries?.features) return;
    const screen = canvas.closest('dialog');
    const dots = landDots(window.ElectionCountries.features, 44);
    const texture = dotLayer();
    const start = performance.now();
    function paint(now) {
      if (!screen.open || !screen.isConnected) return;
      const elapsedSeconds = (now - start) / 1000;
      const longitude = HOME[0] + elapsedSeconds * 40;
      texture.draw(dots, camera(longitude, HOME[1]), canvas.width / 2, currentPalette().inks, -1);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const left = (canvas.width - texture.canvas.width) / 2;
      const top = (canvas.height - texture.canvas.height) / 2;
      ctx.drawImage(texture.canvas, left, top);
      requestAnimationFrame(paint);
    }
    paint(start);
    canvas.dataset.painted = '';
  }

  function create(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const features = window.ElectionCountries?.features || [];
    const all = countries(features);
    const byId = new Map(all.map((item) => [item.id, item]));
    const texture = dotLayer();
    let palette = currentPalette();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sphere = new Path2D();
    sphere.arc(0, 0, 1, 0, TAU);
    let lon = HOME[0],
      lat = HOME[1],
      width = 0,
      height = 0,
      radius = 0,
      dpr = 1;
    let active = new Set(),
      selected = null,
      hovered = null,
      pins = [],
      dots;
    let cameraRevision = 0;
    let view = camera(lon, lat);
    let spinSpeed = IDLE_DEGREES_PER_SECOND, lastSpin = null, spinTimer = 0;
    let sceneVisible = true, autoRotate = true;
    let mousePosition = null, lastHoverCheck = 0;
    let moved = true,
      viewChanged = true,
      dead = false,
      frame = 0,
      animation = null,
      pointer = null;
    const originalCursor = canvas.style.cursor,
      originalTouch = canvas.style.touchAction;
    canvas.style.touchAction = 'pan-y pinch-zoom';
    canvas.style.cursor = 'grab';

    function invalidate() {
      if (!frame && !dead) frame = requestAnimationFrame(paint);
    }

    function restartClock() {
      clearTimeout(spinTimer);
      lastSpin = null;
      invalidate();
    }

    function slowRotation() {
      spinSpeed = IDLE_DEGREES_PER_SECOND / 2;
      restartClock();
    }

    function changeTheme() {
      const next = currentPalette();
      if (next === palette) return;
      palette = next;
      moved = true;
      invalidate();
    }

    function setView(longitude, latitude) {
      lon = wrap(longitude);
      lat = clamp(latitude, -90, 90);
      view = camera(lon, lat);
      cameraRevision++;
      moved = true;
      viewChanged = true;
    }

    function projectBoundary(item) {
      if (item.revision === cameraRevision) return;
      item.fill = new Path2D();
      item.stroke = new Path2D();
      item.bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const ring of item.rings) drawRing(ring, item.fill, item.stroke, item.bounds, view);
      item.revision = cameraRevision;
    }

    function updateSurface() {
      for (const item of all) {
        if (item.anchor) project(item.anchor, item.projectedAnchor, view);
      }
      texture.draw(dots, view, radius * dpr, palette.inks, byId.get(hovered || selected)?.index);
      moved = false;
    }

    function resize() {
      if (dead) return;
      const rect = canvas.getBoundingClientRect();
      if (width !== rect.width || height !== rect.height) viewChanged = true;
      width = rect.width;
      height = rect.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
      const nextRadius = Math.min(width, height) * 0.46;
      if (dpr !== pixelRatio || radius !== nextRadius) moved = true;
      dpr = pixelRatio;
      const w = Math.round(width * dpr),
        h = Math.round(height * dpr);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      radius = nextRadius;
      if (radius) {
        // Keep dots distinct on smaller screens and retain the same atlas-like scale on large ones.
        const rows = clamp(Math.round((64 + radius * 0.1) / 4) * 4, 72, 108);
        if (dots?.rows !== rows) {
          dots = landDots(features, rows);
          moved = true;
        }
      }
      invalidate();
    }

    function projectCountry(id) {
      const item = byId.get(code(id));
      if (!radius || !item?.anchor) return null;
      // A caller may ask between a direct camera change and its next paint.
      if (moved) project(item.anchor, item.projectedAnchor, view);
      const [x, y, depth] = item.projectedAnchor;
      if (depth <= 0) return null;
      return { x: width / 2 + x * radius, y: height / 2 + y * radius, depth };
    }

    function drawCountries() {
      // Place the backing beneath the dots so their white ink stays intact.
      const inspected = byId.get(hovered || selected);
      if (inspected) {
        projectBoundary(inspected);
        ctx.fillStyle = palette.hoverFill;
        ctx.fill(inspected.fill, 'evenodd');
      }
      const side = texture.canvas.width / (radius * dpr);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(texture.canvas, -side / 2, -side / 2, side, side);
      for (const id of new Set([selected, hovered])) {
        const item = byId.get(id);
        if (!item) continue;
        projectBoundary(item);
        ctx.strokeStyle = id === selected ? palette.selectedStroke : palette.hoverStroke;
        ctx.lineWidth = (id === selected ? 0.95 : 0.75) / radius;
        ctx.lineJoin = 'round';
        ctx.stroke(item.stroke);
      }
    }

    function drawPins() {
      const markers = all.filter(
        (item) =>
          (active.has(item.id) || item.id === selected) && item.anchor && item.projectedAnchor[2] > 0.1,
      );
      // Large active countries get a small beacon. Small active countries also
      // get a minimum interactive target when their true footprint is tiny.
      markers.sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || a.area - b.area);
      pins = [];
      for (const item of markers) {
        const [x, y, depth] = item.projectedAnchor;
        const small = item.area * radius * radius * depth < 220;
        if (pins.some((pin) => Math.hypot(pin.x - x, pin.y - y) * radius < 11)) continue;
        const pinned = item.id === selected;
        const size = (pinned ? 3.65 : small ? 2.35 : 2.8) * clamp(radius / 260, 0.9, 1.3);
        const haloSize = (size + (pinned ? 12 : 9)) / radius;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, haloSize);
        halo.addColorStop(0, palette.halo[0]);
        halo.addColorStop(0.18, palette.halo[1]);
        halo.addColorStop(0.42, palette.halo[2]);
        halo.addColorStop(0.72, palette.halo[3]);
        halo.addColorStop(1, palette.halo[4]);
        ctx.fillStyle = halo;
        ctx.fillRect(x - haloSize, y - haloSize, 2 * haloSize, 2 * haloSize);
        ctx.beginPath();
        ctx.arc(x, y, size / radius, 0, TAU);
        // A tiny country's beacon can cover its only dot. Keep the same white
        // center inside the colored market halo when that country is inspected.
        const inspectingSmall = small && item.id === (hovered || selected);
        ctx.fillStyle = inspectingSmall ? '#fff' : palette.pin;
        ctx.fill();
        if (palette.pinEdge) {
          ctx.lineWidth = 1 / radius;
          ctx.strokeStyle = inspectingSmall ? palette.pinRing : palette.pinEdge;
          ctx.stroke();
        }
        if (pinned) {
          ctx.beginPath();
          ctx.arc(x, y, (size + 3.8) / radius, 0, TAU);
          ctx.lineWidth = 1 / radius;
          ctx.strokeStyle = palette.pinRing;
          ctx.stroke();
        }
        pins.push({ id: item.id, x, y, size, small });
      }
    }

    function paint(now) {
      frame = 0;
      clearTimeout(spinTimer);
      if (dead || !radius) return;
      const canSpin = autoRotate && sceneVisible && !document.hidden && !reducedMotion.matches && !pointer;
      if (animation) {
        lastSpin = null;
        const t = clamp((now - animation.start) / animation.duration, 0, 1);
        const k = t * t * (3 - 2 * t);
        setView(animation.lon + animation.dx * k, animation.lat + animation.dy * k);
        if (t < 1) invalidate();
        else animation = null;
      } else if (canSpin) {
        if (lastSpin !== null) setView(lon + spinSpeed * Math.min(now - lastSpin, 150) / 1000, lat);
        lastSpin = now;
      } else lastSpin = null;
      if (moved) updateSurface();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(radius * dpr, 0, 0, radius * dpr, (width * dpr) / 2, (height * dpr) / 2);
      ctx.save();
      ctx.clip(sphere);
      const ocean = ctx.createRadialGradient(-0.32, -0.43, 0, 0, 0, 1.18);
      ocean.addColorStop(0, palette.ocean[0]);
      ocean.addColorStop(0.4, palette.ocean[1]);
      ocean.addColorStop(0.76, palette.ocean[2]);
      ocean.addColorStop(1, palette.ocean[3]);
      ctx.fillStyle = ocean;
      ctx.fill(sphere);
      drawCountries();
      ctx.restore();
      const outline = ctx.createLinearGradient(-0.7, -0.71, 0.7, 0.71);
      outline.addColorStop(0, palette.rim[0]);
      outline.addColorStop(0.5, palette.rim[1]);
      outline.addColorStop(1, palette.rim[2]);
      ctx.lineWidth = 0.85 / radius;
      ctx.strokeStyle = outline;
      ctx.stroke(sphere);
      ctx.save();
      ctx.clip(sphere);
      drawPins();
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // The country under a stationary mouse can change as the Earth turns.
      if (canSpin && mousePosition && !animation && now - lastHoverCheck >= 160) {
        lastHoverCheck = now;
        hover(hit(mousePosition), mousePosition);
      }
      if (viewChanged) {
        viewChanged = false;
        options.onViewChange?.(projectCountry);
      }
      if (canSpin && !animation) spinTimer = setTimeout(invalidate, 1000 / 24);
    }

    function coord(event) {
      const rect = canvas.getBoundingClientRect();
      return [
        (event.clientX - rect.left - width / 2) / radius,
        (event.clientY - rect.top - height / 2) / radius,
      ];
    }

    function hit(event) {
      if (!radius) return null;
      const [x, y] = coord(event);
      if (x * x + y * y > 1) return null;
      let nearby = null,
        distance = Infinity;
      for (const pin of pins) {
        const d = Math.hypot(x - pin.x, y - pin.y) * radius;
        if (d <= pin.size + 1) return pin.id;
        if (pin.small && d < 8 && d < distance) {
          nearby = pin.id;
          distance = d;
        }
      }
      // Test the actual projected country paths, including lakes and enclaves.
      for (let i = all.length - 1; i >= 0; i--) {
        const item = all[i];
        projectBoundary(item);
        const [left, top, right, bottom] = item.bounds;
        if (
          x >= left &&
          x <= right &&
          y >= top &&
          y <= bottom &&
          ctx.isPointInPath(item.fill, x, y, 'evenodd')
        )
          return item.id;
      }
      return nearby;
    }

    function hover(id, position) {
      canvas.style.cursor = pointer?.dragged ? 'grabbing' : id ? 'pointer' : 'grab';
      if (hovered === id) return;
      if ((hovered || selected) !== (id || selected)) moved = true;
      hovered = id;
      invalidate();
      options.onHover?.(id, position);
    }

    function down(event) {
      if (!radius || pointer || (event.button !== 0 && event.pointerType !== 'touch')) return;
      const [x, y] = coord(event);
      if (x * x + y * y > 1) return;
      animation = null;
      lastSpin = null;
      mousePosition = null;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lon, lat, dragged: false };
      canvas.setPointerCapture(event.pointerId);
    }

    function move(event) {
      if (!pointer) {
        if (event.pointerType !== 'touch') {
          mousePosition = { clientX: event.clientX, clientY: event.clientY };
          lastHoverCheck = performance.now();
          hover(hit(event));
        }
        return;
      }
      if (pointer.id !== event.pointerId || pointer.scrolling || !radius) return;
      const dx = event.clientX - pointer.x,
        dy = event.clientY - pointer.y;
      if (!pointer.dragged && Math.hypot(dx, dy) < 4) return;
      if (!pointer.dragged && event.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) {
        pointer.scrolling = true;
        return;
      }
      pointer.dragged = true;
      hover(null);
      setView(pointer.lon - (dx * 75) / radius, pointer.lat + (dy * 75) / radius);
      invalidate();
    }

    function finish(event) {
      if (!pointer || event.pointerId !== pointer.id) return;
      const tap = event.type === 'pointerup' && !pointer.dragged && !pointer.scrolling;
      pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const id = event.type === 'pointerup' ? hit(event) : null;
      if (event.type === 'pointerup' && event.pointerType !== 'touch')
        mousePosition = { clientX: event.clientX, clientY: event.clientY };
      hover(mousePosition ? id : null);
      if (tap) {
        slowRotation();
        options.onSelect?.(id);
      } else restartClock();
    }

    function leave() {
      mousePosition = null;
      if (!pointer) hover(null);
    }

    function fly(longitude, latitude) {
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      const dx = wrap(longitude - lon),
        dy = clamp(latitude, -90, 90) - lat;
      mousePosition = null;
      lastSpin = null;
      hover(null);
      animation = null;
      if (reducedMotion.matches || Math.hypot(dx, dy) < 0.5) setView(lon + dx, lat + dy);
      else
        animation = {
          lon,
          lat,
          dx,
          dy,
          start: performance.now(),
          duration: clamp(Math.hypot(dx, dy) * 4.3, 240, 780),
        };
      invalidate();
    }

    const events = {
      pointerdown: down,
      pointermove: move,
      pointerup: finish,
      pointercancel: finish,
      lostpointercapture: finish,
      pointerleave: leave,
    };
    for (const [type, fn] of Object.entries(events)) canvas.addEventListener(type, fn);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    const visibility = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      sceneVisible = entry.isIntersecting;
      restartClock();
    }) : null;
    visibility?.observe(options.motionRegion || canvas);
    document.addEventListener('visibilitychange', restartClock);
    reducedMotion.addEventListener('change', restartClock);
    window.addEventListener('resize', resize);
    window.addEventListener('electionthemechange', changeTheme);
    resize();

    return {
      projectCountry,
      slowRotation,
      setAutoRotate(enabled) {
        autoRotate = enabled;
        restartClock();
      },
      setActive(ids) {
        active = new Set(Array.from(ids || [], code));
        invalidate();
      },
      setSelected(id) {
        const next = code(id);
        if (selected === next) return;
        if (!hovered) moved = true;
        selected = next;
        invalidate();
      },
      focus(id) {
        const center = byId.get(code(id))?.center;
        if (center) fly(...center);
      },
      rotate(longitude, latitude) {
        const baseLon = animation ? animation.lon + animation.dx : lon;
        const baseLat = animation ? animation.lat + animation.dy : lat;
        fly(baseLon + longitude, baseLat + latitude);
      },
      reset() {
        spinSpeed = IDLE_DEGREES_PER_SECOND;
        fly(...HOME);
      },
      destroy() {
        dead = true;
        animation = null;
        cancelAnimationFrame(frame);
        clearTimeout(spinTimer);
        observer?.disconnect();
        visibility?.disconnect();
        document.removeEventListener('visibilitychange', restartClock);
        reducedMotion.removeEventListener('change', restartClock);
        window.removeEventListener('resize', resize);
        window.removeEventListener('electionthemechange', changeTheme);
        for (const [type, fn] of Object.entries(events)) canvas.removeEventListener(type, fn);
        if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
        canvas.style.cursor = originalCursor;
        canvas.style.touchAction = originalTouch;
      },
    };
  }

  window.ElectionGlobe = { create, drawOpeningGlobe };
})();

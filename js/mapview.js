/* global L */
// The map: background layers, drawing each dataset (lines, arrows, canvas
// markers), popups, hover labels, clicking, keyboard targets over markers,
// zooming to data, and adding a dataset to the map.

import { binColour, colourKey, computeColours, getScale, setScale } from './colour.js';
import { BASEMAPS, DEFAULT_VIEW } from './config.js';
import { bearing, distanceMetres, formatCoord } from './coords.js';
import { displayTimeZone, formatDateTime, formatDistance, formatDuration } from './dates.js';
import { anchorFor, arrowSvg, eventIcon, markerSvg } from './icons.js';
import { PointLayer, popupOffset } from './pointlayer.js';
import { createReplay } from './replay.js';
import * as store from './store.js';
import { changed, datasets, hooks, layers, prefs, save, savePrefs, sequenceOf } from './state.js';
import { filterMask } from './filters.js';
import { analyse, SPEED_UNITS } from './analysis.js';
import { $, announce, esc, toast } from './util.js';

export const map = L.map('map', { zoomControl: true, keyboard: true, worldCopyJump: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

export const baseLayers = {};

BASEMAPS.forEach((b) => { baseLayers[b.name] = L.tileLayer(b.url, { ...b.options, crossOrigin: true }); baseLayers[b.name]._id = b.id; });

L.control.scale({ imperial: true }).addTo(map);

L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

map.on('baselayerchange', (e) => { prefs.basemap = e.layer._id; savePrefs(); });

// Keep the floating controls keyboard friendly
map.getContainer().querySelector('.leaflet-control-layers-toggle')?.setAttribute('aria-label', 'Change map background');

// Panes so lines sit under markers and arrows sit between
map.createPane('tracks').style.zIndex = 410;

map.createPane('arrows').style.zIndex = 420;

map.createPane('dmPoints').style.zIndex = 590;      // canvas markers (replay heads at 600 sit on top)

map.createPane('dmEvents').style.zIndex = 645;      // stop / gap / jump symbols: above the keyboard targets so they can be clicked

map.createPane('dmFocus').style.zIndex = 640;       // invisible keyboard targets over the markers

map.getPane('dmPoints').style.pointerEvents = 'none';

export const replay = createReplay({ map, getDatasets: () => datasets, layers, announce });

// Lines coloured by value are drawn on canvas: there can be thousands of short runs
export const colourLineRenderer = L.canvas({ padding: 0.2, pane: 'tracks' });

/** The datasets whose colours share one scale with `ds` (just `ds` when sharing is off). */
function colourGroup(ds) {
  if (!prefs.sharedScale || colourKey(ds) === 'none') return [ds];
  return [ds, ...datasets.filter((d) => d !== ds && colourKey(d) === colourKey(ds))];
}

/** Redraw a dataset, and any others whose shared colour scale may have changed with it. */
export function renderDataset(ds) {
  drawDataset(ds);
  redrawShared(ds);
}

let wasShared = null;
/** Redraw the datasets coloured by value (their shared scales may have changed, or sharing was switched off). */
export function redrawShared(except = null) {
  const switched = wasShared !== null && wasShared !== prefs.sharedScale;
  wasShared = prefs.sharedScale;
  if (!prefs.sharedScale && !switched) return;
  for (const d of datasets) if (d !== except && colourKey(d) !== 'none' && layers.has(d.id)) drawDataset(d);
}

/** Draw every dataset once. */
export function renderAll() {
  datasets.forEach(drawDataset);
}

function drawDataset(ds) {
  removeLayers(ds.id);
  const group = L.featureGroup();
  // The filter decides which points take part: they're the only ones drawn,
  // joined, numbered, stepped through, replayed and analysed.
  const mask = filterMask(ds, prefs.filter, { zone: displayTimeZone(), speedUnit: prefs.analysis.speedUnit });
  const seq = sequenceOf(ds);
  const order = mask ? seq.order.filter((i) => mask[i]) : seq.order;
  const untimed = mask ? seq.untimed.filter((i) => mask[i]) : seq.untimed;
  const seqPos = new Map(order.map((pi, k) => [pi, k]));
  const st = ds.style;
  // Colour by value (speed, time or a column), if chosen
  const colours = computeColours(ds, colourGroup(ds));
  setScale(ds, colours);
  // A leg is coloured by the point it arrives at (for speed, that's the leg's own speed)
  const legColour = (k) => (colours ? binColour(colours.bins[order[k + 1]]) : st.color);

  // Line first so it draws under the markers
  if (st.showLine && order.length > 1) {
    const latlngs = order.map((i) => [ds.points[i].lat, ds.points[i].lon]);
    const dash = st.lineStyle === 'dashed' ? '10 8' : st.lineStyle === 'dotted' ? '2 7' : null;
    const lineOpts = { interactive: false, lineCap: 'round', lineJoin: 'round' };
    if (!colours) {
      L.polyline(latlngs, { ...lineOpts, pane: 'tracks', color: '#fff', weight: 6, opacity: 0.75 }).addTo(group);
      L.polyline(latlngs, { ...lineOpts, pane: 'tracks', color: st.color, weight: 3, opacity: 0.95, dashArray: dash }).addTo(group);
    } else {
      // White casing, then one line per run of legs that share a colour
      L.polyline(latlngs, { ...lineOpts, renderer: colourLineRenderer, color: '#fff', weight: 6, opacity: 0.75 }).addTo(group);
      let run = [latlngs[0]], runColour = legColour(0);
      const flush = () => L.polyline(run, { ...lineOpts, renderer: colourLineRenderer, color: runColour, weight: 3.5, opacity: 1, dashArray: dash }).addTo(group);
      for (let k = 0; k < latlngs.length - 1; k++) {
        const c = legColour(k);
        if (c !== runColour) { flush(); run = [latlngs[k]]; runColour = c; }
        run.push(latlngs[k + 1]);
      }
      flush();
    }

    if (st.showArrows) {
      const step = Math.max(1, Math.ceil((latlngs.length - 1) / 400));
      for (let k = 0; k < latlngs.length - 1; k += step) {
        const a = latlngs[k], b = latlngs[k + 1];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        L.marker(mid, {
          pane: 'arrows', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'dm-arrow', html: arrowSvg(legColour(k), bearing(a, b)), iconSize: [16, 16], iconAnchor: [8, 8] }),
        }).addTo(group);
      }
    }
  }

  // All markers for the dataset are drawn on one canvas
  const labels = new Map();
  if (st.numbered) seqPos.forEach((pos, i) => labels.set(i, pos + 1));
  const points = new PointLayer(ds, labels, { colours, mask }).addTo(group);
  points.on('redraw', scheduleFocusTargets);

  // Stops, gaps in the recording and GPS jumps, along the shown points in time order
  const timedOrder = (st.lineOrder === 'time' ? order : order.filter((i) => ds.points[i].t != null))
    .slice().sort((a, b) => ds.points[a].t - ds.points[b].t || a - b);
  const analysis = timedOrder.length > 1 ? analyse(ds.points, timedOrder, prefs.analysis) : null;
  const eventMarkers = analysis && prefs.analysis.showOnMap ? drawEvents(ds, analysis, group) : [];

  layers.set(ds.id, { group, points, order, untimed, mask, analysis, eventMarkers });
  if (ds.visible && !replay.active) group.addTo(map);
}

/** Redraw every dataset (after the filter or the stop / jump settings change). */
export function refreshAll() {
  map.closePopup();
  renderAll();
  changed();
}

// ===================================================================== stops, gaps and jumps on the map

const MAX_EVENTS = 300; // per kind, per dataset, so a very messy file can't swamp the map

/** A small clickable, keyboard-reachable symbol for a stop, gap or jump (see eventIcon). */
function eventMarker(kind, latlng, iconOpts, title, popup) {
  const { svg, w, h, anchor } = eventIcon(kind, iconOpts);
  return L.marker(latlng, {
    pane: 'dmEvents',
    keyboard: true,
    title,
    alt: title,
    riseOnHover: true,
    icon: L.divIcon({ className: `dm-event dm-event-${kind}`, html: svg, iconSize: [w, h], iconAnchor: anchor }),
  }).bindPopup(popup, { maxWidth: 300, minWidth: 220 });
}

function eventPopup(title, sub, rows, action) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = `
    <h3 class="pop-title" tabindex="-1">${esc(title)}</h3>
    <p class="pop-sub">${esc(sub)}</p>
    <dl class="pop-dl">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${action ? `<div class="pop-nav"><button type="button" class="btn btn-sm btn-ghost-danger" data-act="action">${esc(action.label)}</button></div>` : ''}`;
  if (action) el.querySelector('[data-act=action]').addEventListener('click', action.onClick);
  return el;
}

/** Add stop / gap / jump symbols to the dataset's group. Returns [{ kind, item, marker }]. */
function drawEvents(ds, { stops, gaps, jumps }, group) {
  const out = [];
  const unit = SPEED_UNITS[prefs.analysis.speedUnit] || SPEED_UNITS.mph;
  const at = (i) => [ds.points[i].lat, ds.points[i].lon];

  for (const s of stops.slice(0, MAX_EVENTS)) {
    const dur = formatDuration(s.minutes * 60000);
    const m = eventMarker('stop', [s.lat, s.lon], { label: dur }, `${ds.name}: stopped for ${dur}, ${formatDateTime(s.from)} to ${formatDateTime(s.to)}`,
      () => eventPopup(`Stopped for ${dur}`, ds.name, [
        ['From', formatDateTime(s.from)], ['To', formatDateTime(s.to)], ['Points recorded', String(s.count)], ['Where', formatCoord(s.lat, s.lon)],
      ]));
    m.addTo(group);
    out.push({ kind: 'stop', item: s, marker: m });
  }
  for (const g of gaps.slice(0, MAX_EVENTS)) {
    const dur = formatDuration(g.minutes * 60000);
    // A small break across the middle of the line, turned to match its direction
    const a = at(g.a), b = at(g.b);
    const m = eventMarker('gap', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { angle: bearing(a, b) }, `${ds.name}: nothing recorded for ${dur}, ${formatDateTime(g.from)} to ${formatDateTime(g.to)}`,
      () => eventPopup(`Nothing recorded for ${dur}`, ds.name, [
        ['From', formatDateTime(g.from)], ['To', formatDateTime(g.to)], ['Distance between', formatDistance(g.metres)],
        ['Note', 'The route taken during this time is not known. The line just joins the two ends.'],
      ]));
    m.addTo(group);
    out.push({ kind: 'gap', item: g, marker: m });
  }
  for (const j of jumps.slice(0, MAX_EVENTS)) {
    const speed = `${Math.round(j.speed).toLocaleString()} ${unit.label}`;
    const m = eventMarker('jump', at(j.i), {}, `${ds.name}: possible GPS jump at ${formatDateTime(ds.points[j.i].t)}`,
      () => eventPopup('Possible GPS jump', ds.name, [
        ['When', formatDateTime(ds.points[j.i].t)],
        ['From the previous point', `${formatDistance(j.metres)} in ${formatDuration(j.seconds * 1000)}`],
        ['Speed that would need', speed],
        ['Note', 'This is usually a bad GPS reading. You can remove the point; Undo will be offered.'],
      ], { label: 'Remove this point', onClick: () => removePoint(ds, j.i) }));
    m.addTo(group);
    out.push({ kind: 'jump', item: j, marker: m });
  }
  return out;
}

/** Remove one point from a dataset (e.g. a bad GPS reading), with Undo. */
export function removePoint(ds, i) {
  const [p] = ds.points.splice(i, 1);
  map.closePopup();
  renderDataset(ds);
  changed();
  save();
  const undo = toast(`Removed a point from "${ds.name}".`, 'info', {
    duration: 12000,
    action: {
      label: 'Undo',
      onClick: () => {
        ds.points.splice(i, 0, p);
        renderDataset(ds);
        changed();
        save();
        announce('Point restored');
      },
    },
  });
  announce('Point removed. Press Undo to bring it back.');
  undo.focus();
}

export function removeLayers(id) {
  const l = layers.get(id);
  if (l) { map.removeLayer(l.group); layers.delete(id); }
}

export function popupContent(ds, i) {
  const p = ds.points[i];
  const l = layers.get(ds.id);
  const pos = l.order.indexOf(i);
  const prevI = pos > 0 ? l.order[pos - 1] : null;
  const nextI = pos >= 0 && pos < l.order.length - 1 ? l.order[pos + 1] : null;

  const el = document.createElement('div');
  el.className = 'pop';
  const heading = p.label || (pos >= 0 ? `Point ${pos + 1}` : 'Point');
  const rows = [];
  rows.push(['Date & time', p.t != null ? formatDateTime(p.t) : '<span class="muted">Not given</span>']);
  rows.push(['Coordinates', `<span class="mono">${formatCoord(p.lat, p.lon)}</span> <button type="button" class="link-btn" data-copy="${p.lat}, ${p.lon}">Copy</button>`]);
  if (prevI !== null) {
    const q = ds.points[prevI];
    const dist = formatDistance(distanceMetres([q.lat, q.lon], [p.lat, p.lon]));
    const dt = p.t != null && q.t != null ? formatDuration(p.t - q.t) : null;
    rows.push(['From previous', dt ? `${dist} · ${dt}` : dist]);
  }
  const scale = getScale(ds);
  if (scale && ds.style.colourBy === 'speed') {
    rows.push(['Speed', Number.isFinite(scale.values[i]) ? esc(scale.format(scale.values[i])) : '<span class="muted">Not known</span>']);
  }
  for (const [k, v] of Object.entries(p.props || {})) {
    rows.push([esc(k), linkify(esc(v))]);
  }

  el.innerHTML = `
    <h3 class="pop-title" tabindex="-1"><span class="pop-icon">${markerSvg({ shape: ds.style.shape, color: ds.style.color, size: 18 })}</span>${esc(heading)}</h3>
    <p class="pop-sub">${esc(ds.name)}${pos >= 0 ? ` · ${pos + 1} of ${l.order.length}${ds.style.lineOrder === 'time' ? ' by time' : ''}` : ' · no date/time'}</p>
    <dl class="pop-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${pos >= 0 && l.order.length > 1 ? `<div class="pop-nav">
      <button type="button" class="btn btn-sm" data-step="${prevI ?? ''}" ${prevI === null ? 'disabled' : ''}>◀ Previous</button>
      <button type="button" class="btn btn-sm" data-step="${nextI ?? ''}" ${nextI === null ? 'disabled' : ''}>Next ▶</button>
    </div>` : ''}`;

  el.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step && step.dataset.step !== '') { focusPoint(ds.id, Number(step.dataset.step), true); return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => { copy.textContent = 'Copied'; announce('Coordinates copied'); });
    }
  });
  return el;
}

export function linkify(s) {
  return /^https?:\/\/\S+$/.test(s) ? `<a href="${s}" target="_blank" rel="noopener">${s}</a>` : s;
}

/** Pan to a point and open its popup. */
export function focusPoint(dsId, index, keepZoom = false) {
  const l = layers.get(dsId);
  const ds = datasets.find((d) => d.id === dsId);
  if (!l || !ds) return;
  if (replay.active) replay.close();
  if (!ds.visible) { ds.visible = true; l.group.addTo(map); changed(); save(); }
  const p = ds.points[index];
  if (!p) return;
  const z = keepZoom ? map.getZoom() : Math.max(map.getZoom(), 15);
  map.setView([p.lat, p.lon], z, { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
  openPointPopup(ds, index);
  setTimeout(() => $('.leaflet-popup .pop-title')?.focus(), 60);
}

/** Open the details popup for one point. */
export function openPointPopup(ds, i) {
  const p = ds.points[i];
  L.popup({ maxWidth: 320, minWidth: 220, autoPanPadding: [30, 30], offset: popupOffset(ds.style) })
    .setLatLng([p.lat, p.lon])
    .setContent(popupContent(ds, i))
    .openOn(map);
}

/** Visible point layers, topmost (last drawn) first. */
export function pointLayersOnMap() {
  const out = [];
  for (const ds of datasets) {
    const l = layers.get(ds.id);
    if (l && map.hasLayer(l.points)) out.push(l.points);
  }
  return out.reverse();
}

export function hitTest(containerPoint) {
  for (const pl of pointLayersOnMap()) {
    const i = pl.hitTest(containerPoint);
    if (i >= 0) return { ds: pl.ds, i };
  }
  return null;
}

export function pointTitle(ds, i) {
  const p = ds.points[i];
  const seq = layers.get(ds.id)?.order.indexOf(i);
  const name = p.label || (seq >= 0 ? `Point ${seq + 1}` : 'Point');
  return `${ds.name}: ${[name, p.t != null ? formatDateTime(p.t) : null].filter(Boolean).join(', ')}`;
}

// Clicking a marker opens its details
map.on('click', (e) => {
  const hit = hitTest(e.containerPoint);
  if (hit) openPointPopup(hit.ds, hit.i);
});

// Hovering shows a small label and a pointer cursor
export const hoverTip = L.tooltip({ direction: 'top', offset: [0, -14], opacity: 0.95, className: 'dm-hover-tip' });

export let hoverRaf = 0;

map.on('mousemove', (e) => {
  cancelAnimationFrame(hoverRaf);
  hoverRaf = requestAnimationFrame(() => {
    const hit = hitTest(e.containerPoint);
    map.getContainer().classList.toggle('is-over-point', !!hit);
    if (hit) {
      const p = hit.ds.points[hit.i];
      hoverTip.setLatLng([p.lat, p.lon]).setContent(esc(pointTitle(hit.ds, hit.i)));
      if (!map.hasLayer(hoverTip)) hoverTip.openOn(map);
    } else if (map.hasLayer(hoverTip)) {
      map.closeTooltip(hoverTip);
    }
  });
});

map.on('mouseout zoomstart', () => { if (map.hasLayer(hoverTip)) map.closeTooltip(hoverTip); });

// Keyboard and screen-reader access: when few enough markers are in view, put an
// invisible, focusable button over each one so Tab moves between markers.
export const FOCUS_LIMIT = 150;

export let focusTimer = 0;

export function scheduleFocusTargets() {
  clearTimeout(focusTimer);
  focusTimer = setTimeout(updateFocusTargets, 200);
}

export function updateFocusTargets() {
  const pane = map.getPane('dmFocus');
  const activeKey = document.activeElement?.dataset?.pt;
  pane.replaceChildren();
  const bounds = map.getBounds();
  const items = [];
  for (const pl of pointLayersOnMap().reverse()) {
    for (const i of pl.pointsIn(bounds)) {
      items.push({ pl, i });
      if (items.length > FOCUS_LIMIT) break;
    }
    if (items.length > FOCUS_LIMIT) break;
  }
  const many = items.length > FOCUS_LIMIT;
  map.getContainer().setAttribute('aria-label', many
    ? 'Map. Use arrow keys to pan and plus or minus to zoom. There are too many markers in view to move between them with Tab; zoom in, or use a dataset\'s Table view.'
    : 'Map. Use arrow keys to pan and plus or minus to zoom. Press Tab to move between markers and Enter to open one.');
  if (many) return;
  for (const { pl, i } of items) {
    const ds = pl.ds, p = ds.points[i], size = ds.style.size;
    const [ax, ay] = anchorFor(ds.style.shape, size);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dm-focus leaflet-zoom-hide';
    b.dataset.pt = `${ds.id}:${i}`;
    b.setAttribute('aria-label', pointTitle(ds, i));
    b.style.width = b.style.height = `${size}px`;
    b.style.marginLeft = `${-ax}px`;
    b.style.marginTop = `${-ay}px`;
    L.DomUtil.setPosition(b, map.latLngToLayerPoint([p.lat, p.lon]));
    b.addEventListener('click', (ev) => { ev.stopPropagation(); popupOpenerKey = b.dataset.pt; openPointPopup(ds, i); });
    L.DomEvent.disableClickPropagation(b);
    pane.appendChild(b);
  }
  // Keep keyboard focus on the same marker after the buttons are rebuilt
  if (activeKey) pane.querySelector(`[data-pt="${CSS.escape(activeKey)}"]`)?.focus();
}

map.on('moveend zoomend', scheduleFocusTargets);

// Accessible popups: move focus in when opened from the keyboard, and back out when closed.
export let popupOpenerKey = null;

let popupOpenerEl = null; // a stop / gap / jump symbol that opened the popup from the keyboard

map.on('popupopen', (e) => {
  const active = document.activeElement;
  if (active?.classList.contains('dm-focus') || active?.classList.contains('dm-event')) {
    popupOpenerKey = active.dataset.pt || null;
    popupOpenerEl = active.classList.contains('dm-event') ? active : null;
    setTimeout(() => e.popup.getElement()?.querySelector('.pop-title')?.focus(), 30);
  }
  const close = e.popup.getElement()?.querySelector('.leaflet-popup-close-button');
  if (close) close.setAttribute('aria-label', 'Close details');
});

map.on('popupclose', (e) => {
  const el = e.popup.getElement();
  if ((popupOpenerKey || popupOpenerEl) && el && el.contains(document.activeElement)) {
    const target = popupOpenerEl?.isConnected ? popupOpenerEl
      : popupOpenerKey ? map.getPane('dmFocus').querySelector(`[data-pt="${CSS.escape(popupOpenerKey)}"]`) : null;
    (target || map.getContainer()).focus();
  }
  popupOpenerKey = null;
  popupOpenerEl = null;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement?.closest('.leaflet-popup')) map.closePopup();
});

/** Bounds of a dataset's points that pass the filter. */
export function shownBounds(ds, bounds = L.latLngBounds([])) {
  const mask = layers.get(ds.id)?.mask;
  ds.points.forEach((p, i) => { if (!mask || mask[i]) bounds.extend([p.lat, p.lon]); });
  return bounds;
}

export function fitAll() {
  const bounds = L.latLngBounds([]);
  datasets.forEach((d) => { if (d.visible) shownBounds(d, bounds); });
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  else announce('There is no visible data to zoom to.');
}

export function fitDataset(ds) {
  const b = shownBounds(ds);
  if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
}

export function addDataset(ds) {
  datasets.push(ds);
  renderDataset(ds);
  changed();
  save();
  // Ask the browser to keep our data even when space runs low (most agree silently)
  store.requestPersistence().then(() => hooks.saved());
}

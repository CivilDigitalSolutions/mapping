/* global L, Papa */
import { BASEMAPS, DEFAULT_VIEW } from './config.js';
import { SHAPES, SHAPE_KEYS, PALETTE, markerSvg, anchorFor, arrowSvg } from './icons.js';
import { detectFormat, parseTable, guessMapping, tableToPoints, geojsonToPoints, gpxToPoints, kmlToPoints } from './importers.js';
import { formatDateTime, formatDuration, formatDistance, setDisplayTimeZone, displayTimeZone, deviceTimeZone, timeZoneList, shiftTimes, isValidTimeZone } from './dates.js';
import { distanceMetres, bearing, formatCoord } from './coords.js';
import * as store from './store.js';
import { buildProject, readProject, looksLikeProjectText } from './project.js';
import { SAMPLES } from './samples.js';
import { createReplay } from './replay.js';
import { recordVideo, buildPdf, videoSupport } from './exporters.js';
import { initAnalytics, trackEvent } from './analytics.js';
import { PointLayer, popupOffset } from './pointlayer.js';

// ===================================================================== state

/** @type {Array<Dataset>} */
let datasets = [];
const layers = new Map(); // dataset id -> { group, points: PointLayer, order, untimed }
let prefs = { basemap: 'osm', displayTz: '', lastImportTz: '', lastBackup: 0, lastChange: 0 };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===================================================================== map

const map = L.map('map', { zoomControl: true, keyboard: true, worldCopyJump: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
const baseLayers = {};
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
map.createPane('dmFocus').style.zIndex = 640;       // invisible keyboard targets over the markers
map.getPane('dmPoints').style.pointerEvents = 'none';

// ===================================================================== utilities

function announce(msg) {
  const live = $('#live');
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 50);
}

let toastTimer;
/**
 * Show a short message at the bottom of the screen.
 * action: { label, onClick } adds a button (e.g. Undo). duration in ms (0 = stay until closed).
 */
function toast(msg, kind = 'info', { action = null, duration = 5000 } = {}) {
  const t = $('#toast');
  $('#toast-msg').textContent = msg;
  const btn = $('#toast-action');
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { t.hidden = true; action.onClick(); };
  }
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => { t.hidden = true; }, duration);
  return btn;
}

let saveTimer;
let saveFailed = false;
function save() {
  clearTimeout(saveTimer);
  prefs.lastChange = Date.now();
  saveTimer = setTimeout(async () => {
    const ok = await store.set('datasets', datasets);
    if (!ok && !saveFailed) {
      toast("Your latest changes couldn't be saved in this browser (it may be out of space). Save a project file now so you don't lose them.", 'error', { duration: 0, action: { label: 'Save project file', onClick: saveProjectFile } });
    }
    saveFailed = !ok;
    await store.set('prefs', prefs);
    updateStorageStatus();
  }, 300);
}
function savePrefs() { store.set('prefs', prefs); }

const replay = createReplay({ map, getDatasets: () => datasets, layers, announce });

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function safeFilename(s) { return String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'dataset'; }

/**
 * Fill a <select> with time zones. `deviceValue` is the value used for the
 * "this device" option ('' to follow the device, or its IANA name to pin it).
 */
let zoneNames = null;
function fillZoneSelect(sel, selected, deviceValue) {
  zoneNames = zoneNames || timeZoneList();
  const dev = deviceTimeZone();
  const common = ['UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;
  sel.innerHTML =
    opt(deviceValue, `This device (${dev.replace(/_/g, ' ')})`) +
    `<optgroup label="Common">${common.filter((z) => z !== dev && zoneNames.includes(z)).map((z) => opt(z, z === 'UTC' ? 'UTC (Coordinated Universal Time)' : z.replace(/_/g, ' '))).join('')}</optgroup>` +
    `<optgroup label="All time zones">${zoneNames.filter((z) => z !== 'UTC').map((z) => opt(z, z.replace(/_/g, ' '))).join('')}</optgroup>`;
  sel.value = selected === dev ? deviceValue : selected;
  if (sel.selectedIndex < 0) sel.value = deviceValue;
}

function defaultStyle(n, hasTimes) {
  const order = ['circle', 'square', 'pin', 'triangle', 'diamond', 'star', 'hexagon', 'flag', 'cross'];
  return {
    shape: order[n % order.length],
    color: PALETTE[n % PALETTE.length],
    size: 26,
    showLine: hasTimes,
    lineOrder: hasTimes ? 'time' : 'file',
    lineStyle: 'solid',
    showArrows: true,
    numbered: false,
  };
}

/** Indexes of points in drawing / stepping order, plus those left out. */
function sequenceOf(ds) {
  const idx = ds.points.map((_, i) => i);
  if (ds.style.lineOrder === 'time') {
    const timed = idx.filter((i) => ds.points[i].t !== null && ds.points[i].t !== undefined);
    timed.sort((a, b) => ds.points[a].t - ds.points[b].t || a - b);
    const untimed = idx.filter((i) => ds.points[i].t === null || ds.points[i].t === undefined);
    return { order: timed, untimed };
  }
  return { order: idx, untimed: [] };
}

function timeRange(ds) {
  let min = Infinity, max = -Infinity, n = 0;
  for (const p of ds.points) if (p.t !== null && p.t !== undefined) { n++; if (p.t < min) min = p.t; if (p.t > max) max = p.t; }
  return n ? { min, max, n } : null;
}

// ===================================================================== rendering datasets on the map

function renderDataset(ds) {
  removeLayers(ds.id);
  const group = L.featureGroup();
  const { order, untimed } = sequenceOf(ds);
  const seqPos = new Map(order.map((pi, k) => [pi, k]));
  const st = ds.style;

  // Line first so it draws under the markers
  if (st.showLine && order.length > 1) {
    const latlngs = order.map((i) => [ds.points[i].lat, ds.points[i].lon]);
    const dash = st.lineStyle === 'dashed' ? '10 8' : st.lineStyle === 'dotted' ? '2 7' : null;
    L.polyline(latlngs, { pane: 'tracks', color: '#fff', weight: 6, opacity: 0.75, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(group);
    L.polyline(latlngs, { pane: 'tracks', color: st.color, weight: 3, opacity: 0.95, dashArray: dash, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(group);

    if (st.showArrows) {
      const step = Math.max(1, Math.ceil((latlngs.length - 1) / 400));
      for (let k = 0; k < latlngs.length - 1; k += step) {
        const a = latlngs[k], b = latlngs[k + 1];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        L.marker(mid, {
          pane: 'arrows', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'dm-arrow', html: arrowSvg(st.color, bearing(a, b)), iconSize: [16, 16], iconAnchor: [8, 8] }),
        }).addTo(group);
      }
    }
  }

  // All markers for the dataset are drawn on one canvas
  const labels = new Map();
  if (st.numbered) seqPos.forEach((pos, i) => labels.set(i, pos + 1));
  const points = new PointLayer(ds, labels).addTo(group);
  points.on('redraw', scheduleFocusTargets);

  layers.set(ds.id, { group, points, order, untimed });
  if (ds.visible && !replay.active) group.addTo(map);
}

function removeLayers(id) {
  const l = layers.get(id);
  if (l) { map.removeLayer(l.group); layers.delete(id); }
}

function popupContent(ds, i) {
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

function linkify(s) {
  return /^https?:\/\/\S+$/.test(s) ? `<a href="${s}" target="_blank" rel="noopener">${s}</a>` : s;
}

/** Pan to a point and open its popup. */
function focusPoint(dsId, index, keepZoom = false) {
  const l = layers.get(dsId);
  const ds = datasets.find((d) => d.id === dsId);
  if (!l || !ds) return;
  if (replay.active) replay.close();
  if (!ds.visible) { ds.visible = true; l.group.addTo(map); renderList(); save(); }
  const p = ds.points[index];
  if (!p) return;
  const z = keepZoom ? map.getZoom() : Math.max(map.getZoom(), 15);
  map.setView([p.lat, p.lon], z, { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
  openPointPopup(ds, index);
  setTimeout(() => $('.leaflet-popup .pop-title')?.focus(), 60);
}

/** Open the details popup for one point. */
function openPointPopup(ds, i) {
  const p = ds.points[i];
  L.popup({ maxWidth: 320, minWidth: 220, autoPanPadding: [30, 30], offset: popupOffset(ds.style) })
    .setLatLng([p.lat, p.lon])
    .setContent(popupContent(ds, i))
    .openOn(map);
}

/** Visible point layers, topmost (last drawn) first. */
function pointLayersOnMap() {
  const out = [];
  for (const ds of datasets) {
    const l = layers.get(ds.id);
    if (l && map.hasLayer(l.points)) out.push(l.points);
  }
  return out.reverse();
}

function hitTest(containerPoint) {
  for (const pl of pointLayersOnMap()) {
    const i = pl.hitTest(containerPoint);
    if (i >= 0) return { ds: pl.ds, i };
  }
  return null;
}

function pointTitle(ds, i) {
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
const hoverTip = L.tooltip({ direction: 'top', offset: [0, -14], opacity: 0.95, className: 'dm-hover-tip' });
let hoverRaf = 0;
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
const FOCUS_LIMIT = 150;
let focusTimer = 0;
function scheduleFocusTargets() {
  clearTimeout(focusTimer);
  focusTimer = setTimeout(updateFocusTargets, 200);
}
function updateFocusTargets() {
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
let popupOpenerKey = null;
map.on('popupopen', (e) => {
  if (document.activeElement?.classList.contains('dm-focus')) {
    popupOpenerKey = document.activeElement.dataset.pt;
    setTimeout(() => e.popup.getElement()?.querySelector('.pop-title')?.focus(), 30);
  }
  const close = e.popup.getElement()?.querySelector('.leaflet-popup-close-button');
  if (close) close.setAttribute('aria-label', 'Close details');
});
map.on('popupclose', (e) => {
  const el = e.popup.getElement();
  if (popupOpenerKey && el && el.contains(document.activeElement)) {
    const target = map.getPane('dmFocus').querySelector(`[data-pt="${CSS.escape(popupOpenerKey)}"]`);
    (target || map.getContainer()).focus();
  }
  popupOpenerKey = null;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement?.closest('.leaflet-popup')) map.closePopup();
});

function fitAll() {
  const bounds = L.latLngBounds([]);
  datasets.forEach((d) => { if (d.visible) d.points.forEach((p) => bounds.extend([p.lat, p.lon])); });
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  else announce('There is no visible data to zoom to.');
}

function fitDataset(ds) {
  const b = L.latLngBounds(ds.points.map((p) => [p.lat, p.lon]));
  if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
}

// ===================================================================== side panel list

function renderList() {
  const list = $('#dataset-list');
  list.innerHTML = '';
  $('#empty-state').hidden = datasets.length > 0;
  const total = datasets.reduce((n, d) => n + d.points.length, 0);
  $('#panel-summary').textContent = datasets.length ? `${datasets.length} · ${total.toLocaleString()} points` : '';

  datasets.forEach((ds) => {
    const l = layers.get(ds.id);
    const tr = timeRange(ds);
    const li = document.createElement('li');
    li.className = 'ds-card' + (ds.visible ? '' : ' is-hidden');
    li.style.setProperty('--ds-color', ds.style.color);
    const meta = [`${ds.points.length.toLocaleString()} point${ds.points.length === 1 ? '' : 's'}`];
    if (tr) meta.push(tr.min === tr.max ? formatDateTime(tr.min) : `${formatDateTime(tr.min)} – ${formatDateTime(tr.max)}`);
    const warn = [];
    if (ds.style.showLine && ds.style.lineOrder === 'time' && l?.untimed.length) {
      warn.push(`${l.untimed.length} point${l.untimed.length === 1 ? ' has' : 's have'} no date/time, so ${l.untimed.length === 1 ? "it isn't" : "they aren't"} on the line.`);
    }
    if (ds.skipped?.length) warn.push(`${ds.skipped.length} row${ds.skipped.length === 1 ? ' was' : 's were'} skipped when importing.`);

    li.innerHTML = `
      <div class="ds-row">
        <label class="switch" title="Show or hide on map">
          <input type="checkbox" ${ds.visible ? 'checked' : ''} data-act="toggle">
          <span class="sr-only">Show ${esc(ds.name)} on map</span>
          <span class="switch-track" aria-hidden="true"></span>
        </label>
        <span class="ds-icon" aria-hidden="true">${markerSvg({ shape: ds.style.shape, color: ds.style.color, size: 26 })}</span>
        <div class="ds-text">
          <span class="ds-name">${esc(ds.name)}</span>
          <span class="ds-meta">${esc(meta.join(' · '))}</span>
        </div>
      </div>
      ${warn.length ? `<p class="ds-warn">${warn.map(esc).join(' ')}</p>` : ''}
      <div class="ds-actions" role="group" aria-label="Actions for ${esc(ds.name)}">
        <button type="button" class="btn btn-sm" data-act="zoom">Zoom to</button>
        <button type="button" class="btn btn-sm" data-act="settings">Style</button>
        <button type="button" class="btn btn-sm" data-act="table">Table</button>
        <details class="menu">
          <summary class="btn btn-sm">Export</summary>
          <div class="menu-pop">
            <button type="button" data-act="export-geojson">GeoJSON</button>
            <button type="button" data-act="export-csv">CSV</button>
          </div>
        </details>
        <button type="button" class="btn btn-sm btn-ghost-danger" data-act="remove" aria-label="Remove ${esc(ds.name)}">Remove</button>
      </div>`;

    li.addEventListener('change', (e) => {
      if (e.target.dataset.act === 'toggle') {
        ds.visible = e.target.checked;
        li.classList.toggle('is-hidden', !ds.visible);
        const g = layers.get(ds.id)?.group;
        if (replay.active) replay.refresh();
        else if (g) ds.visible ? g.addTo(map) : map.removeLayer(g);
        announce(`${ds.name} ${ds.visible ? 'shown' : 'hidden'}`);
        save();
      }
    });
    li.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || act === 'toggle') return;
      if (act === 'zoom') { if (!ds.visible) { ds.visible = true; renderDataset(ds); renderList(); save(); } fitDataset(ds); closePanelOnMobile(); }
      if (act === 'settings') openSettings(ds);
      if (act === 'table') openTable(ds);
      if (act === 'export-geojson') { exportGeoJSON(ds); e.target.closest('details').open = false; }
      if (act === 'export-csv') { exportCSV(ds); e.target.closest('details').open = false; }
      if (act === 'remove') removeDataset(ds);
    });
    list.appendChild(li);
  });
  $('#btn-export').disabled = !datasets.length;
  updateStorageStatus();
  replay.refresh();
}

function removeDataset(ds) {
  const index = datasets.indexOf(ds);
  removeLayers(ds.id);
  datasets = datasets.filter((d) => d.id !== ds.id);
  map.closePopup();
  renderList();
  save();
  const undoBtn = toast(`Removed "${ds.name}".`, 'info', {
    duration: 12000,
    action: {
      label: 'Undo',
      onClick: () => {
        datasets.splice(Math.min(index, datasets.length), 0, ds);
        renderDataset(ds);
        renderList();
        save();
        announce(`${ds.name} restored`);
        $('#btn-add').focus();
      },
    },
  });
  announce(`${ds.name} removed. Press Undo to bring it back.`);
  undoBtn.focus();
}

/**
 * Ask the user to choose. buttons: [{ value, label, kind }] where kind is
 * 'primary' | 'danger' | undefined. Resolves to the chosen value ('' if dismissed).
 */
function choiceDialog(title, message, buttons) {
  const dlg = $('#dlg-confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-msg').textContent = message;
  $('#confirm-buttons').innerHTML = buttons.map((b, i) =>
    `<button type="submit" class="btn${b.kind ? ` btn-${b.kind}` : ''}" value="${esc(b.value)}"${i === 0 ? ' autofocus' : ''}>${esc(b.label)}</button>`).join('');
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
  });
}

// ===================================================================== project files & storage safety

function saveProjectFile() {
  if (!datasets.length) { toast('There is nothing to save yet.'); return; }
  const stamp = new Date().toISOString().slice(0, 10);
  download(`Data_Mapper_project_${stamp}.json`, JSON.stringify(buildProject(datasets, prefs)), 'application/json');
  prefs.lastBackup = Date.now();
  savePrefs();
  updateStorageStatus();
  toast('Project file saved to your downloads. Open it with "Open project file" on any computer.');
  trackEvent('project-save');
}

/** Load a project file's text. Asks whether to add to or replace what's already loaded. */
async function openProjectText(text, fileName = 'project file') {
  let project;
  try {
    project = readProject(JSON.parse(text), defaultStyle);
  } catch (err) {
    toast(`Couldn't open ${fileName}: ${err.message}.`, 'error');
    return;
  }
  if (!project.datasets.length) { toast(`${fileName} has no datasets in it.`, 'error'); return; }
  let mode = 'add';
  if (datasets.length) {
    const n = project.datasets.length;
    mode = await choiceDialog('Open project file', `This project has ${n} dataset${n === 1 ? '' : 's'}. Add ${n === 1 ? 'it' : 'them'} to what's on the map now, or replace everything on the map with ${n === 1 ? 'it' : 'them'}?`, [
      { value: 'add', label: 'Add to the map', kind: 'primary' },
      { value: 'replace', label: 'Replace everything', kind: 'danger' },
      { value: '', label: 'Cancel' },
    ]);
    if (!mode) return;
  }
  if (mode === 'replace') {
    if (replay.active) replay.close();
    datasets.forEach((d) => removeLayers(d.id));
    datasets = [];
  }
  for (const ds of project.datasets) {
    ds.id = uid();
    datasets.push(ds);
    renderDataset(ds);
  }
  if (project.displayTimeZone !== null && mode === 'replace') {
    prefs.displayTz = isValidTimeZone(project.displayTimeZone) ? project.displayTimeZone : '';
    setDisplayTimeZone(prefs.displayTz);
    fillZoneSelect($('#display-tz'), prefs.displayTz || deviceTimeZone(), '');
  }
  renderList();
  save();
  fitAll();
  prefs.lastBackup = Date.now(); // what's loaded now matches a file the user has
  savePrefs();
  const pts = project.datasets.reduce((n, d) => n + d.points.length, 0);
  toast(`Opened ${project.datasets.length} dataset${project.datasets.length === 1 ? '' : 's'} (${pts.toLocaleString()} points)${project.dropped ? `. ${project.dropped} damaged points were left out` : ''}.`);
  announce('Project opened');
  trackEvent('project-open');
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60); if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h} hours ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The "Keep your work safe" box under the datasets. */
function updateStorageStatus() {
  const el = $('#storage-status');
  const box = $('#storage-box');
  $('#btn-save-project').disabled = !datasets.length;
  let msg, warn = false;
  if (saveFailed) {
    msg = "Your latest changes couldn't be saved in this browser. Save a project file so you don't lose them.";
    warn = true;
  } else if (!datasets.length) {
    msg = 'Your data stays on this device. Open a project file to carry on from another computer.';
  } else if (!prefs.lastBackup) {
    msg = "Your data is only kept in this browser. If browsing data is cleared, it's gone. Save a project file as a backup, or to move it to another computer.";
    warn = true;
  } else if (prefs.lastChange > prefs.lastBackup) {
    msg = `You've made changes since your last project file (${timeAgo(prefs.lastBackup)}). Save again to back them up.`;
    warn = Date.now() - prefs.lastBackup > 7 * 86400000;
  } else {
    msg = `Backed up to a project file ${timeAgo(prefs.lastBackup)}.`;
  }
  el.textContent = msg;
  box.classList.toggle('is-warn', warn);
}

$('#btn-save-project').addEventListener('click', saveProjectFile);
$('#btn-open-project').addEventListener('click', () => { $('#project-input').value = ''; $('#project-input').click(); });
$('#project-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) openProjectText(await f.text(), f.name);
});

// ===================================================================== style controls (shared)

/**
 * Render marker / line style controls into a container.
 * onChange(style) is called whenever something changes.
 */
function renderStyleControls(container, style, onChange, prefix) {
  const shapeRadios = SHAPE_KEYS.map((k) => `
    <label class="shape-opt" title="${SHAPES[k].label}">
      <input type="radio" name="${prefix}-shape" value="${k}" ${style.shape === k ? 'checked' : ''}>
      <span class="shape-swatch">${markerSvg({ shape: k, color: style.color, size: 26 })}</span>
      <span class="shape-name">${SHAPES[k].label}</span>
    </label>`).join('');
  const colorRadios = PALETTE.map((c, i) => `
    <label class="color-opt" title="Colour ${i + 1}">
      <input type="radio" name="${prefix}-color" value="${c}" ${style.color.toLowerCase() === c.toLowerCase() ? 'checked' : ''}>
      <span class="color-dot" style="background:${c}"></span><span class="sr-only">${c}</span>
    </label>`).join('');

  container.innerHTML = `
    <div class="field">
      <span class="field-label" id="${prefix}-shape-lbl">Marker shape</span>
      <div class="shape-grid" role="radiogroup" aria-labelledby="${prefix}-shape-lbl">${shapeRadios}</div>
    </div>
    <div class="field">
      <span class="field-label" id="${prefix}-color-lbl">Colour</span>
      <div class="color-row" role="radiogroup" aria-labelledby="${prefix}-color-lbl">
        ${colorRadios}
        <label class="color-custom"><span>Custom</span><input type="color" value="${style.color}" data-k="customColor"></label>
      </div>
    </div>
    <div class="grid-2">
      <div class="field">
        <label class="field-label" for="${prefix}-size">Marker size <span class="muted" data-out="size">${style.size}px</span></label>
        <input type="range" id="${prefix}-size" min="16" max="48" step="2" value="${style.size}" data-k="size">
      </div>
      <div class="field">
        <span class="field-label">Preview</span>
        <div class="style-preview" data-preview></div>
      </div>
    </div>
    <div class="field checks">
      <label><input type="checkbox" data-k="numbered" ${style.numbered ? 'checked' : ''}> Number the markers in order</label>
      <label><input type="checkbox" data-k="showLine" ${style.showLine ? 'checked' : ''}> Join the points with a line</label>
    </div>
    <div class="grid-3" data-line-opts>
      <div class="field">
        <label class="field-label" for="${prefix}-order">Join and number in</label>
        <select id="${prefix}-order" data-k="lineOrder">
          <option value="time" ${style.lineOrder === 'time' ? 'selected' : ''}>Date &amp; time order</option>
          <option value="file" ${style.lineOrder === 'file' ? 'selected' : ''}>Order in the file</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label" for="${prefix}-lstyle">Line style</label>
        <select id="${prefix}-lstyle" data-k="lineStyle">
          <option value="solid" ${style.lineStyle === 'solid' ? 'selected' : ''}>Solid</option>
          <option value="dashed" ${style.lineStyle === 'dashed' ? 'selected' : ''}>Dashed</option>
          <option value="dotted" ${style.lineStyle === 'dotted' ? 'selected' : ''}>Dotted</option>
        </select>
      </div>
      <div class="field checks">
        <label><input type="checkbox" data-k="showArrows" ${style.showArrows ? 'checked' : ''}> Direction arrows</label>
      </div>
    </div>`;

  const refresh = () => {
    $('[data-preview]', container).innerHTML =
      [1, 2, 3].map((n) => markerSvg({ shape: style.shape, color: style.color, size: style.size, label: style.numbered ? n : '' })).join('<span class="preview-line" style="background:' + (style.showLine ? style.color : 'transparent') + '"></span>');
    $$('.shape-swatch', container).forEach((sw, i) => { sw.innerHTML = markerSvg({ shape: SHAPE_KEYS[i], color: style.color, size: 26 }); });
    $('[data-out="size"]', container).textContent = `${style.size}px`;
    $('[data-line-opts]', container).classList.toggle('is-dim', !style.showLine && !style.numbered);
  };
  container.oninput = container.onchange = (e) => {
    const t = e.target;
    if (t.name === `${prefix}-shape`) style.shape = t.value;
    else if (t.name === `${prefix}-color`) { style.color = t.value; $('[data-k="customColor"]', container).value = t.value; }
    else if (t.dataset.k === 'customColor') { style.color = t.value; $$(`[name="${prefix}-color"]`, container).forEach((r) => { r.checked = r.value.toLowerCase() === t.value.toLowerCase(); }); }
    else if (t.dataset.k === 'size') style.size = Number(t.value);
    else if (t.type === 'checkbox' && t.dataset.k) style[t.dataset.k] = t.checked;
    else if (t.tagName === 'SELECT' && t.dataset.k) style[t.dataset.k] = t.value;
    else return;
    refresh();
    onChange(style);
  };
  refresh();
}

// ===================================================================== settings dialog

function openSettings(ds) {
  const dlg = $('#dlg-settings');
  $('#settings-title').textContent = `Style: ${ds.name}`;
  const name = $('#set-name');
  name.value = ds.name;
  name.oninput = () => { ds.name = name.value.trim() || 'Untitled'; $('#settings-title').textContent = `Style: ${ds.name}`; };
  // Time zone correction (only for times that didn't state their own zone)
  const tzField = $('#set-tz-field'), tzSel = $('#set-tz');
  const adjustable = ds.points.some((p) => p.t != null && !p.tzx);
  tzField.hidden = !adjustable;
  if (adjustable) {
    fillZoneSelect(tzSel, ds.timeZone || deviceTimeZone(), deviceTimeZone());
    tzSel.onchange = () => {
      const from = ds.timeZone || deviceTimeZone();
      const to = tzSel.value;
      if (!to || to === from) return;
      shiftTimes(ds.points, from, to);
      ds.timeZone = to;
      renderDataset(ds);
      replay.refresh();
      announce(`Times in ${ds.name} now read as ${to.replace(/_/g, ' ')} time`);
    };
  }
  let pending = 0;
  renderStyleControls($('#set-style'), ds.style, () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => { renderDataset(ds); replay.refresh(); });
  }, 'set');
  dlg.onclose = () => { renderDataset(ds); renderList(); save(); };
  dlg.showModal();
}

// ===================================================================== table dialog

function openTable(ds) {
  const l = layers.get(ds.id);
  const indexes = [...l.order, ...l.untimed];
  const fields = [...new Set(ds.points.flatMap((p) => Object.keys(p.props || {})))].slice(0, 12);
  const LIMIT = 2000;
  $('#table-title').textContent = `${ds.name}: ${ds.points.length.toLocaleString()} points`;
  const head = `<caption class="sr-only">Points in ${esc(ds.name)}, ${ds.style.lineOrder === 'time' ? 'in date and time order' : 'in file order'}</caption>
    <thead><tr><th scope="col">#</th><th scope="col">Name</th><th scope="col">Date &amp; time</th><th scope="col">Latitude</th><th scope="col">Longitude</th>${fields.map((f) => `<th scope="col">${esc(f)}</th>`).join('')}<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>`;
  const body = indexes.slice(0, LIMIT).map((i, k) => {
    const p = ds.points[i];
    const n = k < l.order.length ? k + 1 : '–';
    return `<tr><td>${n}</td><td>${esc(p.label)}</td><td>${p.t != null ? esc(formatDateTime(p.t)) : ''}</td><td class="mono">${p.lat.toFixed(6)}</td><td class="mono">${p.lon.toFixed(6)}</td>${fields.map((f) => `<td>${esc(p.props?.[f] ?? '')}</td>`).join('')}<td><button type="button" class="btn btn-sm" data-show="${i}">Show on map</button></td></tr>`;
  }).join('');
  const more = indexes.length > LIMIT ? `<tfoot><tr><td colspan="${fields.length + 6}">Showing the first ${LIMIT.toLocaleString()} rows. Export to see everything.</td></tr></tfoot>` : '';
  const table = $('#data-table');
  table.innerHTML = head + `<tbody>${body}</tbody>` + more;
  table.onclick = (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    $('#dlg-table').close();
    closePanelOnMobile();
    focusPoint(ds.id, Number(b.dataset.show));
  };
  $('#dlg-table').showModal();
}

// ===================================================================== export

function exportGeoJSON(ds) {
  const l = layers.get(ds.id);
  const features = ds.points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { name: p.label || undefined, time: p.t != null ? new Date(p.t).toISOString() : undefined, ...p.props },
  }));
  if (ds.style.showLine && l.order.length > 1) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: l.order.map((i) => [ds.points[i].lon, ds.points[i].lat]) },
      properties: { name: `${ds.name} track` },
    });
  }
  download(`${safeFilename(ds.name)}.geojson`, JSON.stringify({ type: 'FeatureCollection', name: ds.name, features }, null, 2), 'application/geo+json');
  announce(`${ds.name} exported as GeoJSON`);
}

function exportCSV(ds) {
  const fields = [...new Set(ds.points.flatMap((p) => Object.keys(p.props || {})))];
  const rows = [['name', 'latitude', 'longitude', 'datetime', ...fields]];
  const l = layers.get(ds.id);
  [...l.order, ...l.untimed].forEach((i) => {
    const p = ds.points[i];
    rows.push([p.label, p.lat, p.lon, p.t != null ? new Date(p.t).toISOString() : '', ...fields.map((f) => p.props?.[f] ?? '')]);
  });
  download(`${safeFilename(ds.name)}.csv`, Papa.unparse(rows), 'text/csv');
  announce(`${ds.name} exported as CSV`);
}

// ===================================================================== import flow

const importDlg = $('#dlg-import');
let queue = [];       // [{ name, text }]
let pending = null;   // current item being configured
let addedThisSession = 0;

function openImport(tab = 'file') {
  showImportStep('source');
  selectTab(tab);
  $('#paste-input').value = '';
  $('#file-input').value = '';
  queue = [];
  addedThisSession = 0;
  if (!importDlg.open) importDlg.showModal();
  (tab === 'paste' ? $('#paste-input') : $('#tab-file')).focus();
}

function showImportStep(step) {
  $('#import-step-source').hidden = step !== 'source';
  $('#import-step-map').hidden = step !== 'map';
  $('#import-foot').hidden = step !== 'map';
  $('#import-title').textContent = step === 'source' ? 'Add data' : 'Check your data';
}

function selectTab(which) {
  ['file', 'paste'].forEach((t) => {
    const on = t === which;
    $(`#tab-${t}`).setAttribute('aria-selected', String(on));
    $(`#tab-${t}`).tabIndex = on ? 0 : -1;
    $(`#pane-${t}`).hidden = !on;
  });
}
$$('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.id.replace('tab-', '')));
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = tab.id === 'tab-file' ? 'paste' : 'file';
      selectTab(next);
      $(`#tab-${next}`).focus();
    }
  });
});

async function readFiles(fileList) {
  const files = Array.from(fileList);
  const items = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
  return items;
}

function startQueue(items) {
  queue = items;
  if (!importDlg.open) importDlg.showModal();
  nextInQueue();
}

function nextInQueue() {
  if (!queue.length) {
    importDlg.close();
    if (addedThisSession) fitAll();
    return;
  }
  const item = queue.shift();
  if (looksLikeProjectText(item.text)) {
    importDlg.close();
    openProjectText(item.text, item.name).then(() => { if (queue.length) startQueue(queue); });
    return;
  }
  try {
    configureItem(item);
  } catch (err) {
    toast(`Couldn't read ${item.name}: ${err.message}`, 'error');
    nextInQueue();
  }
}

function configureItem(item) {
  const format = detectFormat(item.text, item.name);
  const n = datasets.length + addedThisSession;
  const baseName = item.name.replace(/\.[^.]+$/, '') || `Dataset ${n + 1}`;
  pending = { item, format, name: baseName, table: null, map: null, result: null, style: null };

  if (format === 'table') {
    pending.table = parseTable(item.text);
    if (!pending.table.rows.length) throw new Error('no rows found');
    pending.map = guessMapping(pending.table);
  } else {
    const parse = format === 'geojson' ? geojsonToPoints : format === 'gpx' ? gpxToPoints : kmlToPoints;
    pending.parseGeo = (zone) => parse(item.text, zone);
  }
  fillZoneSelect($('#imp-tz'), isValidTimeZone(prefs.lastImportTz) ? prefs.lastImportTz : deviceTimeZone(), '');

  showImportStep('map');
  $('#import-file-label').textContent = item.name === 'Pasted data' ? 'From pasted data' : `From file: ${item.name}`;
  $('#imp-name').value = baseName;
  $('#imp-columns').hidden = format !== 'table';
  $('#imp-preview-wrap').hidden = format !== 'table';
  $('#btn-import-skip').hidden = queue.length === 0;
  $('#import-queue').textContent = queue.length ? `${queue.length} more file${queue.length === 1 ? '' : 's'} after this` : '';

  if (format === 'table') fillMappingControls();
  recompute();

  const hasTimes = pending.result.points.filter((p) => p.t != null).length >= 2;
  pending.style = defaultStyle(n, hasTimes);
  renderStyleControls($('#imp-style'), pending.style, () => {}, 'imp');
  $('#imp-name').focus();
  $('#imp-name').select();
}

function fillMappingControls() {
  const { headers } = pending.table;
  const m = pending.map;
  const opts = (sel, allowNone) => {
    const el = $(sel);
    el.innerHTML = (allowNone ? '<option value="-1">— None —</option>' : '<option value="-1">— Choose a column —</option>') +
      headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('');
  };
  opts('#imp-lat'); opts('#imp-lon'); opts('#imp-coords');
  opts('#imp-datetime', true); opts('#imp-date', true); opts('#imp-time', true); opts('#imp-label', true);

  $('#imp-lat').value = m.lat; $('#imp-lon').value = m.lon; $('#imp-coords').value = m.coords;
  $('#imp-order').value = m.order;
  $('#imp-datetime').value = m.datetime; $('#imp-date').value = m.date; $('#imp-time').value = m.time;
  $('#imp-dateorder').value = m.dateOrder;
  $('#imp-label').value = m.label;
  $(`[name="coordmode"][value="${m.mode}"]`).checked = true;
  const tmode = m.datetime >= 0 ? 'single' : m.date >= 0 ? (m.time >= 0 ? 'split' : 'single') : 'none';
  if (tmode === 'single' && m.datetime < 0 && m.date >= 0) { $('#imp-datetime').value = m.date; }
  $(`[name="timemode"][value="${tmode}"]`).checked = true;
  syncModeVisibility();
}

function syncModeVisibility() {
  const cm = $('[name="coordmode"]:checked').value;
  $$('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== cm; });
  const tm = $('[name="timemode"]:checked').value;
  $$('[data-show-time]').forEach((el) => { el.hidden = !el.dataset.showTime.split(' ').includes(tm); });
}

function readMappingControls() {
  const v = (s) => Number($(s).value);
  const tm = $('[name="timemode"]:checked').value;
  return {
    mode: $('[name="coordmode"]:checked').value,
    lat: v('#imp-lat'), lon: v('#imp-lon'), coords: v('#imp-coords'),
    order: $('#imp-order').value,
    datetime: tm === 'single' ? v('#imp-datetime') : -1,
    date: tm === 'split' ? v('#imp-date') : -1,
    time: tm === 'split' ? v('#imp-time') : -1,
    dateOrder: $('#imp-dateorder').value,
    label: v('#imp-label'),
    timeZone: importZone(),
  };
}

/** The zone chosen on the import screen, as an IANA name. */
function importZone() {
  return $('#imp-tz').value || deviceTimeZone();
}

function recompute() {
  if (pending.format === 'table') {
    pending.map = readMappingControls();
    pending.result = tableToPoints(pending.table, pending.map);
    renderPreview();
  } else {
    pending.result = pending.parseGeo(importZone());
  }
  updateZoneHint();
  const { points, skipped } = pending.result;
  const timed = points.filter((p) => p.t != null).length;
  const total = pending.format === 'table' ? pending.table.rows.length : points.length + skipped.length;
  const status = $('#imp-status');
  const goBtn = $('#btn-import-go');
  if (!points.length) {
    status.dataset.kind = 'error';
    status.innerHTML = pending.format === 'table'
      ? '<strong>No points could be read yet.</strong> Choose the columns that hold the latitude and longitude.'
      : '<strong>No points found in this file.</strong>';
    goBtn.disabled = true;
  } else {
    status.dataset.kind = skipped.length ? 'warn' : 'ok';
    const parts = [`<strong>${points.length.toLocaleString()} of ${total.toLocaleString()} ${pending.format === 'table' ? 'rows' : 'points'} will be mapped.</strong>`];
    if (timed) parts.push(timed === points.length ? 'All have a date and time.' : `${timed.toLocaleString()} ${timed === 1 ? 'has' : 'have'} a date and time.`);
    else if (pending.format === 'table' && $('[name="timemode"]:checked').value !== 'none') parts.push('No dates or times could be read from the chosen column.');
    if (skipped.length) parts.push(`${skipped.length.toLocaleString()} will be skipped.`);
    status.innerHTML = parts.join(' ');
    goBtn.disabled = false;
  }
  const det = $('#imp-skipped');
  det.hidden = !skipped.length;
  $('#imp-skipped-list').innerHTML = skipped.slice(0, 100).map((s) => `<li>Row ${s.row}: ${esc(s.reason)}</li>`).join('') +
    (skipped.length > 100 ? `<li>…and ${skipped.length - 100} more</li>` : '');
}

function renderPreview() {
  const { headers, rows } = pending.table;
  const m = pending.map;
  const role = (i) => {
    if (m.mode === 'separate' && i === m.lat) return 'Latitude';
    if (m.mode === 'separate' && i === m.lon) return 'Longitude';
    if (m.mode === 'combined' && i === m.coords) return 'Coordinates';
    if (i === m.datetime) return 'Date & time';
    if (i === m.date) return 'Date';
    if (i === m.time) return 'Time';
    if (i === m.label) return 'Name';
    return '';
  };
  const firstRows = rows.slice(0, 6);
  const parsedBySrc = new Map(pending.result.points.map((p) => [p.src, p]));
  $('#imp-preview').innerHTML = `<caption>Preview of the first ${firstRows.length} of ${rows.length.toLocaleString()} rows</caption>
    <thead><tr><th scope="col">Result</th>${headers.map((h, i) => `<th scope="col" class="${role(i) ? 'is-used' : ''}">${esc(h)}${role(i) ? `<span class="role-tag">${role(i)}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${firstRows.map((r, ri) => {
      const p = parsedBySrc.get(ri + 1);
      const res = p ? `<span class="ok-tag">✓ ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}${p.t != null ? `<br>${esc(formatDateTime(p.t))}` : ''}</span>` : '<span class="bad-tag">✕ Skipped</span>';
      return `<tr><td>${res}</td>${r.map((c, i) => `<td class="${role(i) ? 'is-used' : ''}">${esc(c)}</td>`).join('')}</tr>`;
    }).join('')}</tbody>`;
}

$('#imp-columns').addEventListener('change', () => { syncModeVisibility(); recompute(); });
$('#imp-tz').addEventListener('change', recompute);

/** Explain whether the import time zone matters for this file. */
function updateZoneHint() {
  const pts = pending.result.points;
  const timed = pts.filter((p) => p.t != null).length;
  const explicit = pts.filter((p) => p.tzx).length;
  const field = $('#imp-tz-field'), sel = $('#imp-tz'), hint = $('#imp-tz-hint');
  field.hidden = timed === 0;
  sel.disabled = timed > 0 && explicit === timed;
  hint.textContent = explicit === timed
    ? 'These times already say which time zone they\'re in (for example "Z" or "+01:00"), so they\'re used exactly as written.'
    : explicit
      ? `${explicit.toLocaleString()} of the times say which time zone they're in and are used as written. This setting is for the other ${(timed - explicit).toLocaleString()}.`
      : 'These times don\'t say which time zone they\'re in. Choose where they were recorded so they line up with your other data.';
}

$('#btn-import-go').addEventListener('click', () => {
  if (!pending?.result?.points.length) return;
  const ds = {
    id: uid(),
    name: $('#imp-name').value.trim() || pending.name,
    visible: true,
    style: pending.style,
    points: pending.result.points,
    skipped: pending.result.skipped,
    source: pending.item.name,
    createdAt: Date.now(),
    timeZone: importZone(),
  };
  prefs.lastImportTz = $('#imp-tz').value ? importZone() : '';
  savePrefs();
  addDataset(ds);
  addedThisSession++;
  trackEvent(pending.item.name === 'Pasted data' ? 'import-paste' : 'import-file');
  announce(`Added ${ds.name} with ${ds.points.length} points${ds.skipped.length ? `, ${ds.skipped.length} rows skipped` : ''}.`);
  nextInQueue();
});
$('#btn-import-skip').addEventListener('click', nextInQueue);
$('#btn-import-back').addEventListener('click', () => { queue = []; showImportStep('source'); });

$('#file-input').addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  startQueue(await readFiles(e.target.files));
});
$('#btn-use-paste').addEventListener('click', () => {
  const text = $('#paste-input').value;
  if (!text.trim()) { toast('Paste some data into the box first.', 'error'); $('#paste-input').focus(); return; }
  startQueue([{ name: 'Pasted data', text }]);
});

// Drag and drop anywhere on the page
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  dz.classList.add('is-over');
  document.body.classList.add('is-dragging');
}));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  if (ev === 'dragleave' && e.relatedTarget) return;
  dz.classList.remove('is-over');
  document.body.classList.remove('is-dragging');
}));
document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  addedThisSession = 0;
  startQueue(await readFiles(e.dataTransfer.files));
});

// Paste anywhere on the map (outside text fields) to start an import
document.addEventListener('paste', (e) => {
  const t = e.target;
  if (t.closest && (t.closest('input, textarea, [contenteditable]') || t.closest('dialog[open]'))) return;
  const text = e.clipboardData?.getData('text/plain');
  if (!text || !text.trim()) return;
  e.preventDefault();
  addedThisSession = 0;
  startQueue([{ name: 'Pasted data', text }]);
});

// ===================================================================== dataset lifecycle

function addDataset(ds) {
  datasets.push(ds);
  renderDataset(ds);
  renderList();
  save();
  // Ask the browser to keep our data even when space runs low (most agree silently)
  store.requestPersistence();
}

function loadSamples() {
  SAMPLES.forEach((s, k) => {
    const table = parseTable(s.text);
    const timeZone = s.timeZone || deviceTimeZone();
    const res = tableToPoints(table, { ...guessMapping(table), timeZone });
    const style = { ...defaultStyle(datasets.length, res.points.some((p) => p.t != null)), ...s.style };
    addDataset({ id: uid(), name: s.name, visible: true, style, points: res.points, skipped: res.skipped, source: 'Sample', createdAt: Date.now() + k, timeZone });
  });
  fitAll();
  announce('Sample data added');
  trackEvent('sample-data');
}

// ===================================================================== dialogs & buttons

$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
// Click on the backdrop closes the dialog
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

$('#btn-add').addEventListener('click', () => openImport('file'));
$('#btn-add-empty').addEventListener('click', () => openImport('file'));
$('#btn-sample').addEventListener('click', loadSamples);
$('#btn-fit').addEventListener('click', fitAll);
$('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());

// ===================================================================== export (PDF / video)

const exportDlg = $('#dlg-export');
let exportRun = null; // { kind, controller } while an export is running

function exportKind() { return $('[name="exportkind"]:checked').value; }
function canVideo() { return replay.hasTimedData() && !!videoSupport(); }

function syncExportKind() {
  const kind = exportKind();
  $$('[data-kind]', exportDlg).forEach((el) => { el.hidden = el.dataset.kind !== kind; });
  $('#ex-go').textContent = kind === 'pdf' ? 'Create PDF' : 'Record video';
  const follow = $('[name="exview"][value="follow"]');
  if (kind !== 'video' && follow.checked) $('[name="exview"][value="fit"]').checked = true;
  const view = $('[name="exview"]:checked').value;
  $('#ex-follow-opts').hidden = !(kind === 'video' && view === 'follow');
  $('#ex-view-hint').textContent = view === 'follow'
    ? 'The camera glides along with the moving markers. Moving the map on screen won\'t change the video.'
    : 'The map is fixed when you start. Moving the map on screen won\'t change the export.';
}

function fillFollowTargets() {
  const sel = $('#ex-follow-target');
  const prev = sel.value;
  const timed = datasets.filter((d) => d.visible && d.points.some((p) => p.t !== null && p.t !== undefined));
  sel.innerHTML = (timed.length > 1 ? '<option value="all">All moving datasets</option>' : '') +
    timed.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function openExport(kind = 'pdf') {
  if (exportRun) return;
  const support = videoSupport();
  $('#video-desc').textContent = !support
    ? "This browser can't record video. Try a recent version of Chrome, Edge, Firefox or Safari."
    : !replay.hasTimedData()
      ? 'Needs data with dates and times.'
      : `The routes moving over time, with the date and time on screen. Saved as ${support.ext.toUpperCase()}.`;
  $(`[name="exportkind"][value="${kind === 'video' && canVideo() ? 'video' : 'pdf'}"]`).checked = true;
  $('#ex-trail').value = replay.trail || 'all';
  fillFollowTargets();
  $('#ex-progress').hidden = true;
  setExportBusy(false);
  syncExportKind();
  exportDlg.showModal();
  $('#ex-title').focus();
}

function setExportBusy(busy) {
  $$('input, select, textarea', exportDlg).forEach((el) => {
    el.disabled = busy || (el.name === 'exportkind' && el.value === 'video' && !canVideo());
  });
  $('#ex-go').disabled = busy;
  $('#ex-cancel').textContent = busy && exportKind() === 'video' ? 'Stop recording' : 'Cancel';
  $('#ex-cancel').disabled = busy && exportKind() === 'pdf';
}

function exportProgress(frac, msg) {
  $('#ex-progress').hidden = false;
  $('#ex-bar').value = frac;
  if (msg) $('#ex-status').textContent = msg;
}

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function runExport() {
  const kind = exportKind();
  const title = $('#ex-title').value.trim();
  const view = $('[name="exview"]:checked').value;
  const visible = datasets.filter((d) => d.visible);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${safeFilename(title || (kind === 'pdf' ? 'map-report' : 'route-replay'))}_${stamp}`;
  const controller = new AbortController();
  exportRun = { kind, controller };
  setExportBusy(true);
  map.closePopup();
  try {
    if (kind === 'pdf') {
      const blob = await buildPdf({
        map, replay, datasets: visible, sequenceOf,
        opts: {
          title,
          preparedFor: $('#ex-for').value.trim(),
          notes: $('#ex-notes').value,
          paper: $('#ex-paper').value,
          view,
          tables: $('#ex-tables').checked,
          extraColumns: $('#ex-extra').checked,
        },
        onProgress: exportProgress,
      });
      downloadBlob(`${base}.pdf`, blob);
      exportDlg.close();
      toast('PDF report saved to your downloads.');
      trackEvent('export-pdf');
      announce('PDF report saved');
    } else {
      exportProgress(0, 'Getting the map ready…');
      const res = await recordVideo({
        map, replay, datasets: visible, signal: controller.signal,
        opts: {
          title,
          seconds: Number($('#ex-length').value),
          size: $('#ex-size').value,
          camera: view,
          followTarget: $('#ex-follow-target').value || 'all',
          followZoom: Number($('#ex-follow-zoom').value),
          trail: $('#ex-trail').value,
        },
        onProgress: exportProgress,
      });
      if (!res) { exportProgress(0, 'Recording stopped.'); return; }
      downloadBlob(`${base}.${res.ext}`, res.blob);
      exportDlg.close();
      toast(res.tilesOk ? 'Video saved to your downloads.' : "Video saved, but the map background couldn't be included.");
      announce('Video saved');
      trackEvent(view === 'follow' ? 'export-video-follow' : 'export-video');
    }
  } catch (err) {
    exportProgress(0, `Sorry, that didn't work: ${err.message}`);
    toast(`Export failed: ${err.message}`, 'error');
  } finally {
    exportRun = null;
    setExportBusy(false);
  }
}

$('#btn-export').addEventListener('click', () => openExport('pdf'));
$('#btn-replay').addEventListener('click', () => { if (replay.active) trackEvent('replay'); });
$('#rp-video').addEventListener('click', () => openExport('video'));
$$('[name="exportkind"]').forEach((r) => r.addEventListener('change', () => { syncExportKind(); setExportBusy(false); }));
$$('[name="exview"]').forEach((r) => r.addEventListener('change', syncExportKind));
$('#ex-go').addEventListener('click', runExport);
$('#ex-cancel').addEventListener('click', () => {
  if (exportRun?.kind === 'video') exportRun.controller.abort();
  else if (!exportRun) exportDlg.close();
});
// Don't let Esc or a backdrop click close the dialog mid-export
exportDlg.addEventListener('cancel', (e) => { if (exportRun) e.preventDefault(); });
exportDlg.addEventListener('click', (e) => { if (exportRun && e.target === exportDlg) e.stopImmediatePropagation(); }, true);
$('#btn-sample-csv').addEventListener('click', () => download('sample-track.csv', SAMPLES[0].text, 'text/csv'));

const panel = $('#panel');
const panelBtn = $('#btn-panel');
panelBtn.addEventListener('click', () => {
  const open = !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  panelBtn.setAttribute('aria-expanded', String(open));
  if (open) panel.focus();
  setTimeout(() => map.invalidateSize(), 250);
});
function closePanelOnMobile() {
  if (matchMedia('(max-width: 760px)').matches && panel.classList.contains('open')) {
    panel.classList.remove('open');
    panelBtn.setAttribute('aria-expanded', 'false');
  }
}

// Files opened via the OS "Open with" / share target (installed PWA)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    startQueue(await readFiles(files));
  });
}

// ===================================================================== start-up

// "Show times in" setting
$('#display-tz').addEventListener('change', (e) => {
  prefs.displayTz = e.target.value;
  setDisplayTimeZone(prefs.displayTz);
  savePrefs();
  map.closePopup();
  renderList();
  scheduleFocusTargets();
  announce(`Times are now shown in ${displayTimeZone().replace(/_/g, ' ')} time`);
});

(async function init() {
  const savedPrefs = await store.get('prefs');
  if (savedPrefs) prefs = { ...prefs, ...savedPrefs };
  setDisplayTimeZone(prefs.displayTz);
  fillZoneSelect($('#display-tz'), prefs.displayTz || deviceTimeZone(), '');
  const base = BASEMAPS.find((b) => b.id === prefs.basemap) || BASEMAPS[0];
  baseLayers[base.name].addTo(map);

  const saved = await store.get('datasets');
  if (Array.isArray(saved) && saved.length) {
    datasets = saved;
    datasets.forEach(renderDataset);
    fitAll();
  }
  renderList();
  updateStorageStatus();
  setInterval(updateStorageStatus, 60000); // keep "x minutes ago" current
  // On phones, show the "No data yet" panel straight away so people know where to start
  if (!datasets.length && matchMedia('(max-width: 760px)').matches) {
    panel.classList.add('open');
    panelBtn.setAttribute('aria-expanded', 'true');
  }
})();

initAnalytics();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// The app's shared data: the datasets, their map layers and the user's
// preferences, plus saving them in this browser. Other parts of the app listen
// for changes with onChange() and plug into saving through `hooks`.

import { PALETTE } from './icons.js';
import * as store from './store.js';
import { EMPTY_FILTER } from './filters.js';
import { DEFAULT_ANALYSIS } from './analysis.js';

/** @type {Array<Dataset>} */
export const datasets = [];

// dataset id -> { group, points: PointLayer, order, untimed, mask, analysis, eventMarkers }
// `order` / `untimed` only include points that pass the filter; `mask` marks them (null = all).
export const layers = new Map();

/** Road speeds are usually given in mph in the UK and US. */
export const DEFAULT_SPEED_UNIT = /^en-(GB|US)$/i.test(globalThis.navigator?.language || '') ? 'mph' : 'kmh';

export const prefs = {
  basemap: 'osm', displayTz: '', lastImportTz: '', lastBackup: 0, lastChange: 0,
  filter: { ...EMPTY_FILTER },
  analysis: { ...DEFAULT_ANALYSIS, speedUnit: DEFAULT_SPEED_UNIT, jumpSpeed: DEFAULT_SPEED_UNIT === 'mph' ? 150 : 240 },
  branding: { logo: '', logoW: 0, logoH: 0, name: '', extras: true, pdfSize: 1, videoSize: 1, panel: true, trimmed: false },
};

/** Logo (a PNG data: URL and its size in pixels), organisation name, and map scale bar / north arrow on exports. */
export const DEFAULT_BRANDING = { logo: '', logoW: 0, logoH: 0, name: '', extras: true, pdfSize: 1, videoSize: 1, panel: true, trimmed: false };

/** Fill in any settings added since the preferences were saved. */
export function completePrefs() {
  prefs.filter = { ...EMPTY_FILTER, ...(prefs.filter || {}) };
  prefs.analysis = { ...DEFAULT_ANALYSIS, speedUnit: DEFAULT_SPEED_UNIT, ...(prefs.analysis || {}) };
  prefs.branding = { ...DEFAULT_BRANDING, ...(prefs.branding || {}) };
}

let saveTimer = 0;

export let saveFailed = false;

export function save() {
  clearTimeout(saveTimer);
  prefs.lastChange = Date.now();
  saveTimer = setTimeout(async () => {
    saveTimer = 0;
    const ok = await store.set('datasets', datasets);
    if (!ok && !saveFailed) hooks.saveFailed();
    saveFailed = !ok;
    await store.set('prefs', prefs);
    hooks.saved();
  }, 300);
}

export function savePrefs() { store.set('prefs', prefs); }

// Saving waits a moment so quick changes are written together. If the page is
// closed, reloaded or hidden during that moment, write straight away instead.
export function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  store.set('datasets', datasets);
  store.set('prefs', prefs);
}

window.addEventListener('pagehide', flushSave);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });

export function defaultStyle(n, hasTimes) {
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
    colourBy: 'none',
    // Road speeds are usually given in mph in the UK and US
    speedUnit: /^en-(GB|US)$/i.test(navigator.language || '') ? 'mph' : 'kmh',
  };
}

export const SHAPE_ORDER = ['circle', 'square', 'pin', 'triangle', 'diamond', 'star', 'hexagon', 'flag', 'cross'];

/** Indexes of points in drawing / stepping order, plus those left out. */
export function sequenceOf(ds) {
  const idx = ds.points.map((_, i) => i);
  if (ds.style.lineOrder === 'time') {
    const timed = idx.filter((i) => ds.points[i].t !== null && ds.points[i].t !== undefined);
    timed.sort((a, b) => ds.points[a].t - ds.points[b].t || a - b);
    const untimed = idx.filter((i) => ds.points[i].t === null || ds.points[i].t === undefined);
    return { order: timed, untimed };
  }
  return { order: idx, untimed: [] };
}

export function timeRange(ds) {
  let min = Infinity, max = -Infinity, n = 0;
  for (const p of ds.points) if (p.t !== null && p.t !== undefined) { n++; if (p.t < min) min = p.t; if (p.t > max) max = p.t; }
  return n ? { min, max, n } : null;
}

/** Things other parts of the app plug into, so this module doesn't depend on them. */
export const hooks = {
  saved: () => {},       // after each save (storage figures may have changed)
  saveFailed: () => {},  // the browser refused to save
};

const changeListeners = [];
/** Run `fn` whenever datasets are added, removed or changed. */
export function onChange(fn) { changeListeners.push(fn); }
/** Tell listeners (such as the Datasets panel) that datasets have changed. */
export function changed() { changeListeners.forEach((fn) => fn()); }

// Colouring markers and lines by a value: speed, time, or any numeric column.
//
// The colour scale is "viridis": it runs dark purple → blue → green → yellow,
// stays readable for people with colour-blindness and prints well in greyscale.

import { distanceMetres } from './coords.js';
import { formatShort } from './dates.js';

const RAMP = ['#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];
export const BINS = 12;
export const NO_VALUE = 255;          // bin used for points without a value
export const NO_VALUE_COLOUR = '#9aa3ad';

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour at position f (0..1) along the scale. */
export function rampColour(f) {
  const x = Math.min(1, Math.max(0, f)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const a = hexToRgb(RAMP[i]), b = hexToRgb(RAMP[i + 1]), t = x - i;
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The colours used for each bin (bin k is the middle of its band). */
export const BIN_COLOURS = Array.from({ length: BINS }, (_, k) => rampColour((k + 0.5) / BINS));

/** CSS gradient for showing the scale in the page. */
export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.join(', ')})`;
export const RAMP_STOPS = RAMP;

/** True if most non-empty values of a column are numbers. */
function isNumericColumn(points, key) {
  let n = 0, num = 0;
  const seen = new Set();
  for (const p of points) {
    const v = p.props?.[key];
    if (v === undefined || v === '') continue;
    n++;
    const x = toNumber(v);
    if (x !== null) { num++; if (seen.size < 3) seen.add(x); }
    if (n >= 500) break;
  }
  return n > 0 && num / n >= 0.8 && seen.size >= 2;
}

function toNumber(v) {
  const s = String(v).trim().replace(/,(?=\d{3}\b)/g, '');
  return /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : null;
}

/**
 * Options for the "Colour by" menu for these points.
 * Returns [{ value, label }].
 */
export function colourByOptions(points) {
  const opts = [{ value: 'none', label: 'Nothing (one colour)' }];
  const timed = points.filter((p) => p.t !== null && p.t !== undefined).length;
  if (timed >= 2) {
    opts.push({ value: 'speed', label: 'Speed (worked out from times and distances)' });
    opts.push({ value: 'time', label: 'Time (earliest to latest)' });
  }
  const keys = new Set();
  for (const p of points.slice(0, 500)) Object.keys(p.props || {}).forEach((k) => keys.add(k));
  for (const k of keys) if (isNumericColumn(points, k)) opts.push({ value: `col:${k}`, label: `Column: ${k}` });
  return opts;
}

const SPEED_UNITS = {
  kmh: { label: 'km/h', perMs: 3600 },        // metres per millisecond → km/h
  mph: { label: 'mph', perMs: 3600 / 1.609344 },
  ms: { label: 'm/s', perMs: 1000 },
};

/**
 * Work out each point's value and colour band.
 * Returns null for "none", otherwise
 * { bins: Uint8Array, values: Float64Array, min, max, title, format(v) }.
 */
export function computeColours(ds) {
  const by = ds.style.colourBy || 'none';
  if (by === 'none') return null;
  const pts = ds.points;
  const n = pts.length;
  const values = new Float64Array(n).fill(NaN);
  let title, format;

  if (by === 'speed') {
    const unit = SPEED_UNITS[ds.style.speedUnit] || SPEED_UNITS.kmh;
    const order = pts.map((_, i) => i).filter((i) => pts[i].t != null).sort((a, b) => pts[a].t - pts[b].t || a - b);
    // Speed at a point = speed of the leg arriving there (the first point uses the first leg)
    for (let k = 1; k < order.length; k++) {
      const a = pts[order[k - 1]], b = pts[order[k]];
      const dt = b.t - a.t;
      if (dt > 0) values[order[k]] = (distanceMetres([a.lat, a.lon], [b.lat, b.lon]) / dt) * unit.perMs;
    }
    if (order.length > 1) values[order[0]] = values[order[1]];
    title = `Speed (${unit.label})`;
    format = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ${unit.label}`;
  } else if (by === 'time') {
    for (let i = 0; i < n; i++) if (pts[i].t != null) values[i] = pts[i].t;
    title = 'Time';
    format = null; // chosen below, once the range is known
  } else if (by.startsWith('col:')) {
    const key = by.slice(4);
    for (let i = 0; i < n; i++) {
      const x = toNumber(pts[i].props?.[key] ?? '');
      if (x !== null) values[i] = x;
    }
    title = key;
    format = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v).toLocaleString() : v.toFixed(2));
  } else {
    return null;
  }

  // Scale from the 2nd to the 98th percentile so one bad reading can't flatten the colours
  const sorted = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length && !format) format = (v) => String(v);
  if (!sorted.length) return { bins: new Uint8Array(n).fill(NO_VALUE), values, min: NaN, max: NaN, title, format, clipped: false };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const clip = sorted.length > 50;
  const min = clip ? pick(0.02) : sorted[0];
  const max = clip ? pick(0.98) : sorted[sorted.length - 1];
  if (!format) {
    // Times: just the time of day if everything is within a day, otherwise date and time
    const withDate = sorted[sorted.length - 1] - sorted[0] >= 86400000;
    format = (v) => formatShort(v, withDate);
  }
  const span = max - min || 1;
  const bins = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    bins[i] = Number.isFinite(v) ? Math.min(BINS - 1, Math.max(0, Math.floor(((v - min) / span) * BINS))) : NO_VALUE;
  }
  return { bins, values, min, max, title, format, clipped: clip && (sorted[0] < min || sorted[sorted.length - 1] > max) };
}

export function binColour(bin, fallback = NO_VALUE_COLOUR) {
  return bin === NO_VALUE ? fallback : BIN_COLOURS[bin];
}

// Scales are kept beside each dataset (not saved with it) so the legends can find them
const scales = new WeakMap();
export function setScale(ds, scale) { if (scale) scales.set(ds, scale); else scales.delete(ds); }
export function getScale(ds) { return scales.get(ds) || null; }

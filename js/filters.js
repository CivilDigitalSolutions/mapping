// Filters: which points are shown. One filter applies to every dataset.
//
//  - Date and time range ("from" / "to"), read in the zone chosen under "Show times in"
//  - Time of day, every day (e.g. 08:00–12:00; 22:00–06:00 runs overnight)
//  - A rule on one column, the point's name, or its calculated speed:
//    is / is not / contains / at least / at most
//
// A rule on a column only applies to datasets that have that column, so
// filtering on "Vehicle" doesn't hide datasets that have no Vehicle column.

import { wallClock, wallToUtc } from './dates.js';
import { distanceMetres } from './coords.js';
import { SPEED_UNITS } from './analysis.js';

export const EMPTY_FILTER = { from: '', to: '', todFrom: '', todTo: '', field: '', op: 'is', value: '' };

export const OPS = {
  is: 'is',
  not: 'is not',
  contains: 'contains',
  gte: 'is at least',
  lte: 'is at most',
};

export function isActive(f) {
  return !!f && !!(f.from || f.to || f.todFrom || f.todTo || (f.field && String(f.value).trim() !== ''));
}

/** "2024-03-14T08:30" (from a datetime-local box) read as wall-clock time in `zone`. */
export function localToMs(s, zone) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? wallToUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0, zone) : null;
}

function minutesOfDay(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
}

function toNumber(v) {
  const s = String(v ?? '').trim().replace(/,(?=\d{3}\b)/g, '');
  return /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : null;
}

/** Speed arriving at each point, in `unit`, using all of the dataset's timed points. */
export function pointSpeeds(points, unit = 'mph') {
  const per = (SPEED_UNITS[unit] || SPEED_UNITS.mph).perMs;
  const out = new Float64Array(points.length).fill(NaN);
  const order = points.map((_, i) => i).filter((i) => points[i].t != null).sort((a, b) => points[a].t - points[b].t || a - b);
  for (let k = 1; k < order.length; k++) {
    const a = points[order[k - 1]], b = points[order[k]];
    const dt = b.t - a.t;
    if (dt > 0) out[order[k]] = (distanceMetres([a.lat, a.lon], [b.lat, b.lon]) / dt) * per;
  }
  if (order.length > 1) out[order[0]] = out[order[1]];
  return out;
}

/** The value a rule looks at for point i, or undefined if the dataset doesn't have it. */
function valueGetter(ds, field, speedUnit) {
  if (field === '@label') {
    return ds.points.some((p) => p.label) ? (i) => ds.points[i].label : null;
  }
  if (field === '@speed') {
    if (ds.points.filter((p) => p.t != null).length < 2) return null;
    const speeds = pointSpeeds(ds.points, speedUnit);
    return (i) => (Number.isFinite(speeds[i]) ? speeds[i] : '');
  }
  return ds.points.some((p) => p.props?.[field] !== undefined && p.props[field] !== '') ? (i) => ds.points[i].props?.[field] ?? '' : null;
}

function ruleTest(op, wanted) {
  const w = String(wanted).trim();
  const wl = w.toLowerCase();
  const wn = toNumber(w);
  switch (op) {
    case 'not': return (v) => String(v).trim().toLowerCase() !== wl;
    case 'contains': return (v) => String(v).toLowerCase().includes(wl);
    case 'gte': return (v) => { const n = toNumber(v); return wn !== null && n !== null && n >= wn; };
    case 'lte': return (v) => { const n = toNumber(v); return wn !== null && n !== null && n <= wn; };
    default: return (v) => (typeof v === 'number' && wn !== null ? Math.abs(v - wn) < 1e-9 : String(v).trim().toLowerCase() === wl);
  }
}

/**
 * Which of a dataset's points pass the filter.
 * Returns a Uint8Array (1 = shown) or null when nothing is filtered out.
 */
export function filterMask(ds, f, { zone, speedUnit = 'mph' } = {}) {
  if (!isActive(f)) return null;
  const pts = ds.points;
  const from = f.from ? localToMs(f.from, zone) : null;
  const to = f.to ? localToMs(f.to, zone) : null;
  const todFrom = minutesOfDay(f.todFrom), todTo = minutesOfDay(f.todTo);
  const timeRule = from !== null || to !== null || todFrom !== null || todTo !== null;
  const ruleOn = f.field && String(f.value).trim() !== '';
  const get = ruleOn ? valueGetter(ds, f.field, speedUnit) : null;
  const test = get ? ruleTest(f.op, f.value) : null;
  if (!timeRule && !get) return null; // the rule is about a column this dataset doesn't have

  const mask = new Uint8Array(pts.length);
  let all = true;
  for (let i = 0; i < pts.length; i++) {
    const t = pts[i].t;
    let ok = true;
    if (timeRule) {
      if (t === null || t === undefined) ok = false;
      else {
        if (from !== null && t < from) ok = false;
        // "To" includes the whole minute shown in the box
        if (to !== null && t >= to + 60000) ok = false;
        if (ok && (todFrom !== null || todTo !== null)) {
          const w = wallClock(t, zone);
          const m = w.h * 60 + w.mi;
          const a = todFrom ?? 0, b = todTo ?? 24 * 60;
          ok = a <= b ? m >= a && m < b : m >= a || m < b; // b < a runs overnight
        }
      }
    }
    if (ok && test) ok = test(get(i));
    mask[i] = ok ? 1 : 0;
    if (!ok) all = false;
  }
  return all ? null : mask;
}

/** Words describing a filter, for the panel and reports. */
export function describeFilter(f, fieldLabel = (k) => k, formatShortTime = (ms) => new Date(ms).toISOString(), zone) {
  if (!isActive(f)) return '';
  const parts = [];
  const show = (s) => formatShortTime(localToMs(s, zone));
  if (f.from && f.to) parts.push(`${show(f.from)} to ${show(f.to)}`);
  else if (f.from) parts.push(`from ${show(f.from)}`);
  else if (f.to) parts.push(`until ${show(f.to)}`);
  if (f.todFrom || f.todTo) parts.push(`${f.todFrom || '00:00'}–${f.todTo || '24:00'} each day`);
  if (f.field && String(f.value).trim() !== '') parts.push(`${fieldLabel(f.field)} ${OPS[f.op] || 'is'} ${String(f.value).trim()}`);
  return parts.join(' · ');
}

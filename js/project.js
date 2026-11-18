// Project files: everything in the app (datasets, styles and time zones) in one
// JSON file that people can keep as a backup or open on another computer.

import { isValidTimeZone } from './dates.js';
import { SHAPE_KEYS } from './icons.js';

const HEX = /^#[0-9a-f]{6}$/i;
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/**
 * A style made safe to use: every value is one the app understands, whatever a
 * project file (or an old save) says. Anything else falls back to `base`.
 * This matters because styles end up inside the page's HTML (marker pictures).
 */
export function cleanStyle(style, base) {
  const st = style && typeof style === 'object' ? style : {};
  const size = Number(st.size);
  return {
    shape: oneOf(st.shape, SHAPE_KEYS, base.shape),
    color: typeof st.color === 'string' && HEX.test(st.color) ? st.color : base.color,
    size: Number.isFinite(size) ? Math.min(48, Math.max(16, Math.round(size))) : base.size,
    showLine: typeof st.showLine === 'boolean' ? st.showLine : base.showLine,
    lineOrder: oneOf(st.lineOrder, ['time', 'file'], base.lineOrder),
    lineStyle: oneOf(st.lineStyle, ['solid', 'dashed', 'dotted'], base.lineStyle),
    showArrows: typeof st.showArrows === 'boolean' ? st.showArrows : base.showArrows,
    numbered: typeof st.numbered === 'boolean' ? st.numbered : base.numbered,
    // Checked against the dataset's own columns when the style controls open
    colourBy: typeof st.colourBy === 'string' && /^(none|speed|time|col:.{1,200})$/s.test(st.colourBy) ? st.colourBy : 'none',
    speedUnit: oneOf(st.speedUnit, ['mph', 'kmh', 'ms'], base.speedUnit),
  };
}

/** Text from a value of unknown type: strings, numbers and booleans as text, anything else empty. */
const text = (v) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

export const PROJECT_FORMAT = 'data-mapper-project';
export const PROJECT_VERSION = 1;

/** True if parsed JSON looks like one of our project files. */
export function isProject(json) {
  return !!json && typeof json === 'object' && json.format === PROJECT_FORMAT && Array.isArray(json.datasets);
}

/** Quick check on raw text, without parsing the whole file twice. */
export function looksLikeProjectText(text) {
  return text.trimStart().startsWith('{') && text.slice(0, 400).includes(`"${PROJECT_FORMAT}"`);
}

export function buildProject(datasets, prefs) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    app: 'Data Mapper',
    displayTimeZone: prefs.displayTz || '',
    datasets,
  };
}

/**
 * Validate and clean the datasets in a project file.
 * Returns { datasets, dropped } where dropped counts unusable points.
 * Throws with a readable message if the file can't be used at all.
 */
export function readProject(json, defaultStyle) {
  if (!isProject(json)) throw new Error("this isn't a Data Mapper project file");
  if (json.version > PROJECT_VERSION) throw new Error('this project was saved by a newer version of Data Mapper. Reload the app to update it, then try again');
  let dropped = 0;
  const datasets = json.datasets.map((d, n) => {
    if (!d || !Array.isArray(d.points)) throw new Error(`dataset ${n + 1} is damaged`);
    const points = [];
    for (const p of d.points) {
      const lat = Number(p?.lat), lon = Number(p?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { dropped++; continue; }
      // Times outside years 1900–2200 can't be real readings (and break date formatting)
      const tn = Number(p.t);
      const t = p.t === null || p.t === undefined || !Number.isFinite(tn) || tn < -2208988800000 || tn > 7258118400000 ? null : tn;
      points.push({
        lat, lon, t,
        ...(p.tzx && t !== null ? { tzx: true } : {}),
        label: text(p.label),
        props: p.props && typeof p.props === 'object' && !Array.isArray(p.props)
          ? Object.fromEntries(Object.entries(p.props).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, text(v)]))
          : {},
        src: Number.isFinite(Number(p.src)) ? Number(p.src) : undefined,
      });
    }
    const base = defaultStyle(n, points.some((p) => p.t !== null));
    return {
      id: '', // a fresh id is given when the dataset is added
      name: typeof d.name === 'string' && d.name.trim() ? d.name : `Dataset ${n + 1}`,
      visible: d.visible !== false,
      style: cleanStyle(d.style, base),
      points,
      skipped: Array.isArray(d.skipped) ? d.skipped.slice(0, 10000).map((x) => ({ row: Number(x?.row) || 0, reason: text(x?.reason) })) : [],
      source: typeof d.source === 'string' ? d.source : 'Project file',
      createdAt: Number(d.createdAt) || Date.now(),
      ...(typeof d.timeZone === 'string' && isValidTimeZone(d.timeZone) ? { timeZone: d.timeZone } : {}),
    };
  });
  return { datasets, dropped, displayTimeZone: typeof json.displayTimeZone === 'string' ? json.displayTimeZone : null };
}

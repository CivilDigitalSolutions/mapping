// Coordinate parsing: decimal degrees, hemisphere letters, DMS / DDM,
// combined "lat, lon" strings and WKT POINT(lon lat).

const HEMI_RE = /[NSEW]/i;

/**
 * Parse a single coordinate component (latitude OR longitude).
 * Accepts: "51.5", "-0.12", "51.5N", "N 51.5", "51°30'26\"N",
 * "51 30 26 N", "51°30.43'N", "51d30m26s", "51:30:26".
 * Returns { value, hemi } or null. hemi is 'N','S','E','W' or ''.
 */
export function parseComponent(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? { value: input, hemi: '' } : null;
  let s = String(input).trim();
  if (!s) return null;

  // Normalise unicode primes / quotes and decimal commas like "51,5" (only when no other separators)
  s = s
    .replace(/[′’´`]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/''/g, '"')
    .replace(/º/g, '°');
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');

  let hemi = '';
  // "51d30m26s" — a lowercase trailing s after minutes is "seconds", not "South"
  const secondsSuffix = /\d\s*m\s*\d+(\.\d+)?\s*s$/.test(s);
  const hm = secondsSuffix ? s.match(/^([NSEW])\s*/i) : s.match(/^([NSEW])\s*|\s*([NSEW])$/i);
  if (hm) {
    hemi = (hm[1] || hm[2]).toUpperCase();
    s = (hm.index === 0 ? s.slice(hm[0].length) : s.slice(0, hm.index)).trim();
  }
  if (HEMI_RE.test(s.replace(/[\d\s.°'"dms:+-]/gi, ''))) return null;

  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) { s = s.slice(1).trim(); }

  // Plain decimal
  if (/^\d+(\.\d+)?$|^\.\d+$/.test(s)) {
    return finish(sign * parseFloat(s), hemi);
  }

  // DMS / DDM with separators
  const parts = s
    .replace(/[°dD:]/g, ' ')
    .replace(/[′'mM]/g, ' ')
    .replace(/[″"sS]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const [d, m = 0, sec = 0] = parts.map(Number);
  if (m >= 60 || sec >= 60) return null;
  return finish(sign * (d + m / 60 + sec / 3600), hemi);
}

function finish(value, hemi) {
  if (!Number.isFinite(value)) return null;
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
  return { value, hemi };
}

/** Parse a value expected to be latitude. */
export function parseLat(v) {
  const r = parseComponent(v);
  if (!r) return null;
  if (r.hemi === 'E' || r.hemi === 'W') return null;
  return Math.abs(r.value) <= 90 ? r.value : null;
}

/** Parse a value expected to be longitude. */
export function parseLon(v) {
  const r = parseComponent(v);
  if (!r) return null;
  if (r.hemi === 'N' || r.hemi === 'S') return null;
  return Math.abs(r.value) <= 180 ? r.value : null;
}

/**
 * Split a combined coordinate string into two raw parts.
 * Returns { a, b, wkt } where wkt=true means order is lon/lat.
 */
function splitCombined(input) {
  let s = String(input).trim();
  if (!s) return null;

  // WKT: POINT(lon lat) / POINT Z (lon lat alt)
  const wkt = s.match(/^POINT\s*Z?\s*\(\s*([-+\d.eE]+)[\s,]+([-+\d.eE]+)/i);
  if (wkt) return { a: wkt[1], b: wkt[2], wkt: true };

  // Strip wrapping brackets: (51.5, -0.1) or [51.5, -0.1]
  s = s.replace(/^[([{]\s*|\s*[)\]}]$/g, '');

  // Explicit separators
  for (const sep of [';', '|', '\t', '/']) {
    if (s.includes(sep)) {
      const p = s.split(sep).map((x) => x.trim()).filter(Boolean);
      if (p.length >= 2) return { a: p[0], b: p[1] };
    }
  }
  // A comma between two numbers ("51.5, -0.12"), but not a decimal comma
  const commaParts = s.split(/\s*,\s*/);
  if (commaParts.length === 2 || commaParts.length === 3) {
    return { a: commaParts[0], b: commaParts[1] };
  }
  // Hemisphere letter marks the boundary: 51°30'N 0°07'W  /  N51.5 W0.12
  const trailing = s.match(/^(.+?[NS])\s*(.+?[EW])$/i);
  if (trailing) return { a: trailing[1], b: trailing[2] };
  const leading = s.match(/^([NS].+?)\s+([EW].+)$/i);
  if (leading) return { a: leading[1], b: leading[2] };
  const trailingLonFirst = s.match(/^(.+?[EW])\s*(.+?[NS])$/i);
  if (trailingLonFirst) return { a: trailingLonFirst[2], b: trailingLonFirst[1] };

  // Two whitespace separated tokens
  const ws = s.split(/\s+/);
  if (ws.length === 2) return { a: ws[0], b: ws[1] };
  return null;
}

/**
 * Parse a combined coordinate string.
 * order: 'latlon' | 'lonlat' | 'auto'
 * Returns [lat, lon] or null.
 */
export function parseCombined(input, order = 'auto') {
  const parts = splitCombined(input);
  if (!parts) return null;
  let { a, b } = parts;
  if (parts.wkt) order = 'lonlat';

  const ca = parseComponent(a);
  const cb = parseComponent(b);
  if (!ca || !cb) return null;

  // Hemisphere letters settle the order regardless of the setting
  if ((ca.hemi === 'E' || ca.hemi === 'W') && (cb.hemi === 'N' || cb.hemi === 'S')) order = 'lonlat';
  if ((ca.hemi === 'N' || ca.hemi === 'S') && (cb.hemi === 'E' || cb.hemi === 'W')) order = 'latlon';

  let lat, lon;
  if (order === 'lonlat') { lon = ca.value; lat = cb.value; }
  else if (order === 'latlon') { lat = ca.value; lon = cb.value; }
  else {
    // auto: if the first value cannot be a latitude, assume lon/lat
    if (Math.abs(ca.value) > 90 && Math.abs(cb.value) <= 90) { lon = ca.value; lat = cb.value; }
    else { lat = ca.value; lon = cb.value; }
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

/** Guess combined-column order across a sample of values. */
export function guessCombinedOrder(values) {
  let latFirst = 0, lonFirst = 0;
  for (const v of values) {
    const p = splitCombined(v ?? '');
    if (!p) continue;
    if (p.wkt) { lonFirst++; continue; }
    const a = parseComponent(p.a), b = parseComponent(p.b);
    if (!a || !b) continue;
    if (Math.abs(a.value) > 90 && Math.abs(b.value) <= 90) lonFirst++;
    else if (Math.abs(b.value) > 90 && Math.abs(a.value) <= 90) latFirst++;
  }
  return lonFirst > latFirst ? 'lonlat' : 'latlon';
}

export function looksLikeCombined(v) {
  return parseCombined(v, 'auto') !== null;
}

export function formatCoord(lat, lon, digits = 6) {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}

/** Great-circle distance in metres. */
export function distanceMetres(a, b) {
  const R = 6371008.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing in degrees from a to b (0 = north). */
export function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

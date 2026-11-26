// Cell site (mobile mast) data: finding the azimuth / beamwidth / radius
// columns, reading them, and working out the outline of each sector.
// Nothing here touches the page or the map, so it can be tested on its own.
//
// An azimuth is the compass direction an antenna faces, in degrees clockwise
// from true north. The beamwidth is how wide its signal spreads (a typical
// sector is 60–70°; 360° means an all-round antenna). The radius is how far
// the signal is meant to reach.

export const UNIT_METRES = { m: 1, km: 1000, mi: 1609.344 };

export const UNIT_LABELS = { m: 'metres', km: 'kilometres', mi: 'miles' };

/** Sectors longer than this can't be real, and would swamp the map. */
export const MAX_RADIUS_METRES = 200000;

/** Drawing thousands of sectors makes the map slow, so a dataset shows at most this many. */
export const MAX_SECTORS = 3000;

export const CELL_DEFAULTS = {
  on: false,
  az: '',            // name of the azimuth column
  beam: '',          // name of the beamwidth column ('' = use defaultBeam for every sector)
  radius: '',        // name of the radius column ('' = use defaultRadius for every sector)
  defaultBeam: 65,   // degrees, used when a row has no beamwidth
  defaultRadius: 1000, // in `unit`, used when a row has no radius
  unit: 'm',
};

const EARTH_RADIUS = 6371008.8;

// ---------------------------------------------------------------- reading values

/** A number from a cell such as "120", "120°", "65 deg" or "1,5". Null if there isn't one. */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[°º]|degrees?|deg\b/gi, '').trim();
  if (!s) return null;
  const lead = s.match(/^[-+]?(\d+([.,]\d+)?|[.,]\d+)/);
  if (!lead) return null;
  const n = Number(lead[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Any angle as a compass bearing from 0 up to (not including) 360. */
export function normaliseAzimuth(deg) {
  return ((deg % 360) + 360) % 360;
}

// ---------------------------------------------------------------- guessing columns

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

const GUESS = {
  az: /^(antenna|sector|cell)?(az|azi|azim|azimuth|bearing|heading|direction|orientation)(deg|degrees|d)?$/,
  beam: /^(h|horiz|horizontal|antenna|sector|cell)?(beam|beamwidth|bw|beamangle|width|angle)(deg|degrees|d)?$/,
  radius: /^(cell|coverage|sector|site)?(radius|range|reach|distance)(m|km|mi|metres|meters|miles|kilometres|kilometers)?$/,
};

/**
 * Guess which columns hold the azimuth, beamwidth and radius.
 * `columns` are the column names; `valuesOf(name)` returns a sample of that
 * column's values (a column that isn't mostly numbers is never suggested).
 * Returns { az, beam, radius, unit } with '' for any column not found.
 */
export function guessCellColumns(columns, valuesOf) {
  const numeric = (name) => {
    const vals = valuesOf(name).filter((v) => String(v ?? '').trim() !== '');
    return vals.length > 0 && vals.filter((v) => parseNumber(v) !== null).length / vals.length >= 0.6;
  };
  const used = new Set();
  const find = (re) => {
    const hit = columns.find((c) => !used.has(c) && re.test(norm(c)) && numeric(c));
    if (hit) used.add(hit);
    return hit || '';
  };
  const az = find(GUESS.az);
  const beam = find(GUESS.beam);
  const radius = find(GUESS.radius);
  let unit = 'm';
  if (radius) {
    const n = norm(radius);
    if (/(km|kilometres|kilometers)$/.test(n)) unit = 'km';
    else if (/(mi|miles)$/.test(n)) unit = 'mi';
  }
  return { az, beam, radius, unit };
}

// ---------------------------------------------------------------- sectors

/**
 * The sectors to draw for a dataset: [{ i, lat, lon, az, beam, radius }] where
 * `i` is the point's index, `beam` is in degrees and `radius` in metres.
 * Rows with no readable azimuth are counted in `missing` rather than drawn.
 * `mask` (optional) marks which points are showing, e.g. after filtering.
 */
export function cellSectors(ds, mask = null) {
  const cell = ds.cell;
  const out = [];
  let missing = 0;
  if (!cell || !cell.on || !cell.az) return { sectors: out, missing };
  const unit = UNIT_METRES[cell.unit] || 1;
  const defaultBeam = clampBeam(cell.defaultBeam) ?? CELL_DEFAULTS.defaultBeam;
  const defaultRadius = clampRadius(cell.defaultRadius * unit) ?? CELL_DEFAULTS.defaultRadius;
  ds.points.forEach((p, i) => {
    if (mask && !mask[i]) return;
    const az = parseNumber(p.props?.[cell.az]);
    if (az === null) { missing++; return; }
    const beam = (cell.beam && clampBeam(parseNumber(p.props?.[cell.beam]))) || defaultBeam;
    const r = cell.radius ? parseNumber(p.props?.[cell.radius]) : null;
    const radius = (r !== null && clampRadius(r * unit)) || defaultRadius;
    out.push({ i, lat: p.lat, lon: p.lon, az: normaliseAzimuth(az), beam, radius });
  });
  return { sectors: out, missing };
}

function clampBeam(b) {
  return Number.isFinite(b) && b > 0 ? Math.min(360, b) : null;
}

function clampRadius(m) {
  return Number.isFinite(m) && m > 0 ? Math.min(MAX_RADIUS_METRES, m) : null;
}

/** The point `metres` away from [lat, lon] in the direction of the compass bearing `deg`. */
export function destination(lat, lon, deg, metres) {
  const rad = Math.PI / 180;
  const d = metres / EARTH_RADIUS;
  const b = deg * rad;
  const p1 = lat * rad, l1 = lon * rad;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / rad, ((l2 / rad + 540) % 360) - 180];
}

/**
 * The outline of one sector as [lat, lon] pairs: a wedge from the mast, centred
 * on the azimuth, `beam` degrees wide and `radius` metres long. A beamwidth of
 * 360° gives a full circle.
 */
export function sectorOutline(lat, lon, az, beam, radius, stepDeg = 4) {
  if (beam >= 359.5) {
    const ring = [];
    for (let k = 0; k < 72; k++) ring.push(destination(lat, lon, k * 5, radius));
    return ring;
  }
  const steps = Math.max(2, Math.ceil(beam / stepDeg));
  const start = az - beam / 2;
  const pts = [[lat, lon]];
  for (let k = 0; k <= steps; k++) pts.push(destination(lat, lon, start + (beam * k) / steps, radius));
  return pts;
}

// ---------------------------------------------------------------- saved settings

/** Cell site settings made safe to use, whatever a project file or an old save says. Null if there are none. */
export function cleanCell(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  const col = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
  const beam = Number(c.defaultBeam), radius = Number(c.defaultRadius);
  return {
    on: c.on === true,
    az: col(c.az),
    beam: col(c.beam),
    radius: col(c.radius),
    defaultBeam: Number.isFinite(beam) && beam > 0 ? Math.min(360, beam) : CELL_DEFAULTS.defaultBeam,
    defaultRadius: Number.isFinite(radius) && radius > 0 ? Math.min(MAX_RADIUS_METRES, radius) : CELL_DEFAULTS.defaultRadius,
    unit: Object.hasOwn(UNIT_METRES, c.unit) ? c.unit : 'm',
  };
}

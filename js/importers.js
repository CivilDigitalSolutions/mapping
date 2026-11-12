// Turning raw text (CSV, TSV, pasted spreadsheet cells, GeoJSON, GPX, KML)
// into a table and then into map points.
/* global Papa */
import { parseLat, parseLon, parseCombined, guessCombinedOrder, parseComponent } from './coords.js';
import { parseDateTime, parseDateAndTime, guessDateOrder } from './dates.js';

// ---------------------------------------------------------------- detection

export function detectFormat(text, filename = '') {
  const ext = filename.toLowerCase().split('.').pop();
  const head = text.trimStart().slice(0, 400).toLowerCase();
  if (ext === 'geojson' || ext === 'json' || head.startsWith('{') || head.startsWith('[')) {
    try { JSON.parse(text); return 'geojson'; } catch { /* not JSON */ }
  }
  if (ext === 'gpx' || head.includes('<gpx')) return 'gpx';
  if (ext === 'kml' || head.includes('<kml')) return 'kml';
  return 'table';
}

// ---------------------------------------------------------------- tables

/**
 * Parse delimited text into { headers, rows } where rows are arrays of strings.
 * Detects whether the first row is a header.
 */
export function parseTable(text) {
  const res = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy', delimitersToGuess: [',', '\t', ';', '|'] });
  let data = res.data.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!data.length) return { headers: [], rows: [] };

  // A single column of "lat lon" pairs separated by spaces is common when pasting
  const width = Math.max(...data.map((r) => r.length));
  data = data.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r));

  const first = data[0];
  const looksLikeData = (cell) => {
    const s = String(cell).trim();
    if (!s) return false;
    return parseComponent(s) !== null || parseCombined(s) !== null || parseDateTime(s) !== null;
  };
  const dataCells = first.filter(looksLikeData).length;
  const hasHeader = dataCells === 0 || (dataCells < first.length / 2 && data.length > 1);

  let headers;
  if (hasHeader) {
    headers = first.map((h, i) => String(h).trim() || `Column ${i + 1}`);
    data = data.slice(1);
  } else {
    headers = first.map((_, i) => `Column ${i + 1}`);
  }
  // De-duplicate header names
  const seen = {};
  headers = headers.map((h) => {
    seen[h] = (seen[h] || 0) + 1;
    return seen[h] > 1 ? `${h} (${seen[h]})` : h;
  });
  return { headers, rows: data.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim()))) };
}

const NAME_PATTERNS = {
  lat: /^(lat|latitude|lat_?dd|lat_?deg|gps_?lat(itude)?|y_?coord|y|northing_?deg|decimallatitude)$/i,
  lon: /^(lon|lng|long|longitude|lon_?dd|lng_?dd|long_?deg|gps_?lon(g|gitude)?|x_?coord|x|decimallongitude)$/i,
  coords: /(coord|coordinates|location|position|lat_?lo?ng?|lat\/lo?ng?|latlon|point|geom|wkt|gps|lat\s*,\s*lo?ng?)/i,
  datetime: /^(date_?time|datetime|timestamp|time_?stamp|date ?& ?time|recorded(_?at)?|created(_?at)?|utc|time_?utc|date_?utc|fix_?time|event_?time|observed(_?at)?|when)$/i,
  date: /(^|_|\s)(date|day)($|_|\s)|^date/i,
  time: /(^|_|\s)(time|hour)($|_|\s)|^time/i,
  label: /^(name|label|title|id|waypoint|site|description|desc|point_?name|ref|reference|callsign|vehicle|device)$/i,
};

/**
 * Guess which columns hold what. Returns a mapping object:
 * { mode: 'separate'|'combined', lat, lon, coords, order, datetime, date, time, dateOrder, label }
 * Column values are indexes (or -1 for none).
 */
export function guessMapping(table) {
  const { headers, rows } = table;
  const sample = rows.slice(0, 200);
  const col = (i) => sample.map((r) => r[i]);
  const ratio = (i, fn) => {
    const vals = col(i).filter((v) => v !== '');
    if (!vals.length) return 0;
    return vals.filter((v) => fn(v) !== null).length / vals.length;
  };
  const find = (re, exclude = []) => headers.findIndex((h, i) => !exclude.includes(i) && re.test(h.trim()));

  const map = { mode: 'separate', lat: -1, lon: -1, coords: -1, order: 'latlon', datetime: -1, date: -1, time: -1, dateOrder: 'dmy', label: -1 };

  map.lat = find(NAME_PATTERNS.lat);
  map.lon = find(NAME_PATTERNS.lon, [map.lat]);

  if (map.lat === -1 || map.lon === -1) {
    // Combined coordinate column?
    let ci = find(NAME_PATTERNS.coords, [map.lat, map.lon]);
    if (ci !== -1 && ratio(ci, (v) => parseCombined(v)) < 0.6) ci = -1;
    if (ci === -1) ci = headers.findIndex((_, i) => ratio(i, (v) => parseCombined(v)) >= 0.8 && ratio(i, parseComponent) < 0.5);
    if (ci !== -1) {
      map.mode = 'combined';
      map.coords = ci;
      map.order = guessCombinedOrder(col(ci));
    } else {
      // Fall back to content: first two adjacent numeric columns that fit lat/lon ranges
      for (let i = 0; i < headers.length - 1 && (map.lat === -1 || map.lon === -1); i++) {
        if (ratio(i, parseLat) > 0.9 && ratio(i + 1, parseLon) > 0.9 && ratio(i, (v) => parseDateTime(v)) < 0.5) {
          // Values in the first column > 90 would fail parseLat, so lat/lon order is preferred.
          map.lat = i; map.lon = i + 1;
        }
      }
    }
  }

  const used = () => [map.lat, map.lon, map.coords];
  map.datetime = find(NAME_PATTERNS.datetime, used());
  if (map.datetime !== -1 && ratio(map.datetime, (v) => parseDateTime(v)) < 0.5) map.datetime = -1;
  if (map.datetime === -1) {
    const d = find(NAME_PATTERNS.date, used());
    const t = find(NAME_PATTERNS.time, [...used(), d]);
    if (d !== -1) {
      // A "date" column that already includes the time works as datetime alone
      map.date = d;
      if (t !== -1) map.time = t;
    } else if (t !== -1 && ratio(t, (v) => parseDateTime(v)) > 0.5) {
      map.datetime = t;
    }
  }
  if (map.datetime === -1 && map.date === -1) {
    const i = headers.findIndex((_, i) => !used().includes(i) && ratio(i, (v) => (/[-/:T ]/.test(v) ? parseDateTime(v) : null)) > 0.8);
    if (i !== -1) map.datetime = i;
  }
  const dateCol = map.datetime !== -1 ? map.datetime : map.date;
  if (dateCol !== -1) map.dateOrder = guessDateOrder(col(dateCol));

  map.label = find(NAME_PATTERNS.label, [...used(), map.datetime, map.date, map.time]);
  return map;
}

/**
 * Convert table rows to points using a mapping.
 * Returns { points, skipped: [{ row, reason }], fields }
 */
export function tableToPoints(table, map) {
  const { headers, rows } = table;
  const points = [];
  const skipped = [];
  const usedCols = new Set([map.lat, map.lon, map.coords].filter((i) => i >= 0));

  rows.forEach((r, ri) => {
    let lat = null, lon = null;
    if (map.mode === 'combined') {
      const c = parseCombined(r[map.coords], map.order);
      if (c) [lat, lon] = c;
    } else {
      lat = parseLat(r[map.lat]);
      lon = parseLon(r[map.lon]);
    }
    if (lat === null || lon === null) {
      const raw = map.mode === 'combined' ? r[map.coords] : `${r[map.lat] ?? ''}, ${r[map.lon] ?? ''}`;
      skipped.push({ row: ri + 1, reason: raw && raw.replace(/[,\s]/g, '') ? `Couldn't read coordinates "${raw}"` : 'No coordinates' });
      return;
    }

    let t = null;
    if (map.datetime >= 0) t = parseDateTime(r[map.datetime], map.dateOrder);
    else if (map.date >= 0) t = map.time >= 0 ? parseDateAndTime(r[map.date], r[map.time], map.dateOrder) : parseDateTime(r[map.date], map.dateOrder);

    const props = {};
    headers.forEach((h, i) => { if (!usedCols.has(i) && r[i] !== '') props[h] = r[i]; });
    points.push({
      lat, lon, t,
      label: map.label >= 0 ? r[map.label] : '',
      props,
      src: ri + 1,
    });
  });
  return { points, skipped, fields: headers };
}

// ---------------------------------------------------------------- GeoJSON

export function geojsonToPoints(text) {
  const json = JSON.parse(text);
  const features = [];
  const walk = (obj) => {
    if (!obj) return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    if (obj.type === 'FeatureCollection') obj.features.forEach(walk);
    else if (obj.type === 'Feature') features.push(obj);
    else if (obj.type) features.push({ type: 'Feature', properties: {}, geometry: obj });
  };
  walk(json);

  const points = [];
  const skipped = [];
  const timeKeys = ['time', 'timestamp', 'datetime', 'date_time', 'date', 'when', 'recorded_at', 'created_at'];
  const nameKeys = ['name', 'title', 'label', 'id'];
  features.forEach((f, fi) => {
    const props = { ...(f.properties || {}) };
    const g = f.geometry;
    if (!g) { skipped.push({ row: fi + 1, reason: 'Feature has no geometry' }); return; }
    const tKey = Object.keys(props).find((k) => timeKeys.includes(k.toLowerCase()));
    const nKey = Object.keys(props).find((k) => nameKeys.includes(k.toLowerCase()));
    const baseT = tKey ? parseDateTime(props[tKey]) : null;
    const coordTimes = props.coordTimes || props.times || null; // common in GPX→GeoJSON conversions

    const pushCoord = (c, i) => {
      if (!Array.isArray(c) || c.length < 2) return;
      const [lon, lat] = c;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) { skipped.push({ row: fi + 1, reason: `Coordinates out of range ${c}` }); return; }
      const t = coordTimes && coordTimes[i] ? parseDateTime(coordTimes[i]) : baseT;
      const p = { ...props }; delete p.coordTimes; delete p.times;
      if (c.length > 2) p.elevation = c[2];
      points.push({ lat, lon, t, label: nKey ? String(props[nKey]) : '', props: stringifyProps(p), src: fi + 1 });
    };
    switch (g.type) {
      case 'Point': pushCoord(g.coordinates, 0); break;
      case 'MultiPoint':
      case 'LineString': g.coordinates.forEach(pushCoord); break;
      case 'MultiLineString':
      case 'Polygon': g.coordinates.flat().forEach(pushCoord); break;
      case 'MultiPolygon': g.coordinates.flat(2).forEach(pushCoord); break;
      default: skipped.push({ row: fi + 1, reason: `Unsupported geometry ${g.type}` });
    }
  });
  return { points, skipped };
}

function stringifyProps(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

// ---------------------------------------------------------------- GPX / KML

export function gpxToPoints(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This GPX file could not be read (invalid XML).');
  const points = [];
  const nodes = doc.querySelectorAll('wpt, trkpt, rtept');
  nodes.forEach((n, i) => {
    const lat = parseFloat(n.getAttribute('lat'));
    const lon = parseFloat(n.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const get = (tag) => n.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
    const props = {};
    const ele = get('ele'); if (ele) props.elevation = ele;
    const desc = get('desc'); if (desc) props.description = desc;
    const sym = get('sym'); if (sym) props.symbol = sym;
    props.type = n.tagName === 'wpt' ? 'Waypoint' : n.tagName === 'trkpt' ? 'Track point' : 'Route point';
    const time = get('time');
    points.push({ lat, lon, t: time ? parseDateTime(time) : null, label: get('name'), props, src: i + 1 });
  });
  return { points, skipped: [] };
}

export function kmlToPoints(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This KML file could not be read (invalid XML).');
  const points = [];
  const skipped = [];
  const placemarks = doc.getElementsByTagName('Placemark');
  Array.from(placemarks).forEach((pm, pi) => {
    const get = (tag) => pm.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
    const name = get('name');
    const when = get('when') || get('begin');
    const props = {};
    const desc = get('description'); if (desc) props.description = desc.replace(/<[^>]+>/g, ' ').trim();
    Array.from(pm.getElementsByTagName('Data')).forEach((d) => {
      const v = d.getElementsByTagName('value')[0]?.textContent?.trim();
      if (v) props[d.getAttribute('name')] = v;
    });
    Array.from(pm.getElementsByTagName('SimpleData')).forEach((d) => {
      if (d.textContent.trim()) props[d.getAttribute('name')] = d.textContent.trim();
    });

    // gx:Track with <when>/<gx:coord> pairs
    const whens = Array.from(pm.getElementsByTagName('when')).map((w) => w.textContent.trim());
    const gxCoords = Array.from(pm.getElementsByTagNameNS('*', 'coord')).map((c) => c.textContent.trim());
    if (gxCoords.length) {
      gxCoords.forEach((c, i) => {
        const [lon, lat] = c.split(/\s+/).map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat, lon, t: whens[i] ? parseDateTime(whens[i]) : null, label: name, props, src: pi + 1 });
      });
      return;
    }
    const coordEls = pm.getElementsByTagName('coordinates');
    if (!coordEls.length) { skipped.push({ row: pi + 1, reason: 'Placemark has no coordinates' }); return; }
    Array.from(coordEls).forEach((ce) => {
      ce.textContent.trim().split(/\s+/).forEach((tuple) => {
        const [lon, lat] = tuple.split(',').map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat, lon, t: when ? parseDateTime(when) : null, label: name, props, src: pi + 1 });
      });
    });
  });
  return { points, skipped };
}

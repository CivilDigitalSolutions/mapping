/* global Papa */
// A dataset's Table view, its list of stops and problems, and exporting a
// dataset as GeoJSON or CSV. All of these follow the filter: they show and
// export the points that are on the map.

import { formatDateTime, formatDistance, formatDuration } from './dates.js';
import { focusPoint, map } from './mapview.js';
import { SPEED_UNITS } from './analysis.js';
import { formatCoord } from './coords.js';
import { layers, prefs } from './state.js';
import { $, announce, closePanelOnMobile, download, esc, safeFilename, toast } from './util.js';

/** Indexes of the points shown on the map (all of them when no filter is on), in route order. */
function shownIndexes(ds) {
  const l = layers.get(ds.id);
  return [...l.order, ...l.untimed];
}

/** "(120 of 400 points, filtered)" or "" */
function filteredNote(ds) {
  const l = layers.get(ds.id);
  return l.mask ? ` (filtered: ${(l.order.length + l.untimed.length).toLocaleString()} of ${ds.points.length.toLocaleString()} points)` : '';
}

export function openTable(ds) {
  const l = layers.get(ds.id);
  const indexes = shownIndexes(ds);
  const fields = [...new Set(ds.points.flatMap((p) => Object.keys(p.props || {})))].slice(0, 12);
  const LIMIT = 2000;
  $('#table-title').textContent = l.mask
    ? `${ds.name}: ${indexes.length.toLocaleString()} of ${ds.points.length.toLocaleString()} points (filtered)`
    : `${ds.name}: ${ds.points.length.toLocaleString()} points`;
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

/**
 * A dataset's stops, recording gaps and GPS jumps as rows in time order:
 * { kind, from, to, dur, detail, item }. Used by the on-screen list and the PDF.
 */
export function eventRows(ds) {
  const a = layers.get(ds.id)?.analysis || { stops: [], gaps: [], jumps: [] };
  const unit = SPEED_UNITS[prefs.analysis.speedUnit] || SPEED_UNITS.mph;
  return [
    ...a.stops.map((s) => ({ kind: 'Stop', from: s.from, to: s.to, dur: s.minutes * 60000, detail: `${s.count} points recorded, at ${formatCoord(s.lat, s.lon, 5)}`, item: s })),
    ...a.gaps.map((g) => ({ kind: 'Gap in recording', from: g.from, to: g.to, dur: g.minutes * 60000, detail: `Moved ${formatDistance(g.metres)} with nothing recorded`, item: g })),
    ...a.jumps.map((j) => ({ kind: 'Possible GPS jump', from: ds.points[j.i].t, to: null, dur: null, detail: `${formatDistance(j.metres)} in ${formatDuration(j.seconds * 1000)} (${Math.round(j.speed).toLocaleString()} ${unit.label})`, item: j })),
  ].sort((x, y) => x.from - y.from);
}

/** The list of stops, recording gaps and GPS jumps found in a dataset. */
export function openEvents(ds) {
  const l = layers.get(ds.id);
  const rows = eventRows(ds);
  $('#table-title').textContent = `Stops and problems: ${ds.name}`;
  const table = $('#data-table');
  table.innerHTML = `<caption class="sr-only">Stops, gaps in the recording and possible GPS jumps in ${esc(ds.name)}, in time order</caption>
    <thead><tr><th scope="col">What</th><th scope="col">From</th><th scope="col">To</th><th scope="col">How long</th><th scope="col">Details</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${rows.map((r, k) => `<tr><td>${esc(r.kind)}</td><td>${esc(formatDateTime(r.from))}</td><td>${r.to != null ? esc(formatDateTime(r.to)) : ''}</td><td>${r.dur != null ? esc(formatDuration(r.dur)) : ''}</td><td>${esc(r.detail)}</td><td><button type="button" class="btn btn-sm" data-event="${k}">Show on map</button></td></tr>`).join('')}</tbody>
    ${rows.length ? '' : '<tfoot><tr><td colspan="6">No stops, gaps or GPS jumps were found with the current settings.</td></tr></tfoot>'}`;
  table.onclick = (e) => {
    const b = e.target.closest('[data-event]');
    if (!b) return;
    const r = rows[Number(b.dataset.event)];
    const em = l.eventMarkers.find((m) => m.item === r.item);
    $('#dlg-table').close();
    closePanelOnMobile();
    if (!em) { toast('Turn on "Mark them on the map" under Stops and problems to see this on the map.'); return; }
    map.setView(em.marker.getLatLng(), Math.max(map.getZoom(), 16), { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
    em.marker.openPopup();
    setTimeout(() => $('.leaflet-popup .pop-title')?.focus(), 60);
  };
  $('#dlg-table').showModal();
}

export function exportGeoJSON(ds) {
  const l = layers.get(ds.id);
  const features = shownIndexes(ds).map((i) => {
    const p = ds.points[i];
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { name: p.label || undefined, time: p.t != null ? new Date(p.t).toISOString() : undefined, ...p.props },
    };
  });
  if (ds.style.showLine && l.order.length > 1) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: l.order.map((i) => [ds.points[i].lon, ds.points[i].lat]) },
      properties: { name: `${ds.name} track` },
    });
  }
  download(`${safeFilename(ds.name)}.geojson`, JSON.stringify({ type: 'FeatureCollection', name: ds.name, features }, null, 2), 'application/geo+json');
  exported(ds, 'GeoJSON');
}

export function exportCSV(ds) {
  const fields = [...new Set(ds.points.flatMap((p) => Object.keys(p.props || {})))];
  const rows = [['name', 'latitude', 'longitude', 'datetime', ...fields]];
  shownIndexes(ds).forEach((i) => {
    const p = ds.points[i];
    rows.push([p.label, p.lat, p.lon, p.t != null ? new Date(p.t).toISOString() : '', ...fields.map((f) => p.props?.[f] ?? '')]);
  });
  download(`${safeFilename(ds.name)}.csv`, Papa.unparse(rows), 'text/csv');
  exported(ds, 'CSV');
}

function exported(ds, kind) {
  const note = filteredNote(ds);
  announce(`${ds.name} exported as ${kind}${note}`);
  if (note) toast(`Exported as ${kind}${note}. Clear the filter to export every point.`);
}

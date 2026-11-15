/* global Papa */
// A dataset's Table view, and exporting a dataset as GeoJSON or CSV.

import { formatDateTime } from './dates.js';
import { focusPoint } from './mapview.js';
import { layers } from './state.js';
import { $, announce, closePanelOnMobile, download, esc, safeFilename } from './util.js';

export function openTable(ds) {
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

export function exportGeoJSON(ds) {
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

export function exportCSV(ds) {
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

/* global Papa */
// A dataset's Table view (search, sort, select, edit and delete points), its
// list of stops and problems, and exporting a dataset as GeoJSON or CSV. All
// of these follow the filter: they show and export the points on the map.

import { displayTimeZone, formatDateTime, formatDistance, formatDuration, parseDateTime, wallClock } from './dates.js';
import { focusPoint, map, renderDataset, replay } from './mapview.js';
import { SPEED_UNITS } from './analysis.js';
import { formatCoord, parseLat, parseLon } from './coords.js';
import { changed, layers, prefs, save } from './state.js';
import { $, $$, announce, closePanelOnMobile, download, esc, safeFilename, toast } from './util.js';

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

// ===================================================================== the points table

const PAGE = 200;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** State of the open table: which dataset, search, sort, page and selection. */
let tbl = null;

/** The columns a dataset's table shows: built-in ones, then up to 12 of its own. */
function columnsOf(ds) {
  const fields = [...new Set(ds.points.flatMap((p) => Object.keys(p.props || {})))].slice(0, 12);
  return [
    { key: '#', label: '#', value: (p) => tbl.pos.get(p) ?? Infinity },
    { key: 'name', label: 'Name', value: (p) => p.label || '' },
    { key: 'time', label: 'Date & time', value: (p) => (p.t ?? Infinity) },
    { key: 'lat', label: 'Latitude', value: (p) => p.lat },
    { key: 'lon', label: 'Longitude', value: (p) => p.lon },
    ...fields.map((f) => ({ key: `col:${f}`, label: f, field: f, value: (p) => p.props?.[f] ?? '' })),
  ];
}

/** Text that a search matches against, worked out once per point. */
function searchText(p) {
  let s = tbl.text.get(p);
  if (s === undefined) {
    s = [p.label, p.t != null ? formatDateTime(p.t) : '', p.lat.toFixed(6), p.lon.toFixed(6), ...Object.values(p.props || {})].join(' \u0001 ').toLowerCase();
    tbl.text.set(p, s);
  }
  return s;
}

/** The points shown (passing the map filter), matching the search, in the chosen order. */
function matchingPoints() {
  const ds = tbl.ds;
  const l = layers.get(ds.id);
  let pts = shownIndexes(ds).map((i) => ds.points[i]);
  const q = tbl.query.trim().toLowerCase();
  if (q) {
    const words = q.split(/\s+/);
    pts = pts.filter((p) => { const s = searchText(p); return words.every((w) => s.includes(w)); });
  }
  if (tbl.sort.key !== '#' || tbl.sort.dir !== 1) {
    const col = tbl.columns.find((c) => c.key === tbl.sort.key) || tbl.columns[0];
    const dir = tbl.sort.dir;
    const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b)));
    pts = pts.map((p) => [col.value(p), p]).sort((x, y) => {
      // Empty values always go last, whichever way the column is sorted
      const ex = x[0] === '' || x[0] === Infinity, ey = y[0] === '' || y[0] === Infinity;
      if (ex !== ey) return ex ? 1 : -1;
      return cmp(x[0], y[0]) * dir;
    }).map(([, p]) => p);
  }
  tbl.hiddenByFilter = l.mask ? ds.points.length - (l.order.length + l.untimed.length) : 0;
  return pts;
}

/** Open a dataset's points as a table you can search, sort, select, edit and delete from. */
export function openTable(ds) {
  tbl = { ds, query: '', sort: { key: '#', dir: 1 }, page: 0, selected: new Set(), text: new WeakMap(), pos: new Map(), columns: [], undo: null };
  $('#tbl-search').value = '';
  $('#tbl-undo-row').hidden = true;
  $('#table-tools').hidden = false;
  renderTable();
  $('#dlg-table').showModal();
  $('#tbl-search').focus();
}

function renderTable({ keepFocus = null } = {}) {
  const ds = tbl.ds;
  const l = layers.get(ds.id);
  tbl.columns = columnsOf(ds);
  tbl.pos = new Map(l.order.map((i, k) => [ds.points[i], k + 1]));
  // Forget selected points that have gone (deleted, or hidden by the filter)
  const shown = new Set(shownIndexes(ds).map((i) => ds.points[i]));
  for (const p of tbl.selected) if (!shown.has(p)) tbl.selected.delete(p);
  const pts = matchingPoints();
  tbl.matching = pts;
  const pages = Math.max(1, Math.ceil(pts.length / PAGE));
  tbl.page = Math.min(tbl.page, pages - 1);
  const rows = pts.slice(tbl.page * PAGE, (tbl.page + 1) * PAGE);
  tbl.rows = rows;

  $('#table-title').textContent = l.mask
    ? `${ds.name}: ${shown.size.toLocaleString()} of ${ds.points.length.toLocaleString()} points (filtered)`
    : `${ds.name}: ${ds.points.length.toLocaleString()} points`;

  const sortable = (c) => {
    const on = tbl.sort.key === c.key;
    const aria = on ? ` aria-sort="${tbl.sort.dir === 1 ? 'ascending' : 'descending'}"` : '';
    const label = c.key === '#' ? '<span aria-hidden="true">#</span><span class="sr-only">Route order</span>' : esc(c.label);
    return `<th scope="col"${aria}><button type="button" class="sort-btn" data-sort="${esc(c.key)}">${label}<span class="sort-ind" aria-hidden="true">${on ? (tbl.sort.dir === 1 ? '▲' : '▼') : ''}</span></button></th>`;
  };
  const allOnPage = rows.length > 0 && rows.every((p) => tbl.selected.has(p));
  const head = `<caption class="sr-only">Points in ${esc(ds.name)}. Choose a column heading to sort by it.</caption>
    <thead><tr><th scope="col" class="sel"><input type="checkbox" id="tbl-page-check" ${allOnPage ? 'checked' : ''} aria-label="Select every point on this page"></th>${sortable(tbl.columns[0])}<th scope="col"><span class="sr-only">Actions</span></th>${tbl.columns.slice(1).map(sortable).join('')}</tr></thead>`;
  const body = rows.map((p, k) => {
    const n = tbl.pos.get(p) ?? '–';
    const sel = tbl.selected.has(p);
    const name = p.label || `point ${n}`;
    return `<tr${sel ? ' class="is-selected"' : ''}><td class="sel"><input type="checkbox" data-row="${k}" ${sel ? 'checked' : ''} aria-label="Select ${esc(name)}"></td><td>${n}</td><td><span class="row-actions"><button type="button" class="btn btn-sm" data-edit="${k}" aria-label="Edit ${esc(name)}">Edit</button><button type="button" class="btn btn-sm" data-show="${k}" aria-label="Show ${esc(name)} on map">Map</button></span></td><td>${esc(p.label)}</td><td>${p.t != null ? esc(formatDateTime(p.t)) : ''}</td><td class="mono">${p.lat.toFixed(6)}</td><td class="mono">${p.lon.toFixed(6)}</td>${tbl.columns.filter((c) => c.field).map((c) => `<td>${esc(p.props?.[c.field] ?? '')}</td>`).join('')}</tr>`;
  }).join('');
  const empty = rows.length ? '' : `<tfoot><tr><td colspan="${tbl.columns.length + 2}">${tbl.query ? 'No points match your search.' : 'No points to show.'}</td></tr></tfoot>`;
  $('#data-table').innerHTML = head + `<tbody>${body}</tbody>` + empty;

  // Status, selection buttons, pages
  const nSel = tbl.selected.size;
  const matchText = tbl.query ? `${pts.length.toLocaleString()} matching point${pts.length === 1 ? '' : 's'}` : `${pts.length.toLocaleString()} point${pts.length === 1 ? '' : 's'}`;
  $('#tbl-status').textContent = `${matchText}${nSel ? `, ${nSel.toLocaleString()} selected` : ''}.`;
  $('#tbl-select-all').textContent = tbl.query ? `Select all ${pts.length.toLocaleString()} matching` : `Select all ${pts.length.toLocaleString()}`;
  $('#tbl-select-all').disabled = !pts.length || pts.every((p) => tbl.selected.has(p));
  $('#tbl-select-none').disabled = !nSel;
  $('#tbl-delete').disabled = !nSel;
  $('#tbl-delete').textContent = nSel ? `Delete ${nSel.toLocaleString()} selected` : 'Delete selected';
  $('#tbl-pager').hidden = pages < 2;
  $('#tbl-page').textContent = `Page ${tbl.page + 1} of ${pages} (rows ${(tbl.page * PAGE + 1).toLocaleString()}–${Math.min(pts.length, (tbl.page + 1) * PAGE).toLocaleString()})`;
  $('#tbl-prev').disabled = tbl.page === 0;
  $('#tbl-next').disabled = tbl.page >= pages - 1;
  // With a filter on, offer to delete everything it hides (e.g. all points before 08:00)
  $('#tbl-filter-row').hidden = !tbl.hiddenByFilter;
  if (tbl.hiddenByFilter) {
    $('#tbl-filter-text').textContent = `The filter is hiding ${tbl.hiddenByFilter.toLocaleString()} point${tbl.hiddenByFilter === 1 ? '' : 's'} of this dataset.`;
    $('#tbl-delete-hidden').textContent = `Delete the ${tbl.hiddenByFilter.toLocaleString()} hidden point${tbl.hiddenByFilter === 1 ? '' : 's'} for good`;
  }
  if (keepFocus) $(keepFocus)?.focus();
}

/** Apply a change to the dataset's points, redraw, save, and offer Undo. */
function commit(ds, before, message) {
  renderDataset(ds);
  changed();
  save();
  replay.refresh();
  tbl.text = new WeakMap();
  tbl.undo = { ds, before, message };
  $('#tbl-undo-text').textContent = message;
  $('#tbl-undo-row').hidden = false;
  announce(`${message} Press Undo to bring ${/Edited/.test(message) ? 'the old values' : 'them'} back.`);
}

function setPoints(ds, pts) {
  ds.points.length = 0;
  for (const p of pts) ds.points.push(p);
}

function deletePoints(remove, what) {
  const ds = tbl.ds;
  if (!remove.size) return;
  if (remove.size >= ds.points.length) {
    toast('A dataset needs at least one point. To get rid of all of them, remove the dataset instead.', 'error');
    return;
  }
  const before = ds.points.slice();
  setPoints(ds, before.filter((p) => !remove.has(p)));
  for (const p of remove) tbl.selected.delete(p);
  commit(ds, before, `Deleted ${remove.size.toLocaleString()} ${what}${remove.size === 1 ? '' : 's'}.`);
  renderTable({ keepFocus: '#tbl-undo' });
}

function undoTableChange() {
  const u = tbl?.undo;
  if (!u) return;
  setPoints(u.ds, u.before);
  tbl.undo = null;
  renderDataset(u.ds);
  changed();
  save();
  replay.refresh();
  tbl.text = new WeakMap();
  $('#tbl-undo-row').hidden = true;
  announce('Undone');
  renderTable({ keepFocus: '#tbl-search' });
}

// ------------------------------------------------------------------ editing one point

/** "2024-03-14 08:15:00" in the zone times are shown in. */
function editableTime(t) {
  const w = wallClock(t, displayTimeZone());
  const two = (n) => String(n).padStart(2, '0');
  return `${w.y}-${two(w.mo + 1)}-${two(w.d)} ${two(w.h)}:${two(w.mi)}:${two(w.s)}`;
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg || '';
  el.hidden = !msg;
  const input = $(id.replace('-err', ''));
  if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}

function openPointEditor(p) {
  const ds = tbl.ds;
  const dlg = $('#dlg-point');
  const n = tbl.pos.get(p);
  $('#point-title').textContent = `Edit ${p.label ? `"${p.label}"` : n ? `point ${n}` : 'point'}`;
  $('#pt-name').value = p.label || '';
  $('#pt-time').value = p.t != null ? editableTime(p.t) : '';
  $('#pt-zone').textContent = `(${displayTimeZone().replace(/_/g, ' ')} time)`;
  $('#pt-lat').value = String(p.lat);
  $('#pt-lon').value = String(p.lon);
  const fields = [...new Set(ds.points.flatMap((q) => Object.keys(q.props || {})))];
  $('#pt-props').innerHTML = fields.map((f, k) => `<div class="field"><label class="field-label" for="pt-prop-${k}">${esc(f)}</label><input type="text" id="pt-prop-${k}" data-field="${esc(f)}" value="${esc(p.props?.[f] ?? '')}" autocomplete="off"></div>`).join('');
  ['#pt-time-err', '#pt-lat-err', '#pt-lon-err'].forEach((id) => showError(id, ''));
  $('#point-form').onsubmit = (e) => {
    e.preventDefault();
    const label = $('#pt-name').value.trim();
    const timeText = $('#pt-time').value.trim();
    let t = null;
    if (timeText) {
      t = parseDateTime(timeText, 'dmy', displayTimeZone());
    }
    const lat = parseLat($('#pt-lat').value), lon = parseLon($('#pt-lon').value);
    showError('#pt-time-err', timeText && t === null ? "That date and time couldn't be read. Try the form 2024-03-14 08:15:00." : '');
    showError('#pt-lat-err', lat === null ? 'Enter a latitude between -90 and 90, e.g. 51.5074.' : '');
    showError('#pt-lon-err', lon === null ? 'Enter a longitude between -180 and 180, e.g. -0.1278.' : '');
    const bad = (timeText && t === null && '#pt-time') || (lat === null && '#pt-lat') || (lon === null && '#pt-lon');
    if (bad) { $(bad).focus(); return; }
    const props = { ...(p.props || {}) };
    $$('#pt-props [data-field]').forEach((inp) => {
      const v = inp.value.trim();
      if (v === '' && !(inp.dataset.field in (p.props || {}))) return;
      props[inp.dataset.field] = v;
    });
    const edited = { ...p, label, lat, lon, t, props };
    // A time typed here is a definite moment, so later time zone corrections leave it alone
    if (t !== null && t !== p.t) edited.tzx = true;
    if (t === null) delete edited.tzx;
    const before = ds.points.slice();
    const i = ds.points.indexOf(p);
    if (i < 0) { dlg.close(); return; }
    ds.points[i] = edited;
    if (tbl.selected.delete(p)) tbl.selected.add(edited);
    dlg.close();
    commit(ds, before, `Edited ${label || (n ? `point ${n}` : 'a point')}.`);
    renderTable({ keepFocus: '#tbl-undo' });
  };
  $('#pt-delete').onclick = () => {
    dlg.close();
    deletePoints(new Set([p]), 'point');
  };
  dlg.showModal();
  $('#pt-name').focus();
}

// ------------------------------------------------------------------ wiring

function initTable() {
  $('#tbl-search').addEventListener('input', (e) => {
    tbl.query = e.target.value;
    tbl.page = 0;
    clearTimeout(tbl.searchTimer);
    tbl.searchTimer = setTimeout(() => renderTable(), 150);
  });
  $('#tbl-select-all').addEventListener('click', () => {
    tbl.matching.forEach((p) => tbl.selected.add(p));
    renderTable({ keepFocus: '#tbl-delete' });
  });
  $('#tbl-select-none').addEventListener('click', () => {
    tbl.selected.clear();
    renderTable({ keepFocus: '#tbl-search' });
  });
  $('#tbl-delete').addEventListener('click', () => deletePoints(new Set(tbl.selected), 'point'));
  $('#tbl-delete-hidden').addEventListener('click', async () => {
    const ds = tbl.ds;
    const shown = new Set(shownIndexes(ds).map((i) => ds.points[i]));
    const hidden = new Set(ds.points.filter((p) => !shown.has(p)));
    deletePoints(hidden, 'point');
  });
  $('#tbl-undo').addEventListener('click', undoTableChange);
  $('#tbl-prev').addEventListener('click', () => { tbl.page--; renderTable({ keepFocus: '#tbl-prev' }); $('.preview-wrap.tall').scrollTop = 0; });
  $('#tbl-next').addEventListener('click', () => { tbl.page++; renderTable({ keepFocus: '#tbl-next' }); $('.preview-wrap.tall').scrollTop = 0; });

  const table = $('#data-table');
  table.addEventListener('change', (e) => {
    if (!tbl || $('#table-tools').hidden) return;
    const t = e.target;
    if (t.id === 'tbl-page-check') {
      tbl.rows.forEach((p) => (t.checked ? tbl.selected.add(p) : tbl.selected.delete(p)));
      renderTable({ keepFocus: '#tbl-page-check' });
    } else if (t.dataset.row !== undefined) {
      const p = tbl.rows[Number(t.dataset.row)];
      if (t.checked) tbl.selected.add(p); else tbl.selected.delete(p);
      t.closest('tr').classList.toggle('is-selected', t.checked);
      const k = t.dataset.row;
      renderTable({ keepFocus: `#data-table [data-row="${k}"]` });
    }
  });
  table.addEventListener('click', (e) => {
    if (!tbl || $('#table-tools').hidden) return;
    const sort = e.target.closest('[data-sort]');
    if (sort) {
      const key = sort.dataset.sort;
      tbl.sort = { key, dir: tbl.sort.key === key ? -tbl.sort.dir : 1 };
      tbl.page = 0;
      renderTable({ keepFocus: `#data-table [data-sort="${CSS.escape(key)}"]` });
      const col = tbl.columns.find((c) => c.key === key);
      announce(`Sorted by ${col.key === '#' ? 'route order' : col.label}, ${tbl.sort.dir === 1 ? 'ascending' : 'descending'}`);
      return;
    }
    const show = e.target.closest('[data-show]');
    if (show) {
      const p = tbl.rows[Number(show.dataset.show)];
      $('#dlg-table').close();
      closePanelOnMobile();
      focusPoint(tbl.ds.id, tbl.ds.points.indexOf(p));
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) openPointEditor(tbl.rows[Number(edit.dataset.edit)]);
  });
  // Closing the table with a change still undoable: keep Undo on offer for a few more seconds
  $('#dlg-table').addEventListener('close', () => {
    const u = tbl?.undo;
    if (!u || $('#table-tools').hidden) return;
    tbl.undo = null;
    toast(u.message, 'info', {
      duration: 12000,
      action: { label: 'Undo', onClick: () => { setPoints(u.ds, u.before); renderDataset(u.ds); changed(); save(); replay.refresh(); announce('Undone'); } },
    });
  });
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
  $('#table-tools').hidden = true;
  $('#tbl-pager').hidden = true;
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

initTable();

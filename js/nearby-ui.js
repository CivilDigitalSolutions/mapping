/* global L, Papa */
// "Who was here?" in the Datasets panel: choose a place (click the map, the
// map centre or typed coordinates) and a distance, and list every visible
// dataset's visits there. Follows the filter, and updates as data changes.

import { parseCombined } from './coords.js';
import { displayTimeZone, formatDateTime, formatDistance, formatDuration, formatTime, wallClock } from './dates.js';
import { markerSvg } from './icons.js';
import { focusPoint, map, mapClick } from './mapview.js';
import { visitsNear } from './nearby.js';
import { datasets, layers, onChange } from './state.js';
import { $, announce, closePanelOnMobile, download, esc } from './util.js';

let place = null;   // { lat, lon }
let shapes = null;  // circle + centre marker on the map
let results = [];   // [{ ds, visits, nearest }]

const radius = () => Number($('#nb-radius').value);

/** "08:12 → 11:40 GMT" on one day, or full dates either side. */
function span(from, to) {
  if (from == null) return 'No date or time';
  const z = displayTimeZone();
  const a = wallClock(from, z), b = wallClock(to, z);
  const sameDay = a.y === b.y && a.mo === b.mo && a.d === b.d;
  if (to - from < 1000) return formatDateTime(from);
  return `${formatDateTime(from)} → ${sameDay ? formatTime(to) : formatDateTime(to)}`;
}

function drawShapes() {
  if (shapes) shapes.remove();
  if (!place) { shapes = null; return; }
  const centre = L.marker([place.lat, place.lon], {
    draggable: true, keyboard: false, title: 'The chosen place (drag to move it)',
    icon: L.divIcon({ className: 'nb-centre', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
  });
  centre.on('dragend', () => { const ll = centre.getLatLng(); setPlace(ll.lat, ll.lng, { fly: false }); });
  shapes = L.layerGroup([
    L.circle([place.lat, place.lon], { radius: radius(), color: '#6d28d9', weight: 2, dashArray: '6 5', fillColor: '#8b5cf6', fillOpacity: 0.12, interactive: false }),
    centre,
  ]).addTo(map);
}

function setPlace(lat, lon, { fly = true } = {}) {
  place = { lat, lon };
  stopPicking();
  drawShapes();
  if (fly && !map.getBounds().pad(-0.1).contains([lat, lon])) map.panTo([lat, lon]);
  update();
  const n = results.reduce((k, r) => k + r.visits.length, 0);
  announce(n ? `${n} visit${n === 1 ? '' : 's'} found within ${formatDistance(radius())}` : `Nothing came within ${formatDistance(radius())}`);
}

/** Work out the visits and show them. */
function update() {
  const box = $('#nb-results');
  if (!place) {
    box.innerHTML = '';
    $('#nb-actions').hidden = true;
    $('#nearby-summary').textContent = 'Pick a place';
    $('#nearby-box').classList.remove('is-on');
    return;
  }
  const r = radius();
  results = datasets.filter((d) => d.visible && layers.has(d.id)).map((ds) => {
    const l = layers.get(ds.id);
    return { ds, ...visitsNear(ds.points, l.order, place, r, l.untimed) };
  });
  const found = results.filter((x) => x.visits.length);
  const total = found.reduce((k, x) => k + x.visits.length, 0);
  $('#nearby-summary').textContent = total ? `${total} visit${total === 1 ? '' : 's'} within ${formatDistance(r)}` : `None within ${formatDistance(r)}`;
  $('#nearby-box').classList.add('is-on');
  $('#nb-actions').hidden = false;
  $('#nb-csv').disabled = !total;

  const head = `<p class="nb-place">Within ${formatDistance(r)} of <span class="mono">${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}</span></p>`;
  const blocks = results.map((x, di) => {
    const icon = `<span class="nb-icon" aria-hidden="true">${markerSvg({ shape: x.ds.style.shape, color: x.ds.style.color, size: 16 })}</span>`;
    if (!x.visits.length) {
      const n = x.nearest;
      const note = n ? `Not within ${formatDistance(r)}. Closest: ${formatDistance(n.dist)}${n.t != null ? ` at ${formatDateTime(n.t)}` : ''}.` : 'No points.';
      return `<li class="nb-ds is-none">${icon}<span class="nb-name">${esc(x.ds.name)}</span><span class="nb-none">${esc(note)}</span></li>`;
    }
    const visits = x.visits.map((v, vi) => {
      const dur = v.from != null && v.to - v.from >= 1000 ? ` <span class="nb-dur">(${esc(formatDuration(v.to - v.from))})</span>` : '';
      const by = v.count ? '' : '<span class="nb-by">Passed by between recorded points</span>';
      return `<li><span class="nb-when">${esc(span(v.from, v.to))}${dur}</span><span class="nb-closest">closest ${esc(formatDistance(v.closest))}</span>${by}<button type="button" class="link-btn" data-nb="${di}:${vi}" aria-label="Show ${esc(x.ds.name)} at ${esc(span(v.from, v.to))} on the map">Show</button></li>`;
    }).join('');
    return `<li class="nb-ds">${icon}<span class="nb-name">${esc(x.ds.name)}</span><span class="nb-count">${x.visits.length} visit${x.visits.length === 1 ? '' : 's'}</span><ol class="nb-visits">${visits}</ol></li>`;
  }).join('');
  box.innerHTML = head + (results.length ? `<ul class="nb-list">${blocks}</ul>` : '<p class="muted">Switch on a dataset to search it.</p>');
}

// ------------------------------------------------------------------ picking

function startPicking() {
  mapClick.pick = (ll) => { setPlace(ll.lat, ll.lng, { fly: false }); $('#nb-pick').focus(); };
  $('#nb-pick').setAttribute('aria-pressed', 'true');
  $('#nb-pick').textContent = 'Click the map… (Esc to cancel)';
  map.getContainer().classList.add('is-picking');
  closePanelOnMobile();
  announce('Click the map to choose a place. Press Escape to cancel.');
}

function stopPicking() {
  mapClick.pick = null;
  $('#nb-pick').setAttribute('aria-pressed', 'false');
  $('#nb-pick').textContent = 'Pick on the map';
  map.getContainer().classList.remove('is-picking');
}

function saveCsv() {
  const rows = [['dataset', 'from', 'to', 'minutes', 'closest_metres', 'recorded_points_inside', 'place_lat', 'place_lon', 'within_metres']];
  for (const x of results) {
    for (const v of x.visits) {
      rows.push([
        x.ds.name,
        v.from != null ? new Date(v.from).toISOString() : '',
        v.to != null ? new Date(v.to).toISOString() : '',
        v.from != null ? ((v.to - v.from) / 60000).toFixed(1) : '',
        Math.round(v.closest), v.count, place.lat.toFixed(6), place.lon.toFixed(6), radius(),
      ]);
    }
  }
  download('who-was-here.csv', Papa.unparse(rows), 'text/csv');
  announce('Results saved as CSV');
}

function init() {
  $('#nb-pick').addEventListener('click', () => (mapClick.pick ? stopPicking() : startPicking()));
  $('#nb-centre').addEventListener('click', () => { const c = map.getCenter(); setPlace(c.lat, c.lng, { fly: false }); });
  $('#nb-coords-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ll = parseCombined($('#nb-coords').value);
    const err = $('#nb-coords-err');
    err.hidden = !!ll;
    err.textContent = ll ? '' : "Those coordinates couldn't be read. Try latitude, longitude, e.g. 51.5074, -0.1278.";
    $('#nb-coords').toggleAttribute('aria-invalid', !ll);
    if (!ll) { $('#nb-coords').focus(); return; }
    setPlace(ll[0], ll[1]);
  });
  $('#nb-radius').addEventListener('change', () => { drawShapes(); update(); });
  $('#nb-clear').addEventListener('click', () => {
    place = null; results = [];
    stopPicking();
    drawShapes();
    update();
    announce('Place cleared');
    $('#nb-pick').focus();
  });
  $('#nb-csv').addEventListener('click', saveCsv);
  $('#nb-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nb]');
    if (!b) return;
    const [di, vi] = b.dataset.nb.split(':').map(Number);
    const x = results[di], v = x?.visits[vi];
    if (!v) return;
    closePanelOnMobile();
    focusPoint(x.ds.id, v.i);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mapClick.pick) { stopPicking(); announce('Picking cancelled'); } });
  // Data, styles or the filter changed: the visits may have too
  onChange(() => { if (place) update(); });
}

init();

// For other parts of the app (and tests)
export const whoWasHere = { setPlace, get place() { return place; }, get results() { return results; } };

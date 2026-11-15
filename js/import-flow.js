// The Add data dialog: choosing files or pasted text, checking the columns,
// time zones, splitting a file into several datasets, the style for new data,
// drag-and-drop, pasting onto the map, files opened from the operating system,
// and the built-in sample data.

import { trackEvent } from './analytics.js';
import { deviceTimeZone, formatDateTime, isValidTimeZone } from './dates.js';
import { PALETTE } from './icons.js';
import { detectFormat, geojsonToPoints, gpxToPoints, guessMapping, kmlToPoints, parseTable, tableToPoints } from './importers.js';
import { looksLikeProjectText } from './project.js';
import { SAMPLES } from './samples.js';
import { addDataset, fitAll } from './mapview.js';
import { openProjectText } from './project-ui.js';
import { SHAPE_ORDER, datasets, defaultStyle, prefs, savePrefs } from './state.js';
import { fillZoneSelect, renderStyleControls } from './style-controls.js';
import { $, $$, announce, esc, toast, uid } from './util.js';

export const importDlg = $('#dlg-import');

export let queue = [];       // [{ name, text }]

export let pending = null;   // current item being configured

export let addedThisSession = 0;

export function openImport(tab = 'file') {
  showImportStep('source');
  selectTab(tab);
  $('#paste-input').value = '';
  $('#file-input').value = '';
  queue = [];
  addedThisSession = 0;
  if (!importDlg.open) importDlg.showModal();
  (tab === 'paste' ? $('#paste-input') : $('#tab-file')).focus();
}

export function showImportStep(step) {
  $('#import-step-source').hidden = step !== 'source';
  $('#import-step-map').hidden = step !== 'map';
  $('#import-foot').hidden = step !== 'map';
  $('#import-title').textContent = step === 'source' ? 'Add data' : 'Check your data';
}

export function selectTab(which) {
  ['file', 'paste'].forEach((t) => {
    const on = t === which;
    $(`#tab-${t}`).setAttribute('aria-selected', String(on));
    $(`#tab-${t}`).tabIndex = on ? 0 : -1;
    $(`#pane-${t}`).hidden = !on;
  });
}

$$('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab.id.replace('tab-', '')));
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = tab.id === 'tab-file' ? 'paste' : 'file';
      selectTab(next);
      $(`#tab-${next}`).focus();
    }
  });
});

export async function readFiles(fileList) {
  const files = Array.from(fileList);
  const items = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
  return items;
}

export function startQueue(items) {
  queue = items;
  if (!importDlg.open) importDlg.showModal();
  nextInQueue();
}

export function nextInQueue() {
  if (!queue.length) {
    importDlg.close();
    if (addedThisSession) fitAll();
    return;
  }
  const item = queue.shift();
  if (looksLikeProjectText(item.text)) {
    importDlg.close();
    openProjectText(item.text, item.name).then(() => { if (queue.length) startQueue(queue); });
    return;
  }
  try {
    configureItem(item);
  } catch (err) {
    toast(`Couldn't read ${item.name}: ${err.message}`, 'error');
    nextInQueue();
  }
}

export function configureItem(item) {
  const format = detectFormat(item.text, item.name);
  const n = datasets.length + addedThisSession;
  const baseName = item.name.replace(/\.[^.]+$/, '') || `Dataset ${n + 1}`;
  pending = { item, format, name: baseName, table: null, map: null, result: null, style: null };

  if (format === 'table') {
    pending.table = parseTable(item.text);
    if (!pending.table.rows.length) throw new Error('no rows found');
    pending.map = guessMapping(pending.table);
  } else {
    const parse = format === 'geojson' ? geojsonToPoints : format === 'gpx' ? gpxToPoints : kmlToPoints;
    pending.parseGeo = (zone) => parse(item.text, zone);
  }
  fillZoneSelect($('#imp-tz'), isValidTimeZone(prefs.lastImportTz) ? prefs.lastImportTz : deviceTimeZone(), '');

  showImportStep('map');
  $('#import-file-label').textContent = item.name === 'Pasted data' ? 'From pasted data' : `From file: ${item.name}`;
  $('#imp-name').value = baseName;
  $('#imp-columns').hidden = format !== 'table';
  $('#imp-preview-wrap').hidden = format !== 'table';
  $('#btn-import-skip').hidden = queue.length === 0;
  $('#import-queue').textContent = queue.length ? `${queue.length} more file${queue.length === 1 ? '' : 's'} after this` : '';

  if (format === 'table') fillMappingControls();
  recompute();

  const hasTimes = pending.result.points.filter((p) => p.t != null).length >= 2;
  pending.style = defaultStyle(n, hasTimes);
  renderStyleControls($('#imp-style'), pending.style, () => {}, 'imp', pending.result.points);
  fillSplitSelect();
  $('#imp-name').focus();
  $('#imp-name').select();
}

export function fillMappingControls() {
  const { headers } = pending.table;
  const m = pending.map;
  const opts = (sel, allowNone) => {
    const el = $(sel);
    el.innerHTML = (allowNone ? '<option value="-1">— None —</option>' : '<option value="-1">— Choose a column —</option>') +
      headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('');
  };
  opts('#imp-lat'); opts('#imp-lon'); opts('#imp-coords');
  opts('#imp-datetime', true); opts('#imp-date', true); opts('#imp-time', true); opts('#imp-label', true);

  $('#imp-lat').value = m.lat; $('#imp-lon').value = m.lon; $('#imp-coords').value = m.coords;
  $('#imp-order').value = m.order;
  $('#imp-datetime').value = m.datetime; $('#imp-date').value = m.date; $('#imp-time').value = m.time;
  $('#imp-dateorder').value = m.dateOrder;
  $('#imp-label').value = m.label;
  $(`[name="coordmode"][value="${m.mode}"]`).checked = true;
  const tmode = m.datetime >= 0 ? 'single' : m.date >= 0 ? (m.time >= 0 ? 'split' : 'single') : 'none';
  if (tmode === 'single' && m.datetime < 0 && m.date >= 0) { $('#imp-datetime').value = m.date; }
  $(`[name="timemode"][value="${tmode}"]`).checked = true;
  syncModeVisibility();
}

export function syncModeVisibility() {
  const cm = $('[name="coordmode"]:checked').value;
  $$('[data-show]').forEach((el) => { el.hidden = el.dataset.show !== cm; });
  const tm = $('[name="timemode"]:checked').value;
  $$('[data-show-time]').forEach((el) => { el.hidden = !el.dataset.showTime.split(' ').includes(tm); });
}

export function readMappingControls() {
  const v = (s) => Number($(s).value);
  const tm = $('[name="timemode"]:checked').value;
  return {
    mode: $('[name="coordmode"]:checked').value,
    lat: v('#imp-lat'), lon: v('#imp-lon'), coords: v('#imp-coords'),
    order: $('#imp-order').value,
    datetime: tm === 'single' ? v('#imp-datetime') : -1,
    date: tm === 'split' ? v('#imp-date') : -1,
    time: tm === 'split' ? v('#imp-time') : -1,
    dateOrder: $('#imp-dateorder').value,
    label: v('#imp-label'),
    timeZone: importZone(),
  };
}

/** The zone chosen on the import screen, as an IANA name. */
export function importZone() {
  return $('#imp-tz').value || deviceTimeZone();
}

export function recompute() {
  if (pending.format === 'table') {
    pending.map = readMappingControls();
    pending.result = tableToPoints(pending.table, pending.map);
    renderPreview();
  } else {
    pending.result = pending.parseGeo(importZone());
  }
  updateZoneHint();
  if (pending.style) {
    // Columns available for colouring can change with the column choices
    renderStyleControls($('#imp-style'), pending.style, () => {}, 'imp', pending.result.points);
    fillSplitSelect();
  }
  const { points, skipped } = pending.result;
  const timed = points.filter((p) => p.t != null).length;
  const total = pending.format === 'table' ? pending.table.rows.length : points.length + skipped.length;
  const status = $('#imp-status');
  const goBtn = $('#btn-import-go');
  if (!points.length) {
    status.dataset.kind = 'error';
    status.innerHTML = pending.format === 'table'
      ? '<strong>No points could be read yet.</strong> Choose the columns that hold the latitude and longitude.'
      : '<strong>No points found in this file.</strong>';
    goBtn.disabled = true;
  } else {
    status.dataset.kind = skipped.length ? 'warn' : 'ok';
    const parts = [`<strong>${points.length.toLocaleString()} of ${total.toLocaleString()} ${pending.format === 'table' ? 'rows' : 'points'} will be mapped.</strong>`];
    if (timed) parts.push(timed === points.length ? 'All have a date and time.' : `${timed.toLocaleString()} ${timed === 1 ? 'has' : 'have'} a date and time.`);
    else if (pending.format === 'table' && $('[name="timemode"]:checked').value !== 'none') parts.push('No dates or times could be read from the chosen column.');
    if (skipped.length) parts.push(`${skipped.length.toLocaleString()} will be skipped.`);
    status.innerHTML = parts.join(' ');
    goBtn.disabled = false;
  }
  const det = $('#imp-skipped');
  det.hidden = !skipped.length;
  $('#imp-skipped-list').innerHTML = skipped.slice(0, 100).map((s) => `<li>Row ${s.row}: ${esc(s.reason)}</li>`).join('') +
    (skipped.length > 100 ? `<li>…and ${skipped.length - 100} more</li>` : '');
}

export function renderPreview() {
  const { headers, rows } = pending.table;
  const m = pending.map;
  const role = (i) => {
    if (m.mode === 'separate' && i === m.lat) return 'Latitude';
    if (m.mode === 'separate' && i === m.lon) return 'Longitude';
    if (m.mode === 'combined' && i === m.coords) return 'Coordinates';
    if (i === m.datetime) return 'Date & time';
    if (i === m.date) return 'Date';
    if (i === m.time) return 'Time';
    if (i === m.label) return 'Name';
    return '';
  };
  const firstRows = rows.slice(0, 6);
  const parsedBySrc = new Map(pending.result.points.map((p) => [p.src, p]));
  $('#imp-preview').innerHTML = `<caption>Preview of the first ${firstRows.length} of ${rows.length.toLocaleString()} rows</caption>
    <thead><tr><th scope="col">Result</th>${headers.map((h, i) => `<th scope="col" class="${role(i) ? 'is-used' : ''}">${esc(h)}${role(i) ? `<span class="role-tag">${role(i)}</span>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${firstRows.map((r, ri) => {
      const p = parsedBySrc.get(ri + 1);
      const res = p ? `<span class="ok-tag">✓ ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}${p.t != null ? `<br>${esc(formatDateTime(p.t))}` : ''}</span>` : '<span class="bad-tag">✕ Skipped</span>';
      return `<tr><td>${res}</td>${r.map((c, i) => `<td class="${role(i) ? 'is-used' : ''}">${esc(c)}</td>`).join('')}</tr>`;
    }).join('')}</tbody>`;
}

$('#imp-columns').addEventListener('change', () => { syncModeVisibility(); recompute(); });

$('#imp-tz').addEventListener('change', recompute);

$('#imp-split').addEventListener('change', updateSplitHint);

export const SPLIT_HINT = /vehicle|device|unit|tracker|asset|imei|registration|^reg$|callsign|driver|team|crew|route|trip|van|truck|lorry|fleet/i;

export const MAX_SPLIT = 200;

/** Group points by the value of a column. Returns [[value, points]] sorted by value. */
export function groupBy(points, key) {
  const groups = new Map();
  for (const p of points) {
    const v = String(p.props?.[key] ?? '').trim() || '(blank)';
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(p);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

/** Columns that could sensibly split this file, and the one to suggest. */
export function splitCandidates(points) {
  const keys = new Set();
  for (const p of points.slice(0, 500)) Object.keys(p.props || {}).forEach((k) => keys.add(k));
  const out = [];
  for (const k of keys) {
    const distinct = new Set();
    for (const p of points) {
      distinct.add(String(p.props?.[k] ?? '').trim());
      if (distinct.size > MAX_SPLIT) break;
    }
    // Worth splitting: 2+ groups, and groups bigger than one point on average
    if (distinct.size >= 2 && distinct.size <= MAX_SPLIT && distinct.size <= points.length / 2) out.push({ key: k, count: distinct.size });
  }
  const suggested = out.find((c) => SPLIT_HINT.test(c.key) && c.count <= 50);
  return { list: out, suggested: suggested ? suggested.key : '' };
}

export function fillSplitSelect() {
  const sel = $('#imp-split');
  const prev = pending.splitTouched ? sel.value : null;
  const { list, suggested } = splitCandidates(pending.result.points);
  sel.innerHTML = '<option value="">Don\'t split (keep as one dataset)</option>' +
    list.map((c) => `<option value="${esc(c.key)}">${esc(c.key)} (${c.count} groups)</option>`).join('');
  $('#imp-split-field').hidden = !list.length;
  sel.value = prev !== null && list.some((c) => c.key === prev) ? prev : suggested;
  updateSplitHint();
}

export function updateSplitHint() {
  const key = $('#imp-split').value;
  const hint = $('#imp-split-hint');
  if (document.activeElement === $('#imp-split')) pending.splitTouched = true;
  if (!key) { hint.textContent = 'Choose a column such as Vehicle or Device to give each one its own dataset, marker and colour.'; return; }
  const groups = groupBy(pending.result.points, key);
  const shown = groups.slice(0, 6).map(([v, pts]) => `${v} (${pts.length.toLocaleString()})`).join(', ');
  hint.textContent = `This will make ${groups.length} datasets, each with its own colour: ${shown}${groups.length > 6 ? `, and ${groups.length - 6} more` : ''}.`;
}

/** Explain whether the import time zone matters for this file. */
export function updateZoneHint() {
  const pts = pending.result.points;
  const timed = pts.filter((p) => p.t != null).length;
  const explicit = pts.filter((p) => p.tzx).length;
  const field = $('#imp-tz-field'), sel = $('#imp-tz'), hint = $('#imp-tz-hint');
  field.hidden = timed === 0;
  sel.disabled = timed > 0 && explicit === timed;
  hint.textContent = explicit === timed
    ? 'These times already say which time zone they\'re in (for example "Z" or "+01:00"), so they\'re used exactly as written.'
    : explicit
      ? `${explicit.toLocaleString()} of the times say which time zone they're in and are used as written. This setting is for the other ${(timed - explicit).toLocaleString()}.`
      : 'These times don\'t say which time zone they\'re in. Choose where they were recorded so they line up with your other data.';
}

$('#btn-import-go').addEventListener('click', () => {
  if (!pending?.result?.points.length) return;
  const ds = {
    id: uid(),
    name: $('#imp-name').value.trim() || pending.name,
    visible: true,
    style: pending.style,
    points: pending.result.points,
    skipped: pending.result.skipped,
    source: pending.item.name,
    createdAt: Date.now(),
    timeZone: importZone(),
  };
  prefs.lastImportTz = $('#imp-tz').value ? importZone() : '';
  savePrefs();
  const splitKey = $('#imp-split-field').hidden ? '' : $('#imp-split').value;
  if (splitKey) {
    const groups = groupBy(ds.points, splitKey);
    const base = ds.style;
    const colour0 = Math.max(0, PALETTE.indexOf(base.color));
    const shape0 = Math.max(0, SHAPE_ORDER.indexOf(base.shape));
    groups.forEach(([value, pts], k) => {
      addDataset({
        ...ds,
        id: uid(),
        name: `${ds.name}: ${value}`,
        points: pts,
        skipped: k === 0 ? ds.skipped : [],
        // Each group gets the next colour; after every 10, the next shape too
        style: { ...base, color: PALETTE[(colour0 + k) % PALETTE.length], shape: SHAPE_ORDER[(shape0 + Math.floor(k / PALETTE.length)) % SHAPE_ORDER.length] },
      });
    });
    addedThisSession += groups.length;
    trackEvent('import-split');
    announce(`Added ${groups.length} datasets from ${pending.item.name}, split by ${splitKey}.`);
    nextInQueue();
    return;
  }
  addDataset(ds);
  addedThisSession++;
  trackEvent(pending.item.name === 'Pasted data' ? 'import-paste' : 'import-file');
  announce(`Added ${ds.name} with ${ds.points.length} points${ds.skipped.length ? `, ${ds.skipped.length} rows skipped` : ''}.`);
  nextInQueue();
});

$('#btn-import-skip').addEventListener('click', nextInQueue);

$('#btn-import-back').addEventListener('click', () => { queue = []; showImportStep('source'); });

$('#file-input').addEventListener('change', async (e) => {
  if (!e.target.files.length) return;
  startQueue(await readFiles(e.target.files));
});

$('#btn-use-paste').addEventListener('click', () => {
  const text = $('#paste-input').value;
  if (!text.trim()) { toast('Paste some data into the box first.', 'error'); $('#paste-input').focus(); return; }
  startQueue([{ name: 'Pasted data', text }]);
});

// Drag and drop anywhere on the page
export const dz = $('#dropzone');

['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault();
  dz.classList.add('is-over');
  document.body.classList.add('is-dragging');
}));

['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  if (ev === 'dragleave' && e.relatedTarget) return;
  dz.classList.remove('is-over');
  document.body.classList.remove('is-dragging');
}));

document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  addedThisSession = 0;
  startQueue(await readFiles(e.dataTransfer.files));
});

// Paste anywhere on the map (outside text fields) to start an import
document.addEventListener('paste', (e) => {
  const t = e.target;
  if (t.closest && (t.closest('input, textarea, [contenteditable]') || t.closest('dialog[open]'))) return;
  const text = e.clipboardData?.getData('text/plain');
  if (!text || !text.trim()) return;
  e.preventDefault();
  addedThisSession = 0;
  startQueue([{ name: 'Pasted data', text }]);
});

export function loadSamples() {
  SAMPLES.forEach((s, k) => {
    const table = parseTable(s.text);
    const timeZone = s.timeZone || deviceTimeZone();
    const res = tableToPoints(table, { ...guessMapping(table), timeZone });
    const style = { ...defaultStyle(datasets.length, res.points.some((p) => p.t != null)), ...s.style };
    addDataset({ id: uid(), name: s.name, visible: true, style, points: res.points, skipped: res.skipped, source: 'Sample', createdAt: Date.now() + k, timeZone });
  });
  fitAll();
  announce('Sample data added');
  trackEvent('sample-data');
}

// Files opened via the OS "Open with" / share target (installed PWA)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    startQueue(await readFiles(files));
  });
}

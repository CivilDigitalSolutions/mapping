// The Datasets panel: the list of dataset cards, show/hide, Undo after
// removing, the "Keep your work safe" box, the "Show times in" setting and
// opening/closing the panel on phones.

import { NO_VALUE, RAMP_CSS, getScale } from './colour.js';
import { displayTimeZone, formatDateTime, setDisplayTimeZone } from './dates.js';
import { markerSvg } from './icons.js';
import * as store from './store.js';
import { fitDataset, map, removeLayers, renderDataset, replay, scheduleFocusTargets } from './mapview.js';
import { openProjectText, saveProjectFile } from './project-ui.js';
import { openSettings } from './settings.js';
import { datasets, layers, prefs, save, saveFailed, savePrefs, timeRange } from './state.js';
import { exportCSV, exportGeoJSON, openTable } from './table.js';
import { $, announce, closePanelOnMobile, esc, formatBytes, timeAgo, toast } from './util.js';

export function renderList() {
  const list = $('#dataset-list');
  list.innerHTML = '';
  $('#empty-state').hidden = datasets.length > 0;
  const total = datasets.reduce((n, d) => n + d.points.length, 0);
  $('#panel-summary').textContent = datasets.length ? `${datasets.length} · ${total.toLocaleString()} points` : '';
  $('#bulk-visibility').hidden = datasets.length < 2;

  datasets.forEach((ds) => {
    const l = layers.get(ds.id);
    const tr = timeRange(ds);
    const li = document.createElement('li');
    li.className = 'ds-card' + (ds.visible ? '' : ' is-hidden');
    li.style.setProperty('--ds-color', ds.style.color);
    const meta = [`${ds.points.length.toLocaleString()} point${ds.points.length === 1 ? '' : 's'}`];
    if (tr) meta.push(tr.min === tr.max ? formatDateTime(tr.min) : `${formatDateTime(tr.min)} – ${formatDateTime(tr.max)}`);
    const warn = [];
    if (ds.style.showLine && ds.style.lineOrder === 'time' && l?.untimed.length) {
      warn.push(`${l.untimed.length} point${l.untimed.length === 1 ? ' has' : 's have'} no date/time, so ${l.untimed.length === 1 ? "it isn't" : "they aren't"} on the line.`);
    }
    if (ds.skipped?.length) warn.push(`${ds.skipped.length} row${ds.skipped.length === 1 ? ' was' : 's were'} skipped when importing.`);

    li.innerHTML = `
      <div class="ds-row">
        <label class="switch" title="Show or hide on map">
          <input type="checkbox" ${ds.visible ? 'checked' : ''} data-act="toggle">
          <span class="sr-only">Show ${esc(ds.name)} on map</span>
          <span class="switch-track" aria-hidden="true"></span>
        </label>
        <span class="ds-icon" aria-hidden="true">${markerSvg({ shape: ds.style.shape, color: ds.style.color, size: 26 })}</span>
        <div class="ds-text">
          <span class="ds-name">${esc(ds.name)}</span>
          <span class="ds-meta">${esc(meta.join(' · '))}</span>
        </div>
      </div>
      ${scaleHtml(ds)}
      ${warn.length ? `<p class="ds-warn">${warn.map(esc).join(' ')}</p>` : ''}
      <div class="ds-actions" role="group" aria-label="Actions for ${esc(ds.name)}">
        <button type="button" class="btn btn-sm" data-act="zoom">Zoom to</button>
        <button type="button" class="btn btn-sm" data-act="settings">Style</button>
        <button type="button" class="btn btn-sm" data-act="table">Table</button>
        <details class="menu">
          <summary class="btn btn-sm">Export</summary>
          <div class="menu-pop">
            <button type="button" data-act="export-geojson">GeoJSON</button>
            <button type="button" data-act="export-csv">CSV</button>
          </div>
        </details>
        <button type="button" class="btn btn-sm btn-ghost-danger" data-act="remove" aria-label="Remove ${esc(ds.name)}">Remove</button>
      </div>`;

    li.addEventListener('change', (e) => {
      if (e.target.dataset.act === 'toggle') {
        ds.visible = e.target.checked;
        li.classList.toggle('is-hidden', !ds.visible);
        const g = layers.get(ds.id)?.group;
        if (replay.active) replay.refresh();
        else if (g) ds.visible ? g.addTo(map) : map.removeLayer(g);
        announce(`${ds.name} ${ds.visible ? 'shown' : 'hidden'}`);
        save();
      }
    });
    li.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || act === 'toggle') return;
      if (act === 'zoom') { if (!ds.visible) { ds.visible = true; renderDataset(ds); renderList(); save(); } fitDataset(ds); closePanelOnMobile(); }
      if (act === 'settings') openSettings(ds);
      if (act === 'table') openTable(ds);
      if (act === 'export-geojson') { exportGeoJSON(ds); e.target.closest('details').open = false; }
      if (act === 'export-csv') { exportCSV(ds); e.target.closest('details').open = false; }
      if (act === 'remove') removeDataset(ds);
    });
    list.appendChild(li);
  });
  $('#btn-export').disabled = !datasets.length;
  updateStorageStatus();
  replay.refresh();
}

/** The colour scale shown on a dataset's card when it's coloured by value. */
export function scaleHtml(ds) {
  const s = getScale(ds);
  if (!s) return '';
  if (!Number.isFinite(s.min)) return `<p class="ds-scale-none">Coloured by ${esc(s.title)}, but no values were found.</p>`;
  const missing = s.bins.some((b) => b === NO_VALUE);
  return `<div class="ds-scale">
      <span class="ds-scale-title">${esc(s.title)}</span>
      <span class="ds-scale-bar" style="background:${RAMP_CSS}" aria-hidden="true"></span>
      <span class="ds-scale-ends"><span>${s.clipped ? '≤ ' : ''}${esc(s.format(s.min))}</span><span>${s.clipped ? '≥ ' : ''}${esc(s.format(s.max))}</span></span>
      ${missing ? '<span class="ds-scale-missing"><span class="ds-scale-swatch" aria-hidden="true"></span>Grey: no value</span>' : ''}
    </div>`;
}

export function removeDataset(ds) {
  const index = datasets.indexOf(ds);
  removeLayers(ds.id);
  datasets.splice(index, 1);
  map.closePopup();
  renderList();
  save();
  const undoBtn = toast(`Removed "${ds.name}".`, 'info', {
    duration: 12000,
    action: {
      label: 'Undo',
      onClick: () => {
        datasets.splice(Math.min(index, datasets.length), 0, ds);
        renderDataset(ds);
        renderList();
        save();
        announce(`${ds.name} restored`);
        $('#btn-add').focus();
      },
    },
  });
  announce(`${ds.name} removed. Press Undo to bring it back.`);
  undoBtn.focus();
}

/** "Using 4.2 MB of 120 GB available" line in the "Keep your work safe" box. */
export async function updateStorageUsage() {
  const el = $('#storage-usage');
  const [u, kept] = await Promise.all([store.usage(), store.isPersisted()]);
  if (!u || !u.quota) { el.hidden = true; return; }
  const parts = [`<strong>Using ${formatBytes(u.usage)}</strong> of the ${formatBytes(u.quota)} this browser allows.`];
  if (u.data !== null && u.tiles !== null) {
    parts.push(`Your data: ${formatBytes(u.data)}. Offline copy of the app and map: ${formatBytes(u.tiles)}.`);
  }
  parts.push(kept
    ? 'The browser has agreed not to clear it to free up space.'
    : 'The browser may clear it if the device runs low on space.');
  el.innerHTML = parts.join(' ');
  el.hidden = false;
}

export function updateStorageStatus() {
  const el = $('#storage-status');
  const box = $('#storage-box');
  $('#btn-save-project').disabled = !datasets.length;
  let msg, warn = false;
  if (saveFailed) {
    msg = "Your latest changes couldn't be saved in this browser. Save a project file so you don't lose them.";
    warn = true;
  } else if (!datasets.length) {
    msg = 'Your data stays on this device. Open a project file to carry on from another computer.';
  } else if (!prefs.lastBackup) {
    msg = "Your data is only kept in this browser. If browsing data is cleared, it's gone. Save a project file as a backup, or to move it to another computer.";
    warn = true;
  } else if (prefs.lastChange > prefs.lastBackup) {
    msg = `You've made changes since your last project file (${timeAgo(prefs.lastBackup)}). Save again to back them up.`;
    warn = Date.now() - prefs.lastBackup > 7 * 86400000;
  } else {
    msg = `Backed up to a project file ${timeAgo(prefs.lastBackup)}.`;
  }
  el.textContent = msg;
  box.classList.toggle('is-warn', warn);
}

$('#btn-save-project').addEventListener('click', saveProjectFile);

export function setAllVisible(visible) {
  for (const ds of datasets) {
    ds.visible = visible;
    const g = layers.get(ds.id)?.group;
    if (!replay.active && g) visible ? g.addTo(map) : map.removeLayer(g);
  }
  renderList();
  save();
  announce(visible ? 'All datasets shown' : 'All datasets hidden');
}

$('#btn-show-all').addEventListener('click', () => setAllVisible(true));

$('#btn-hide-all').addEventListener('click', () => setAllVisible(false));

$('#btn-open-project').addEventListener('click', () => { $('#project-input').value = ''; $('#project-input').click(); });

$('#project-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) openProjectText(await f.text(), f.name);
});

export const panel = $('#panel');

export const panelBtn = $('#btn-panel');

panelBtn.addEventListener('click', () => {
  const open = !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  panelBtn.setAttribute('aria-expanded', String(open));
  if (open) panel.focus();
  setTimeout(() => map.invalidateSize(), 250);
});

// "Show times in" setting
$('#display-tz').addEventListener('change', (e) => {
  prefs.displayTz = e.target.value;
  setDisplayTimeZone(prefs.displayTz);
  savePrefs();
  map.closePopup();
  renderList();
  scheduleFocusTargets();
  announce(`Times are now shown in ${displayTimeZone().replace(/_/g, ' ')} time`);
});

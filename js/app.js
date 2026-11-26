// Data Mapper start-up: connects the parts of the app, loads saved data and
// registers the service worker. Each part lives in its own module; see the
// project layout in README.md.

import { initAnalytics, trackEvent } from './analytics.js';
import { cleanCell } from './cellsites.js';
import { BASEMAPS, FEATURES } from './config.js';
import { deviceTimeZone, setDisplayTimeZone } from './dates.js';
import { CELL_SAMPLE, SAMPLES } from './samples.js';
import * as store from './store.js';
import './export-ui.js'; // sets up the Export dialog (PDF / video / map file)
import './nearby-ui.js'; // "Who was here?" in the Datasets panel
import { loadCellSample, loadSamples, openImport } from './import-flow.js';
import { baseLayers, fitAll, map, renderAll, replay } from './mapview.js';
import { panel, panelBtn, renderList, updateStorageStatus, updateStorageUsage } from './panel.js';
import { saveProjectFile } from './project-ui.js';
import { completePrefs, datasets, defaultStyle, hooks, onChange, prefs } from './state.js';
import { cleanStyle } from './project.js';
import { initFilterUi } from './filter-ui.js';
import { fillZoneSelect } from './style-controls.js';
import { $, $$, download, toast } from './util.js';

// The Datasets panel redraws whenever datasets change anywhere in the app
onChange(renderList);
hooks.saved = () => { updateStorageUsage(); updateStorageStatus(); };
hooks.saveFailed = () => toast("Your latest changes couldn't be saved in this browser (it may be out of space). Save a project file now so you don't lose them.", 'error', { duration: 0, action: { label: 'Save project file', onClick: saveProjectFile } });

// Buttons and dialogs shared across the app
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); })); // click on the backdrop closes
$('#btn-add').addEventListener('click', () => openImport('file'));
$('#btn-add-empty').addEventListener('click', () => openImport('file'));
$('#btn-sample').addEventListener('click', loadSamples);
$('#btn-fit').addEventListener('click', fitAll);
$('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
$('#btn-replay').addEventListener('click', () => { if (replay.active) trackEvent('replay'); });
if (FEATURES.cellSites) {
  // Cell sites is a preview feature: its buttons only appear when it has been switched on
  $('#btn-sample-cell').hidden = false;
  $('#btn-sample-cell-csv').hidden = false;
  $('#btn-sample-cell').addEventListener('click', loadCellSample);
  $('#btn-sample-cell-csv').addEventListener('click', () => download('sample-cell-sites.csv', CELL_SAMPLE.text, 'text/csv'));
}
$('#btn-sample-csv').addEventListener('click', () => download('sample-track.csv', SAMPLES[0].text, 'text/csv'));

// Load saved preferences and datasets
(async function init() {
  const savedPrefs = await store.get('prefs');
  if (savedPrefs) Object.assign(prefs, savedPrefs);
  completePrefs(); // settings added since these preferences were saved get their defaults
  setDisplayTimeZone(prefs.displayTz);
  fillZoneSelect($('#display-tz'), prefs.displayTz || deviceTimeZone(), '');
  const base = BASEMAPS.find((b) => b.id === prefs.basemap) || BASEMAPS[0];
  baseLayers[base.name].addTo(map);

  const saved = await store.get('datasets');
  if (Array.isArray(saved) && saved.length) {
    // Styles are checked again on loading, in case saved data was changed outside the app
    saved.forEach((d, n) => {
      d.style = cleanStyle(d.style, defaultStyle(n, d.points?.some((p) => p.t != null)));
      if (d.cell) { const c = cleanCell(d.cell); if (c) d.cell = c; else delete d.cell; }
    });
    datasets.push(...saved);
    renderAll();
    fitAll();
  }
  renderList();
  initFilterUi();
  updateStorageStatus();
  updateStorageUsage();
  setInterval(() => { updateStorageStatus(); updateStorageUsage(); }, 60000); // keep "x minutes ago" and usage current
  // On phones, show the "No data yet" panel straight away so people know where to start
  if (!datasets.length && matchMedia('(max-width: 760px)').matches) {
    panel.classList.add('open');
    panelBtn.setAttribute('aria-expanded', 'true');
  }
})();

initAnalytics();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// The Export dialog: PDF report or replay video.

import { trackEvent } from './analytics.js';
import { buildPdf, recordVideo, videoSupport } from './exporters.js';
import { map, replay } from './mapview.js';
import { datasets, layers, prefs, sequenceOf } from './state.js';
import { getScale, setScale } from './colour.js';
import { isActive } from './filters.js';
import { filterText } from './filter-ui.js';
import { eventRows } from './table.js';
import { brandingForExport, initBrandingUi, showBranding } from './branding-ui.js';

initBrandingUi();
import { $, $$, announce, downloadBlob, esc, safeFilename, toast } from './util.js';

/**
 * A dataset as the export should see it: only the points that pass the filter.
 * (A copy, so the dataset itself is untouched; it keeps its colour scale for the legend.)
 */
function shownCopy(ds) {
  const mask = layers.get(ds.id)?.mask;
  if (!mask) return ds;
  const copy = { ...ds, points: ds.points.filter((_, i) => mask[i]) };
  setScale(copy, getScale(ds));
  return copy;
}

export const exportDlg = $('#dlg-export');

export let exportRun = null; // { kind, controller } while an export is running

export function exportKind() { return $('[name="exportkind"]:checked').value; }

export function canVideo() { return replay.hasTimedData() && !!videoSupport(); }

export function syncExportKind() {
  const kind = exportKind();
  $$('[data-kind]', exportDlg).forEach((el) => { el.hidden = el.dataset.kind !== kind; });
  $('#ex-go').textContent = kind === 'pdf' ? 'Create PDF' : 'Record video';
  const follow = $('[name="exview"][value="follow"]');
  if (kind !== 'video' && follow.checked) $('[name="exview"][value="fit"]').checked = true;
  const view = $('[name="exview"]:checked').value;
  $('#ex-follow-opts').hidden = !(kind === 'video' && view === 'follow');
  $('#ex-view-hint').textContent = view === 'follow'
    ? 'The camera glides along with the moving markers. Moving the map on screen won\'t change the video.'
    : 'The map is fixed when you start. Moving the map on screen won\'t change the export.';
}

export function fillFollowTargets() {
  const sel = $('#ex-follow-target');
  const prev = sel.value;
  const timed = datasets.filter((d) => d.visible && d.points.some((p) => p.t !== null && p.t !== undefined));
  sel.innerHTML = (timed.length > 1 ? '<option value="all">All moving datasets</option>' : '') +
    timed.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

export function openExport(kind = 'pdf') {
  if (exportRun) return;
  showBranding();
  const support = videoSupport();
  $('#video-desc').textContent = !support
    ? "This browser can't record video. Try a recent version of Chrome, Edge, Firefox or Safari."
    : !replay.hasTimedData()
      ? 'Needs data with dates and times.'
      : `The routes moving over time, with the date and time on screen. Saved as ${support.ext.toUpperCase()}.`;
  $('#video-speed-hint').textContent = support?.fast
    ? 'Videos are made faster than they play, usually in a fraction of their length. Keep this tab open until it finishes.'
    : 'Recording takes as long as the video itself in this browser. Keep this tab open while it records.';
  $(`[name="exportkind"][value="${kind === 'video' && canVideo() ? 'video' : 'pdf'}"]`).checked = true;
  $('#ex-trail').value = replay.trail || 'all';
  fillFollowTargets();
  $('#ex-progress').hidden = true;
  setExportBusy(false);
  syncExportKind();
  exportDlg.showModal();
  $('#ex-title').focus();
}

export function setExportBusy(busy) {
  $$('input, select, textarea', exportDlg).forEach((el) => {
    el.disabled = busy || (el.name === 'exportkind' && el.value === 'video' && !canVideo());
  });
  $('#ex-go').disabled = busy;
  $('#ex-cancel').textContent = busy && exportKind() === 'video' ? 'Stop recording' : 'Cancel';
  $('#ex-cancel').disabled = busy && exportKind() === 'pdf';
}

export function exportProgress(frac, msg) {
  $('#ex-progress').hidden = false;
  $('#ex-bar').value = frac;
  if (msg) $('#ex-status').textContent = msg;
}

export async function runExport() {
  const kind = exportKind();
  const title = $('#ex-title').value.trim();
  const view = $('[name="exview"]:checked').value;
  const visible = datasets.filter((d) => d.visible);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${safeFilename(title || (kind === 'pdf' ? 'map-report' : 'route-replay'))}_${stamp}`;
  const controller = new AbortController();
  exportRun = { kind, controller };
  setExportBusy(true);
  map.closePopup();
  try {
    if (kind === 'pdf') {
      // Stops / problems are worked out on the real datasets (same ids as the copies)
      const events = new Map(visible.map((d) => [d.id, eventRows(d)]));
      const blob = await buildPdf({
        map, replay, datasets: visible.map(shownCopy), sequenceOf,
        opts: {
          title,
          preparedFor: $('#ex-for').value.trim(),
          notes: $('#ex-notes').value,
          paper: $('#ex-paper').value,
          view,
          tables: $('#ex-tables').checked,
          extraColumns: $('#ex-extra').checked,
          filterText: isActive(prefs.filter) ? filterText() : '',
          eventsOf: (d) => events.get(d.id) || [],
          branding: brandingForExport(),
        },
        onProgress: exportProgress,
      });
      downloadBlob(`${base}.pdf`, blob);
      exportDlg.close();
      toast('PDF report saved to your downloads.');
      trackEvent('export-pdf');
      announce('PDF report saved');
    } else {
      exportProgress(0, 'Getting the map ready…');
      const res = await recordVideo({
        map, replay, datasets: visible.map(shownCopy), signal: controller.signal,
        opts: {
          title,
          branding: brandingForExport(),
          seconds: Number($('#ex-length').value),
          size: $('#ex-size').value,
          camera: view,
          followTarget: $('#ex-follow-target').value || 'all',
          followZoom: Number($('#ex-follow-zoom').value),
          trail: $('#ex-trail').value,
        },
        onProgress: exportProgress,
      });
      if (!res) { exportProgress(0, 'Video cancelled.'); return; }
      downloadBlob(`${base}.${res.ext}`, res.blob);
      exportDlg.close();
      toast(res.tilesOk ? 'Video saved to your downloads.' : "Video saved, but the map background couldn't be included.");
      announce('Video saved');
      trackEvent(view === 'follow' ? 'export-video-follow' : 'export-video');
    }
  } catch (err) {
    exportProgress(0, `Sorry, that didn't work: ${err.message}`);
    toast(`Export failed: ${err.message}`, 'error');
  } finally {
    exportRun = null;
    setExportBusy(false);
  }
}

$('#btn-export').addEventListener('click', () => openExport('pdf'));

$('#rp-video').addEventListener('click', () => openExport('video'));

$$('[name="exportkind"]').forEach((r) => r.addEventListener('change', () => { syncExportKind(); setExportBusy(false); }));

$$('[name="exview"]').forEach((r) => r.addEventListener('change', syncExportKind));

$('#ex-go').addEventListener('click', runExport);

$('#ex-cancel').addEventListener('click', () => {
  if (exportRun?.kind === 'video') exportRun.controller.abort();
  else if (!exportRun) exportDlg.close();
});

// Don't let Esc or a backdrop click close the dialog mid-export
exportDlg.addEventListener('cancel', (e) => { if (exportRun) e.preventDefault(); });

exportDlg.addEventListener('click', (e) => { if (exportRun && e.target === exportDlg) e.stopImmediatePropagation(); }, true);

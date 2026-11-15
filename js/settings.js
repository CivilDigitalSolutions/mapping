// A dataset's Style dialog: name, time zone correction and style.

import { deviceTimeZone, shiftTimes } from './dates.js';
import { renderDataset, replay } from './mapview.js';
import { changed, save } from './state.js';
import { fillZoneSelect, renderStyleControls } from './style-controls.js';
import { $, announce } from './util.js';

export function openSettings(ds) {
  const dlg = $('#dlg-settings');
  $('#settings-title').textContent = `Style: ${ds.name}`;
  const name = $('#set-name');
  name.value = ds.name;
  name.oninput = () => { ds.name = name.value.trim() || 'Untitled'; $('#settings-title').textContent = `Style: ${ds.name}`; };
  // Time zone correction (only for times that didn't state their own zone)
  const tzField = $('#set-tz-field'), tzSel = $('#set-tz');
  const adjustable = ds.points.some((p) => p.t != null && !p.tzx);
  tzField.hidden = !adjustable;
  if (adjustable) {
    fillZoneSelect(tzSel, ds.timeZone || deviceTimeZone(), deviceTimeZone());
    tzSel.onchange = () => {
      const from = ds.timeZone || deviceTimeZone();
      const to = tzSel.value;
      if (!to || to === from) return;
      shiftTimes(ds.points, from, to);
      ds.timeZone = to;
      renderDataset(ds);
      replay.refresh();
      announce(`Times in ${ds.name} now read as ${to.replace(/_/g, ' ')} time`);
    };
  }
  let frame = 0; // redraw at most once per animation frame while styling
  renderStyleControls($('#set-style'), ds.style, () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { renderDataset(ds); replay.refresh(); });
  }, 'set', ds.points);
  dlg.onclose = () => { renderDataset(ds); changed(); save(); };
  dlg.showModal();
}

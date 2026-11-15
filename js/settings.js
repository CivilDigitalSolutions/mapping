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
  // Every change is saved as it's made (not only when the dialog closes), so a reload can't lose it
  name.oninput = () => { ds.name = name.value.trim() || 'Untitled'; $('#settings-title').textContent = `Style: ${ds.name}`; save(); };
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
      changed(); // update the dataset's card straight away, not only when the dialog closes
      save();
      replay.refresh();
      announce(`Times in ${ds.name} now read as ${to.replace(/_/g, ' ')} time`);
    };
  }
  let frame = 0; // redraw at most once per animation frame while styling
  renderStyleControls($('#set-style'), ds.style, () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { renderDataset(ds); replay.refresh(); save(); });
  }, 'set', ds.points);
  dlg.onclose = () => { renderDataset(ds); changed(); save(); };
  dlg.showModal();
}

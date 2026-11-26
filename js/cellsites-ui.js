// The "Cell sites" controls: the tick box that switches the feature on, the
// azimuth / beamwidth / radius column pickers and the defaults. The same
// controls are used on the import screen and in a dataset's Style dialog.
// Only shown when the cell sites preview is switched on (see FEATURES in config.js).

import { CELL_DEFAULTS, UNIT_LABELS, cellSectors } from './cellsites.js';
import { $, esc } from './util.js';

/**
 * Draw the controls into `container`.
 *   columns  names of the columns the data has
 *   cell     the current settings (see CELL_DEFAULTS)
 *   points   the points, so the controls can say how many sectors will be drawn
 *   onChange(cell) is called after every change
 * Returns { get(), refresh(points) }.
 */
export function renderCellControls(container, prefix, columns, cell, onChange, points = []) {
  const state = { ...CELL_DEFAULTS, ...cell };
  const colOptions = (none) => `<option value="">${none}</option>` +
    columns.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const id = (k) => `${prefix}-cell-${k}`;

  container.innerHTML = `
    <label class="tool-check cell-on"><input type="checkbox" id="${id('on')}"> Yes, this data contains cell site (mast) information</label>
    <div class="cell-fields" id="${id('fields')}" hidden>
      <p class="hint">Pick the columns that say which way each antenna faces and how far it reaches. Each row is drawn as a sector on the map.</p>
      <div class="grid-3">
        <div class="field">
          <label for="${id('az')}" class="field-label">Azimuth column</label>
          <select id="${id('az')}" aria-describedby="${id('az-hint')}">${colOptions('— Choose a column —')}</select>
        </div>
        <div class="field">
          <label for="${id('beam')}" class="field-label">Beamwidth column <span class="muted">(optional)</span></label>
          <select id="${id('beam')}">${colOptions('— None: use the default —')}</select>
        </div>
        <div class="field">
          <label for="${id('radius')}" class="field-label">Radius column <span class="muted">(optional)</span></label>
          <select id="${id('radius')}">${colOptions('— None: use the default —')}</select>
        </div>
      </div>
      <p class="hint" id="${id('az-hint')}">Azimuth is the direction the antenna faces, in degrees clockwise from north (0° is north, 90° is east). Beamwidth is how wide the signal spreads, in degrees (360 is a full circle).</p>
      <div class="grid-3">
        <div class="field">
          <label for="${id('dbeam')}" class="field-label">Default beamwidth (°)</label>
          <input type="number" id="${id('dbeam')}" min="1" max="360" step="any" inputmode="decimal">
        </div>
        <div class="field">
          <label for="${id('dradius')}" class="field-label">Default radius</label>
          <input type="number" id="${id('dradius')}" min="0" step="any" inputmode="decimal">
        </div>
        <div class="field">
          <label for="${id('unit')}" class="field-label">Radius is in</label>
          <select id="${id('unit')}">${Object.entries(UNIT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </div>
      </div>
      <p class="hint">The defaults are used for any row without its own beamwidth or radius.</p>
      <div class="status-box" id="${id('status')}" role="status" aria-live="polite"></div>
    </div>`;

  const el = (k) => $(`#${id(k)}`, container);
  let pts = points;

  const write = () => {
    el('on').checked = state.on;
    el('fields').hidden = !state.on;
    el('az').value = columns.includes(state.az) ? state.az : '';
    el('beam').value = columns.includes(state.beam) ? state.beam : '';
    el('radius').value = columns.includes(state.radius) ? state.radius : '';
    el('dbeam').value = state.defaultBeam;
    el('dradius').value = state.defaultRadius;
    el('unit').value = state.unit;
  };

  const status = () => {
    const box = el('status');
    if (!state.on) { box.textContent = ''; return; }
    if (!state.az) {
      box.dataset.kind = 'error';
      box.innerHTML = '<strong>Choose the azimuth column</strong> to draw the sectors.';
      return;
    }
    const { sectors, missing } = cellSectors({ points: pts, cell: state });
    box.dataset.kind = !sectors.length ? 'error' : missing ? 'warn' : 'ok';
    box.innerHTML = !sectors.length
      ? '<strong>No sectors could be drawn.</strong> No row has a readable azimuth in that column.'
      : `<strong>${sectors.length.toLocaleString()} sector${sectors.length === 1 ? '' : 's'} will be drawn.</strong>${missing ? ` ${missing.toLocaleString()} row${missing === 1 ? ' has' : 's have'} no readable azimuth and will only show as a marker.` : ''}`;
  };

  const read = () => {
    state.on = el('on').checked;
    state.az = el('az').value;
    state.beam = el('beam').value;
    state.radius = el('radius').value;
    const b = Number(el('dbeam').value), r = Number(el('dradius').value);
    if (b > 0) state.defaultBeam = Math.min(360, b);
    if (r > 0) state.defaultRadius = r;
    state.unit = el('unit').value;
    el('fields').hidden = !state.on;
    status();
    onChange({ ...state });
  };

  container.onchange = read; // (not addEventListener: the container is reused when the controls are redrawn)
  write();
  status();
  return {
    get: () => ({ ...state }),
    refresh(next) { pts = next; status(); },
  };
}

// Marker and line style controls shared by the import screen and the Style
// dialog, and the time zone picker.

import { colourByOptions } from './colour.js';
import { prefs, savePrefs } from './state.js';
import { deviceTimeZone, timeZoneList } from './dates.js';
import { PALETTE, SHAPES, SHAPE_KEYS, markerSvg } from './icons.js';
import { $, $$, esc } from './util.js';

/**
 * Fill a <select> with time zones. `deviceValue` is the value used for the
 * "this device" option ('' to follow the device, or its IANA name to pin it).
 */
export let zoneNames = null;

export function fillZoneSelect(sel, selected, deviceValue) {
  zoneNames = zoneNames || timeZoneList();
  const dev = deviceTimeZone();
  const common = ['UTC', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;
  sel.innerHTML =
    opt(deviceValue, `This device (${dev.replace(/_/g, ' ')})`) +
    `<optgroup label="Common">${common.filter((z) => z !== dev && zoneNames.includes(z)).map((z) => opt(z, z === 'UTC' ? 'UTC (Coordinated Universal Time)' : z.replace(/_/g, ' '))).join('')}</optgroup>` +
    `<optgroup label="All time zones">${zoneNames.filter((z) => z !== 'UTC').map((z) => opt(z, z.replace(/_/g, ' '))).join('')}</optgroup>`;
  sel.value = selected === dev ? deviceValue : selected;
  if (sel.selectedIndex < 0) sel.value = deviceValue;
}

/**
 * Render marker / line style controls into a container.
 * onChange(style) is called whenever something changes.
 */
export function renderStyleControls(container, style, onChange, prefix, points = []) {
  const byOptions = colourByOptions(points);
  if (!byOptions.some((o) => o.value === style.colourBy)) style.colourBy = 'none';
  const shapeRadios = SHAPE_KEYS.map((k) => `
    <label class="shape-opt" title="${SHAPES[k].label}">
      <input type="radio" name="${prefix}-shape" value="${k}" ${style.shape === k ? 'checked' : ''}>
      <span class="shape-swatch">${markerSvg({ shape: k, color: style.color, size: 26 })}</span>
      <span class="shape-name">${SHAPES[k].label}</span>
    </label>`).join('');
  const colorRadios = PALETTE.map((c, i) => `
    <label class="color-opt" title="Colour ${i + 1}">
      <input type="radio" name="${prefix}-color" value="${c}" ${style.color.toLowerCase() === c.toLowerCase() ? 'checked' : ''}>
      <span class="color-dot" style="background:${c}"></span><span class="sr-only">${c}</span>
    </label>`).join('');

  container.innerHTML = `
    <div class="field">
      <span class="field-label" id="${prefix}-shape-lbl">Marker shape</span>
      <div class="shape-grid" role="radiogroup" aria-labelledby="${prefix}-shape-lbl">${shapeRadios}</div>
    </div>
    <div class="field">
      <span class="field-label" id="${prefix}-color-lbl">Colour</span>
      <div class="color-row" role="radiogroup" aria-labelledby="${prefix}-color-lbl">
        ${colorRadios}
        <label class="color-custom"><span>Custom</span><input type="color" value="${style.color}" data-k="customColor"></label>
      </div>
    </div>
    <div class="grid-2">
      <div class="field">
        <label class="field-label" for="${prefix}-colourby">Colour markers and line by</label>
        <select id="${prefix}-colourby" data-k="colourBy">
          ${byOptions.map((o) => `<option value="${esc(o.value)}" ${style.colourBy === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field" data-speed-unit>
        <label class="field-label" for="${prefix}-speedunit">Speed in</label>
        <select id="${prefix}-speedunit" data-k="speedUnit">
          <option value="mph" ${style.speedUnit === 'mph' ? 'selected' : ''}>Miles per hour (mph)</option>
          <option value="kmh" ${style.speedUnit === 'kmh' ? 'selected' : ''}>Kilometres per hour (km/h)</option>
          <option value="ms" ${style.speedUnit === 'ms' ? 'selected' : ''}>Metres per second (m/s)</option>
        </select>
      </div>
    </div>
    <div data-colourby-hint>
      <p class="hint">Low values are dark purple, high values are yellow. The colour chosen above is still used for the dataset's legend icon and its line during replay.</p>
      <label class="tool-check"><input type="checkbox" data-shared-scale ${prefs.sharedScale ? 'checked' : ''}> Use one scale for every dataset coloured this way, so a colour means the same value on each</label>
    </div>
    <div class="grid-2">
      <div class="field">
        <label class="field-label" for="${prefix}-size">Marker size <span class="muted" data-out="size">${style.size}px</span></label>
        <input type="range" id="${prefix}-size" min="16" max="48" step="2" value="${style.size}" data-k="size">
      </div>
      <div class="field">
        <span class="field-label">Preview</span>
        <div class="style-preview" data-preview></div>
      </div>
    </div>
    <div class="field checks">
      <label><input type="checkbox" data-k="numbered" ${style.numbered ? 'checked' : ''}> Number the markers in order</label>
      <label><input type="checkbox" data-k="showLine" ${style.showLine ? 'checked' : ''}> Join the points with a line</label>
    </div>
    <div class="grid-3" data-line-opts>
      <div class="field">
        <label class="field-label" for="${prefix}-order">Join and number in</label>
        <select id="${prefix}-order" data-k="lineOrder">
          <option value="time" ${style.lineOrder === 'time' ? 'selected' : ''}>Date &amp; time order</option>
          <option value="file" ${style.lineOrder === 'file' ? 'selected' : ''}>Order in the file</option>
        </select>
      </div>
      <div class="field">
        <label class="field-label" for="${prefix}-lstyle">Line style</label>
        <select id="${prefix}-lstyle" data-k="lineStyle">
          <option value="solid" ${style.lineStyle === 'solid' ? 'selected' : ''}>Solid</option>
          <option value="dashed" ${style.lineStyle === 'dashed' ? 'selected' : ''}>Dashed</option>
          <option value="dotted" ${style.lineStyle === 'dotted' ? 'selected' : ''}>Dotted</option>
        </select>
      </div>
      <div class="field checks">
        <label><input type="checkbox" data-k="showArrows" ${style.showArrows ? 'checked' : ''}> Direction arrows</label>
      </div>
    </div>`;

  const refresh = () => {
    $('[data-preview]', container).innerHTML =
      [1, 2, 3].map((n) => markerSvg({ shape: style.shape, color: style.color, size: style.size, label: style.numbered ? n : '' })).join('<span class="preview-line" style="background:' + (style.showLine ? style.color : 'transparent') + '"></span>');
    $$('.shape-swatch', container).forEach((sw, i) => { sw.innerHTML = markerSvg({ shape: SHAPE_KEYS[i], color: style.color, size: 26 }); });
    $('[data-out="size"]', container).textContent = `${style.size}px`;
    $('[data-line-opts]', container).classList.toggle('is-dim', !style.showLine && !style.numbered);
    $('[data-speed-unit]', container).hidden = style.colourBy !== 'speed';
    $('[data-colourby-hint]', container).hidden = style.colourBy === 'none';
  };
  container.oninput = container.onchange = (e) => {
    const t = e.target;
    if (t.name === `${prefix}-shape`) style.shape = t.value;
    else if (t.name === `${prefix}-color`) { style.color = t.value; $('[data-k="customColor"]', container).value = t.value; }
    else if (t.dataset.k === 'customColor') { style.color = t.value; $$(`[name="${prefix}-color"]`, container).forEach((r) => { r.checked = r.value.toLowerCase() === t.value.toLowerCase(); }); }
    else if (t.dataset.k === 'size') style.size = Number(t.value);
    else if (t.matches('[data-shared-scale]')) { prefs.sharedScale = t.checked; savePrefs(); }
    else if (t.type === 'checkbox' && t.dataset.k) style[t.dataset.k] = t.checked;
    else if (t.tagName === 'SELECT' && t.dataset.k) style[t.dataset.k] = t.value;
    else return;
    refresh();
    onChange(style);
  };
  refresh();
}

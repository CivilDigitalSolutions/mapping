// The Filter and "Stops and problems" boxes in the Datasets panel.

import { EMPTY_FILTER, OPS, describeFilter, isActive } from './filters.js';
import { DEFAULT_ANALYSIS, SPEED_UNITS } from './analysis.js';
import { displayTimeZone, formatShort } from './dates.js';
import { refreshAll, replay } from './mapview.js';
import { datasets, layers, onChange, prefs, savePrefs } from './state.js';
import { $, announce, esc } from './util.js';

const SPEED_FIELD = '@speed';
const LABEL_FIELD = '@label';

function fieldLabel(key) {
  if (key === SPEED_FIELD) return `Speed (${(SPEED_UNITS[prefs.analysis.speedUnit] || SPEED_UNITS.mph).label})`;
  if (key === LABEL_FIELD) return 'Name';
  return key;
}

// ------------------------------------------------------------------ filter

/** Column choices: name, calculated speed, and every column in any dataset. */
function fillFields() {
  const sel = $('#flt-field');
  const keep = prefs.filter.field;
  const keys = new Set();
  for (const ds of datasets) for (const p of ds.points.slice(0, 500)) Object.keys(p.props || {}).forEach((k) => keys.add(k));
  const hasTimes = datasets.some((ds) => ds.points.some((p) => p.t != null));
  const opt = (v, label) => `<option value="${esc(v)}">${esc(label)}</option>`;
  sel.innerHTML = opt('', 'Any column (no rule)') + opt(LABEL_FIELD, 'Name') + (hasTimes ? opt(SPEED_FIELD, fieldLabel(SPEED_FIELD)) : '') +
    [...keys].sort((a, b) => a.localeCompare(b)).map((k) => opt(k, k)).join('');
  sel.value = keep;
  if (sel.value !== keep) sel.value = '';
}

/** Suggestions for the value box: the values found in the chosen column. */
function fillValues() {
  const key = $('#flt-field').value;
  const values = new Set();
  if (key && key !== SPEED_FIELD) {
    for (const ds of datasets) {
      for (const p of ds.points) {
        const v = key === LABEL_FIELD ? p.label : p.props?.[key];
        if (v !== undefined && v !== '') values.add(String(v));
        if (values.size >= 100) break;
      }
    }
  }
  $('#flt-values').innerHTML = [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((v) => `<option value="${esc(v)}"></option>`).join('');
}

function readFilter() {
  return {
    from: $('#flt-from').value,
    to: $('#flt-to').value,
    todFrom: $('#flt-tod-from').value,
    todTo: $('#flt-tod-to').value,
    field: $('#flt-field').value,
    op: $('#flt-op').value,
    value: $('#flt-value').value,
  };
}

function writeFilter(f) {
  $('#flt-from').value = f.from || '';
  $('#flt-to').value = f.to || '';
  $('#flt-tod-from').value = f.todFrom || '';
  $('#flt-tod-to').value = f.todTo || '';
  $('#flt-field').value = f.field || '';
  $('#flt-op').value = f.op || 'is';
  $('#flt-value').value = f.value || '';
}

/** Words for the filter, e.g. "14 Mar, 08:00 to 14 Mar, 12:00 · Vehicle is VAN-02". */
export function filterText() {
  return describeFilter(prefs.filter, fieldLabel, (ms) => formatShort(ms, true), displayTimeZone());
}

function updateFilterSummary() {
  const on = isActive(prefs.filter);
  let shown = 0, total = 0;
  for (const ds of datasets) {
    const l = layers.get(ds.id);
    total += ds.points.length;
    shown += l?.mask ? l.order.length + l.untimed.length : ds.points.length;
  }
  $('#filter-summary').textContent = on ? `${shown.toLocaleString()} of ${total.toLocaleString()} points: ${filterText()}` : 'Showing everything';
  $('#filter-box').classList.toggle('is-on', on);
}

let filterTimer = 0;
function applyFilter() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    prefs.filter = readFilter();
    savePrefs();
    refreshAll(); // redraws every dataset; the panel then updates through onChange
    replay.refresh();
    announce(isActive(prefs.filter) ? `Filter on. ${$('#filter-summary').textContent}` : 'Filter cleared. Showing everything.');
  }, 250);
}

// ------------------------------------------------------------------ stops and problems

function writeAnalysis(a) {
  $('#an-show').checked = a.showOnMap;
  $('#an-stop-min').value = a.stopMinutes;
  $('#an-stop-radius').value = a.stopRadius;
  $('#an-gap-min').value = a.gapMinutes;
  $('#an-jump').value = a.jumpSpeed;
  $('#an-unit').value = a.speedUnit;
}

function readAnalysis() {
  const num = (id, fallback, min) => {
    const v = Number($(id).value);
    return Number.isFinite(v) && v >= min ? v : fallback;
  };
  const d = DEFAULT_ANALYSIS;
  return {
    showOnMap: $('#an-show').checked,
    stopMinutes: num('#an-stop-min', d.stopMinutes, 1),
    stopRadius: num('#an-stop-radius', d.stopRadius, 5),
    gapMinutes: num('#an-gap-min', d.gapMinutes, 1),
    jumpSpeed: num('#an-jump', prefs.analysis.jumpSpeed, 10),
    speedUnit: $('#an-unit').value,
  };
}

function updateAnalysisSummary() {
  let stops = 0, gaps = 0, jumps = 0;
  for (const ds of datasets) {
    const a = layers.get(ds.id)?.analysis;
    if (!a || !ds.visible) continue;
    stops += a.stops.length; gaps += a.gaps.length; jumps += a.jumps.length;
  }
  const parts = [];
  if (stops) parts.push(`${stops} stop${stops === 1 ? '' : 's'}`);
  if (gaps) parts.push(`${gaps} gap${gaps === 1 ? '' : 's'}`);
  if (jumps) parts.push(`${jumps} jump${jumps === 1 ? '' : 's'}`);
  $('#analysis-summary').textContent = parts.length ? parts.join(' · ') : 'None found';
}

let analysisTimer = 0;
function applyAnalysis() {
  clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    const before = prefs.analysis.speedUnit;
    prefs.analysis = readAnalysis();
    // Changing mph <-> km/h converts the jump speed so it means the same thing
    if (before !== prefs.analysis.speedUnit) {
      const f = before === 'mph' ? 1.609344 : 1 / 1.609344;
      prefs.analysis.jumpSpeed = Math.round(prefs.analysis.jumpSpeed * f / 10) * 10;
      $('#an-jump').value = prefs.analysis.jumpSpeed;
    }
    savePrefs();
    refreshAll();
  }, 300);
}

// ------------------------------------------------------------------ set up

export function initFilterUi() {
  $('#flt-op').innerHTML = Object.entries(OPS).map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('');
  fillFields();
  writeFilter(prefs.filter);
  fillValues();
  writeAnalysis(prefs.analysis);
  if (isActive(prefs.filter)) $('#filter-box').open = true; // don't hide an active filter from view

  $('#filter-form').addEventListener('input', (e) => {
    if (e.target.id === 'flt-field') fillValues();
    applyFilter();
  });
  $('#filter-form').addEventListener('change', (e) => {
    if (e.target.id === 'flt-field') fillValues();
    applyFilter();
  });
  $('#filter-form').addEventListener('submit', (e) => e.preventDefault());
  $('#flt-clear').addEventListener('click', () => {
    writeFilter(EMPTY_FILTER);
    applyFilter();
    $('#flt-from').focus();
  });
  $('#analysis-form').addEventListener('input', applyAnalysis);
  $('#analysis-form').addEventListener('change', applyAnalysis);
  $('#analysis-form').addEventListener('submit', (e) => e.preventDefault());

  // Keep the column list and summaries up to date as data comes and goes
  onChange(() => {
    fillFields();
    updateFilterSummary();
    updateAnalysisSummary();
  });
  updateFilterSummary();
  updateAnalysisSummary();
}

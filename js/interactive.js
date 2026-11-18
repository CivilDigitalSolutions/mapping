// Save the map as one interactive HTML file a client can open in any browser:
// zoom, click points, see tables and play the replay, with nothing to install.
// Leaflet, the viewer (viewer/) and the data are all inside the file; only the
// map background is loaded from the internet when it's opened.

import { BASEMAPS } from './config.js';
import { binColour, getScale, NO_VALUE, RAMP_CSS } from './colour.js';
import { displayTimeZone } from './dates.js';
import { anchorFor, markerSvg } from './icons.js';
import { layers } from './state.js';

const ASSETS = ['vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'viewer/viewer.js', 'viewer/viewer.css'];

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path}`);
  return res.text();
}

/** Text that is safe inside a <script> or <style> element. */
const inScript = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** One dataset as the viewer needs it: only the points the filter shows. */
function datasetData(ds) {
  const l = layers.get(ds.id);
  const mask = l?.mask;
  const keep = [];
  const newIndex = new Map();
  ds.points.forEach((p, i) => { if (!mask || mask[i]) { newIndex.set(i, keep.length); keep.push(i); } });
  const scale = getScale(ds);
  const coloured = scale && Number.isFinite(scale.min);
  const colours = coloured ? [...new Set(keep.map((i) => binColour(scale.bins[i])))] : null;
  const colourIdx = coloured ? new Map(colours.map((c, k) => [c, k])) : null;
  const fields = [...new Set(keep.flatMap((i) => Object.keys(ds.points[i].props || {})))];
  const st = ds.style;
  const pts = keep.map((i) => {
    const p = ds.points[i];
    return [+p.lat.toFixed(7), +p.lon.toFixed(7), p.t ?? null, p.label || '', coloured ? colourIdx.get(binColour(scale.bins[i])) : 0];
  });
  const vals = keep.map((i) => (fields.length ? fields.map((f) => ds.points[i].props?.[f] ?? '') : 0));
  const order = (l?.order || []).map((i) => newIndex.get(i)).filter((i) => i !== undefined);
  const untimed = (l?.untimed || []).map((i) => newIndex.get(i)).filter((i) => i !== undefined);
  const track = pts.map((_, i) => i).filter((i) => pts[i][2] != null).sort((a, b) => pts[a][2] - pts[b][2] || a - b);
  // Marker pictures: one per colour, with templates for numbers of 1 to 5 digits
  const digits = st.numbered ? String(Math.max(1, order.length)).length : 0;
  const icons = {};
  for (const c of [st.color, ...(colours || [])]) {
    icons[c] = [markerSvg({ shape: st.shape, color: c, size: st.size })];
    for (let n = 1; n <= digits; n++) icons[c][n] = markerSvg({ shape: st.shape, color: c, size: st.size, label: '0'.repeat(n) });
  }
  return {
    name: ds.name,
    color: st.color,
    shape: st.shape,
    size: st.size,
    anchor: anchorFor(st.shape, st.size),
    numbered: !!st.numbered,
    showLine: !!st.showLine,
    dash: st.lineStyle === 'dashed' ? '10 8' : st.lineStyle === 'dotted' ? '2 7' : null,
    icons,
    colours,
    scale: coloured ? { title: scale.title, min: `${scale.clipped ? '≤ ' : ''}${scale.format(scale.min)}`, max: `${scale.clipped ? '≥ ' : ''}${scale.format(scale.max)}`, css: RAMP_CSS, missing: keep.some((i) => scale.bins[i] === NO_VALUE) } : null,
    fields,
    pts,
    vals,
    order,
    untimed,
    track,
    range: track.length ? [pts[track[0]][2], pts[track[track.length - 1]][2]] : null,
  };
}

/**
 * Build the file. opts: { title, branding, basemap, view: null | { center, zoom }, filterText }
 * Returns a Blob (text/html).
 */
export async function buildInteractiveMap(datasets, opts) {
  if (!datasets.length) throw new Error('Switch on at least one dataset to include in the map.');
  const [leafletJs, leafletCss, viewerJs, viewerCss] = await Promise.all(ASSETS.map(fetchText));
  const data = {
    title: opts.title || 'Map',
    org: opts.branding?.name || '',
    logo: opts.branding?.logo || '',
    tz: displayTimeZone(),
    saved: Date.now(),
    filterText: opts.filterText || '',
    basemap: opts.basemap || BASEMAPS[0].id,
    basemaps: BASEMAPS.map((b) => ({ id: b.id, name: b.name, url: b.url, options: b.options })),
    view: opts.view || null,
    datasets: datasets.map(datasetData),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const title = escHtml(data.title);
  const html = `<!doctype html>
<html lang="${escHtml(document.documentElement.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Data Mapper">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://tile.openstreetmap.org https://*.tile.opentopomap.org https://server.arcgisonline.com; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${inScript(leafletCss)}</style>
<style>${inScript(viewerCss)}</style>
</head>
<body>
<div class="v-app">
  <aside id="v-panel" aria-label="Map key and options">
    <button type="button" class="v-btn v-btn-sm v-close" id="v-close">Close</button>
    <header class="v-head">
      <div id="v-brand"></div>
      <div id="v-org"></div>
      <h1 id="v-title">${title}</h1>
      <p id="v-meta"></p>
    </header>
    <div class="v-row">
      <button type="button" class="v-btn" id="v-replay-open" aria-pressed="false">Replay</button>
      <button type="button" class="v-btn" id="v-fit">Fit all</button>
    </div>
    <label class="v-field">Map background <select id="v-base"></select></label>
    <section aria-labelledby="v-list-title">
      <h2 id="v-list-title" class="v-sr">Datasets</h2>
      <ul class="v-list" id="v-list"></ul>
    </section>
    <p class="v-foot">Made with Data Mapper. Click a marker for its details. The map background needs an internet connection; the data is stored in this file.</p>
  </aside>
  <main class="v-map-wrap">
    <h2 class="v-sr">Map</h2>
    <button type="button" class="v-btn v-toggle" id="v-toggle" aria-expanded="false" aria-controls="v-panel">Key &amp; options</button>
    <div id="map" role="region" aria-label="Map"></div>
    <div class="v-replay" id="v-replay" role="group" aria-label="Replay" hidden>
      <div id="v-clock" aria-live="off"></div>
      <button type="button" class="v-btn v-btn-sm" id="v-play" aria-label="Play">Play</button>
      <input type="range" id="v-slider" min="0" max="1000" value="0" aria-label="Replay time">
      <button type="button" class="v-btn v-btn-sm" id="v-replay-close">Close</button>
      <div class="v-replay-opts">
        <label>Speed <select id="v-speed"><option value="60">Whole route in 1 minute</option><option value="30" selected>Whole route in 30 seconds</option><option value="15">Whole route in 15 seconds</option></select></label>
      </div>
    </div>
  </main>
</div>
<dialog class="v-dlg" id="v-table-dlg" aria-labelledby="v-table-title">
  <div class="v-dlg-head"><h2 id="v-table-title">Points</h2><button type="button" class="v-btn v-btn-sm" id="v-table-close">Close</button></div>
  <div class="v-dlg-body"><table id="v-table"></table></div>
</dialog>
<script type="application/json" id="dm-data">${json}</script>
<script>${inScript(leafletJs)}</script>
<script>${inScript(viewerJs)}</script>
</body>
</html>
`;
  return new Blob([html], { type: 'text/html' });
}

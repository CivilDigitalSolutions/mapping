/* global L */
// Drawing the live Leaflet map onto a <canvas>, used by the PDF and video exports.
//
// The background tiles are copied from the map's own <img> tiles (the tile
// servers allow this via CORS). Lines and markers are redrawn from the Leaflet
// layers, so what you see on the map is what ends up in the export.

import { markerSvg } from './icons.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ map sizing

function activeTileLayer(map) {
  let tl = null;
  map.eachLayer((l) => { if (l instanceof L.TileLayer) tl = l; });
  return tl;
}

export async function waitForTiles(map, timeout = 10000) {
  const tl = activeTileLayer(map);
  const start = Date.now();
  await sleep(150);
  while (tl && tl.isLoading && tl.isLoading() && Date.now() - start < timeout) await sleep(100);
  await sleep(150);
}

/**
 * Temporarily give the map a fixed pixel size (e.g. 1280×720), set the view,
 * wait for tiles, run fn(), then put everything back.
 * view: 'fit' (fit bounds of `bounds`) or 'current'.
 */
export async function withMapSize(map, width, height, { view = 'fit', bounds = null } = {}, fn) {
  const el = map.getContainer();
  const saved = { style: el.getAttribute('style') || '', center: map.getCenter(), zoom: map.getZoom() };
  document.body.classList.add('is-capturing');
  el.style.cssText = `${saved.style};position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:0;`;
  map.invalidateSize({ animate: false });
  if (view === 'fit' && bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [Math.round(height * 0.12), Math.round(width * 0.08)], maxZoom: 16, animate: false });
  else map.setView(saved.center, saved.zoom, { animate: false });
  await waitForTiles(map);
  try {
    return await fn();
  } finally {
    el.setAttribute('style', saved.style);
    document.body.classList.remove('is-capturing');
    map.invalidateSize({ animate: false });
    map.setView(saved.center, saved.zoom, { animate: false });
  }
}

// ------------------------------------------------------------------ basemap

/**
 * Draw the background tiles. Returns false if the tiles can't be copied
 * (the tile server didn't allow it), in which case a plain background is used.
 */
export function drawBasemap(ctx, map, scale) {
  const c = map.getContainer().getBoundingClientRect();
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.fillStyle = '#e8edf2';
  ctx.fillRect(0, 0, w, h);
  const tiles = map.getContainer().querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded');
  tiles.forEach((img) => {
    const r = img.getBoundingClientRect();
    const op = Number(getComputedStyle(img.parentElement.parentElement).opacity || 1);
    ctx.globalAlpha = op;
    // +0.5px overlap hides hairline seams between tiles
    ctx.drawImage(img, (r.left - c.left) * scale, (r.top - c.top) * scale, r.width * scale + 0.5, r.height * scale + 0.5);
  });
  ctx.globalAlpha = 1;
  try {
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    ctx.fillStyle = '#e8edf2';
    ctx.fillRect(0, 0, w, h);
    return false;
  }
}

// ------------------------------------------------------------------ overlays

const imgCache = new Map();
function svgImage(svg) {
  if (imgCache.has(svg)) return imgCache.get(svg);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  imgCache.set(svg, p);
  if (imgCache.size > 2000) imgCache.delete(imgCache.keys().next().value);
  return p;
}

/** Re-size an <svg> string so it rasterises crisply at `scale`. */
function scaledSvg(html, scale) {
  const m = html.match(/<svg[\s\S]*<\/svg>/);
  if (!m) return null;
  let svg = m[0].replace(/style="[^"]*"/, ''); // CSS transforms/filters are applied on the canvas instead
  svg = svg.replace(/width="([\d.]+)"/, (_, v) => `width="${v * scale}"`).replace(/height="([\d.]+)"/, (_, v) => `height="${v * scale}"`);
  return svg;
}

/** Draw every visible line and marker from the Leaflet map. */
export async function drawOverlays(ctx, map, scale) {
  const lines = [], arrows = [], markers = [], heads = [];
  map.eachLayer((l) => {
    if (l instanceof L.Polyline) lines.push(l);
    else if (l instanceof L.Marker && l.options.icon instanceof L.DivIcon) {
      const cls = l.options.icon.options.className || '';
      if (cls.includes('dm-arrow')) arrows.push(l);
      else if (cls.includes('dm-head')) heads.push(l);
      else if (cls.includes('dm-marker')) markers.push(l);
    }
  });
  const size = map.getSize();
  const inView = (p, pad = 60) => p.x > -pad && p.y > -pad && p.x < size.x + pad && p.y < size.y + pad;

  // Lines
  for (const line of lines) {
    const o = line.options;
    const flat = line.getLatLngs().flat(Infinity);
    if (flat.length < 2) continue;
    ctx.save();
    ctx.beginPath();
    flat.forEach((ll, i) => {
      const p = map.latLngToContainerPoint(ll);
      if (i === 0) ctx.moveTo(p.x * scale, p.y * scale); else ctx.lineTo(p.x * scale, p.y * scale);
    });
    ctx.strokeStyle = o.color;
    ctx.globalAlpha = o.opacity ?? 1;
    ctx.lineWidth = (o.weight ?? 3) * scale;
    ctx.lineCap = o.lineCap || 'round';
    ctx.lineJoin = o.lineJoin || 'round';
    ctx.setLineDash(o.dashArray ? String(o.dashArray).split(/[ ,]+/).map((n) => Number(n) * scale) : []);
    ctx.stroke();
    ctx.restore();
  }

  // Direction arrows (rotated)
  for (const a of arrows) {
    const p = map.latLngToContainerPoint(a.getLatLng());
    if (!inView(p)) continue;
    const html = a.options.icon.options.html;
    const angle = Number((html.match(/rotate\(([-\d.]+)deg\)/) || [])[1] || 0);
    const img = await svgImage(scaledSvg(html, scale));
    if (!img) continue;
    const [w, h] = a.options.icon.options.iconSize;
    ctx.save();
    ctx.translate(p.x * scale, p.y * scale);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(img, (-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale);
    ctx.restore();
  }

  // Markers, drawn top-to-bottom like Leaflet does
  const drawMarker = async (m, ring) => {
    const p = map.latLngToContainerPoint(m.getLatLng());
    if (!inView(p)) return;
    const io = m.options.icon.options;
    const [w, h] = io.iconSize;
    const [ax, ay] = io.iconAnchor;
    if (ring) {
      const color = (io.html.match(/--c:\s*([^;"]+)/) || [])[1] || '#000';
      ctx.save();
      ctx.beginPath();
      ctx.arc((p.x - ax + w / 2) * scale, (p.y - ay + h / 2) * scale, w * 0.8 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 3 * scale;
      ctx.stroke();
      ctx.restore();
    }
    const img = await svgImage(scaledSvg(io.html, scale));
    if (!img) return;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 3 * scale;
    ctx.shadowOffsetY = 1 * scale;
    ctx.drawImage(img, (p.x - ax) * scale, (p.y - ay) * scale, w * scale, h * scale);
    ctx.restore();
  };
  markers.sort((a, b) => a.getLatLng().lat < b.getLatLng().lat ? 1 : -1);
  for (const m of markers) await drawMarker(m, false);
  for (const m of heads) await drawMarker(m, true);
}

// ------------------------------------------------------------------ captions

export function attributionText(map) {
  const parts = Object.keys(map.attributionControl?._attributions || {});
  const tmp = document.createElement('div');
  return parts.map((h) => { tmp.innerHTML = h; return tmp.textContent.trim(); }).filter(Boolean).join(' | ');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/** Small credit line in the bottom-right corner (required by the map providers). */
export function drawAttribution(ctx, map, u, bottomOffset = 0) {
  const text = `© ${attributionText(map).replace(/^©\s*/, '')}`;
  ctx.save();
  ctx.font = `${11 * u}px ${FONT}`;
  const w = ctx.measureText(text).width + 12 * u;
  const x = ctx.canvas.width - w, y = ctx.canvas.height - 20 * u - bottomOffset;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(x, y, w, 20 * u);
  ctx.fillStyle = '#333';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6 * u, y + 10 * u);
  ctx.restore();
}

/** Legend box listing each dataset with its marker. Returns its height. */
export async function drawLegend(ctx, datasets, u, { x = 16, bottom = 36 } = {}) {
  if (!datasets.length) return 0;
  const rowH = 26 * u, pad = 10 * u, icon = 18;
  ctx.save();
  ctx.font = `600 ${13 * u}px ${FONT}`;
  const names = datasets.map((d) => truncate(ctx, d.name, 320 * u));
  const w = Math.max(...names.map((n) => ctx.measureText(n).width)) + pad * 2 + 28 * u;
  const h = rowH * datasets.length + pad * 1.2;
  const left = x * u, top = ctx.canvas.height - bottom * u - h;
  ctx.fillStyle = 'rgba(255,255,255,.93)';
  ctx.shadowColor = 'rgba(0,0,0,.25)';
  ctx.shadowBlur = 8 * u;
  roundRect(ctx, left, top, w, h, 8 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  for (let i = 0; i < datasets.length; i++) {
    const d = datasets[i];
    const cy = top + pad * 0.6 + rowH * i + rowH / 2;
    const img = await svgImage(markerSvg({ shape: d.style.shape, color: d.style.color, size: icon * u }));
    if (img) ctx.drawImage(img, left + pad, cy - (icon * u) / 2, icon * u, icon * u);
    ctx.fillStyle = '#16202b';
    ctx.textBaseline = 'middle';
    ctx.fillText(names[i], left + pad + 26 * u, cy);
  }
  ctx.restore();
  return h;
}

/** Title and clock panel in the top-left corner (video). */
export function drawTitleClock(ctx, { title, time, u }) {
  ctx.save();
  const pad = 14 * u;
  ctx.font = `700 ${26 * u}px ${FONT}`;
  const timeW = ctx.measureText(time).width;
  ctx.font = `600 ${15 * u}px ${FONT}`;
  const t = title ? truncate(ctx, title, 640 * u) : '';
  const titleW = t ? ctx.measureText(t).width : 0;
  const w = Math.max(timeW, titleW) + pad * 2;
  const h = (t ? 24 * u : 0) + 34 * u + pad * 1.4;
  const x = 16 * u, y = 16 * u;
  ctx.fillStyle = 'rgba(255,255,255,.93)';
  ctx.shadowColor = 'rgba(0,0,0,.25)';
  ctx.shadowBlur = 8 * u;
  roundRect(ctx, x, y, w, h, 10 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.textBaseline = 'top';
  let cy = y + pad * 0.8;
  if (t) {
    ctx.fillStyle = '#4a5867';
    ctx.fillText(t, x + pad, cy);
    cy += 24 * u;
  }
  ctx.font = `700 ${26 * u}px ${FONT}`;
  ctx.fillStyle = '#16202b';
  ctx.fillText(time, x + pad, cy);
  ctx.restore();
}

export function drawProgress(ctx, fraction, color, u) {
  const h = 6 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(0, ctx.canvas.height - h, ctx.canvas.width, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, ctx.canvas.height - h, ctx.canvas.width * fraction, h);
  ctx.restore();
}

function truncate(ctx, s, max) {
  s = String(s);
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

/** Render a marker as a PNG data URL (for the PDF legend). */
export async function markerPng(style, px = 64) {
  const img = await svgImage(markerSvg({ shape: style.shape, color: style.color, size: px }));
  const c = document.createElement('canvas');
  c.width = c.height = px;
  if (img) c.getContext('2d').drawImage(img, 0, 0, px, px);
  return c.toDataURL('image/png');
}

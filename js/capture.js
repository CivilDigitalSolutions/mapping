/* global L */
// Off-screen map rendering for the PDF and video exports.
//
// Exports never read positions from the on-screen map. Each frame is drawn
// through its own "camera" (centre + zoom + pixel size): background tiles are
// fetched and placed by the camera, and lines/markers are projected by the
// camera. Moving or zooming the visible map while exporting therefore has no
// effect on the output, and the camera can move on its own to follow a route.

import { cellActive } from './cellsites.js';
import { markerSvg } from './icons.js';
import { PointLayer } from './pointlayer.js';
import { getScale, RAMP_STOPS } from './colour.js';
import { metresPerPixel, metricScale, imperialScale } from './scalebar.js';

const CRS = L.CRS.EPSG3857;
const TILE = 256;

// ------------------------------------------------------------------ camera

/**
 * A camera looks at `center` at (possibly fractional) `zoom`, producing a
 * W×H image (in CSS pixels) drawn at `scale` device pixels per CSS pixel.
 */
export function makeCamera(center, zoom, W, H, scale = 1) {
  const c = L.latLng(center);
  const origin = CRS.latLngToPoint(c, zoom).subtract([W / 2, H / 2]);
  return {
    center: c, zoom, W, H, scale, origin,
    toPoint(ll) {
      const p = CRS.latLngToPoint(L.latLng(ll), zoom);
      return { x: (p.x - origin.x) * scale, y: (p.y - origin.y) * scale };
    },
  };
}

/** Zoom level at which `bounds` fits inside W×H with padding. */
export function fitZoom(bounds, W, H, { padX = 0, padY = 0, maxZoom = 16, minZoom = 1 } = {}) {
  if (!bounds || !bounds.isValid()) return minZoom;
  const a = CRS.latLngToPoint(bounds.getNorthWest(), 0);
  const b = CRS.latLngToPoint(bounds.getSouthEast(), 0);
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  const zx = dx > 0 ? Math.log2(Math.max(1, W - 2 * padX) / dx) : Infinity;
  const zy = dy > 0 ? Math.log2(Math.max(1, H - 2 * padY) / dy) : Infinity;
  const z = Math.min(zx, zy);
  return Math.max(minZoom, Math.min(maxZoom, Number.isFinite(z) ? z : maxZoom));
}

/** A fixed camera framing `bounds`. */
export function fitCamera(bounds, W, H, scale = 1, opts = {}) {
  const pad = { padX: Math.round(W * 0.08), padY: Math.round(H * 0.12), ...opts };
  const z = fitZoom(bounds, W, H, pad);
  const center = bounds && bounds.isValid() ? boundsCenter(bounds) : L.latLng(20, 0);
  return makeCamera(center, z, W, H, scale);
}

/** Centre in projected (Mercator) space, which is what the eye expects on a web map. */
export function boundsCenter(bounds) {
  const a = CRS.latLngToPoint(bounds.getNorthWest(), 0);
  const b = CRS.latLngToPoint(bounds.getSouthEast(), 0);
  return CRS.pointToLatLng(L.point((a.x + b.x) / 2, (a.y + b.y) / 2), 0);
}

/** A camera showing the same area as the on-screen map, at a new pixel size. */
export function currentViewCamera(map, W, H, scale = 1) {
  const size = map.getSize();
  const z = map.getZoom() + Math.log2(Math.min(W / size.x, H / size.y));
  return makeCamera(map.getCenter(), z, W, H, scale);
}

// ------------------------------------------------------------------ tiles

/** Describe the background tile layer currently selected on the map. */
export function tileSource(map) {
  let tl = null;
  map.eachLayer((l) => { if (l instanceof L.TileLayer) tl = l; });
  if (!tl) return null;
  const o = tl.options;
  const subs = typeof o.subdomains === 'string' ? o.subdomains.split('') : o.subdomains || [];
  const maxNative = o.maxNativeZoom ?? o.maxZoom ?? 19;
  return {
    minZoom: o.minZoom ?? 0,
    maxZoom: maxNative,
    url(x, y, z) {
      return L.Util.template(tl._url, { ...o, r: '', s: subs.length ? subs[Math.abs(x + y) % subs.length] : '', x, y, z });
    },
  };
}

/** Tiles needed to draw `cam`: [{ url, sx, sy, size }] in device pixels. */
export function tilesFor(cam, src) {
  if (!src) return [];
  const tz = Math.max(src.minZoom, Math.min(src.maxZoom, Math.round(cam.zoom)));
  const s = 2 ** (cam.zoom - tz);        // CSS px per tile px
  const size = TILE * s;
  const n = 2 ** tz;
  const out = [];
  const x0 = Math.floor(cam.origin.x / size), x1 = Math.floor((cam.origin.x + cam.W) / size);
  const y0 = Math.max(0, Math.floor(cam.origin.y / size)), y1 = Math.min(n - 1, Math.floor((cam.origin.y + cam.H) / size));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wx = ((x % n) + n) % n; // wrap around the antimeridian
      out.push({
        url: src.url(wx, y, tz),
        sx: (x * size - cam.origin.x) * cam.scale,
        sy: (y * size - cam.origin.y) * cam.scale,
        size: size * cam.scale,
      });
    }
  }
  return out;
}

const tileCache = new Map(); // url -> Promise<HTMLImageElement|null>
const tileReady = new Map(); // url -> HTMLImageElement|null once settled

function loadTile(url) {
  if (!tileCache.has(url)) {
    tileCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // required so the image can go into a video/PDF
      const done = (v) => { tileReady.set(url, v); resolve(v); };
      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = url;
      setTimeout(() => { if (!tileReady.has(url)) done(null); }, 15000);
    }));
    if (tileCache.size > 4000) {
      const k = tileCache.keys().next().value;
      tileCache.delete(k);
      tileReady.delete(k);
    }
  }
  return tileCache.get(url);
}

/**
 * Download every tile in `urls` (a few at a time). Returns { loaded, failed }.
 */
export async function preloadTiles(urls, onProgress, signal) {
  const list = [...new Set(urls)];
  let i = 0, done = 0, failed = 0;
  const worker = async () => {
    while (i < list.length && !signal?.aborted) {
      const url = list[i++];
      const img = await loadTile(url);
      if (!img) failed++;
      done++;
      onProgress?.(done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { loaded: done - failed, failed, total: list.length };
}

/** Draw the background for `cam` from already-downloaded tiles. */
export function drawTiles(ctx, cam, src) {
  ctx.fillStyle = '#e8edf2';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const t of tilesFor(cam, src)) {
    const img = tileReady.get(t.url);
    // +0.5px overlap hides hairline seams between tiles
    if (img) ctx.drawImage(img, t.sx, t.sy, t.size + 0.5, t.size + 0.5);
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

/**
 * Draw the lines and markers that are currently on the map, positioned by
 * `cam` (not by the on-screen map's view).
 */
export async function drawOverlays(ctx, map, cam) {
  const scale = cam.scale;
  const lines = [], polygons = [], arrows = [], markers = [], heads = [], pointLayers = [], events = [];
  map.eachLayer((l) => {
    if (l instanceof PointLayer) pointLayers.push(l);
    else if (l instanceof L.Polygon) polygons.push(l); // (a Polygon is also a Polyline, so it must be checked first)
    else if (l instanceof L.Polyline) lines.push(l);
    else if (l instanceof L.Marker && l.options.icon instanceof L.DivIcon) {
      const cls = l.options.icon.options.className || '';
      if (cls.includes('dm-arrow')) arrows.push(l);
      else if (cls.includes('dm-head')) heads.push(l);
      else if (cls.includes('dm-marker')) markers.push(l);
      else if (cls.includes('dm-event')) events.push(l); // stop / gap / jump symbols
    }
  });
  const pad = 60 * scale;
  const inView = (p) => p.x > -pad && p.y > -pad && p.x < cam.W * scale + pad && p.y < cam.H * scale + pad;

  // Cell site sectors: filled shapes, underneath everything else
  for (const poly of polygons) {
    const o = poly.dmStyle || poly.options; // dmStyle is the resting look, whatever the mouse is doing
    const ring = poly.getLatLngs().flat(1);
    if (ring.length < 3) continue;
    const pts = ring.map((ll) => cam.toPoint(ll));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    if (Math.max(...xs) < 0 || Math.min(...xs) > cam.W * scale || Math.max(...ys) < 0 || Math.min(...ys) > cam.H * scale) continue; // wholly off the picture
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.globalAlpha = o.fillOpacity ?? 0.2;
    ctx.fillStyle = o.fillColor || o.color;
    ctx.fill();
    ctx.globalAlpha = o.opacity ?? 1;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = (o.weight ?? 1.5) * scale;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // Lines
  for (const line of lines) {
    const o = line.options;
    const flat = line.getLatLngs().flat(Infinity);
    if (flat.length < 2) continue;
    ctx.save();
    ctx.beginPath();
    flat.forEach((ll, i) => {
      const p = cam.toPoint(ll);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
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
    const p = cam.toPoint(a.getLatLng());
    if (!inView(p)) continue;
    const html = a.options.icon.options.html;
    const angle = Number((html.match(/rotate\(([-\d.]+)deg\)/) || [])[1] || 0);
    const img = await svgImage(scaledSvg(html, scale));
    if (!img) continue;
    const [w, h] = a.options.icon.options.iconSize;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.drawImage(img, (-w / 2) * scale, (-h / 2) * scale, w * scale, h * scale);
    ctx.restore();
  }

  // Markers, drawn top-to-bottom like Leaflet does
  const drawMarker = async (m, ring) => {
    const p = cam.toPoint(m.getLatLng());
    if (!inView(p)) return;
    const io = m.options.icon.options;
    const [w, h] = io.iconSize;
    const [ax, ay] = io.iconAnchor;
    const left = p.x - ax * scale, top = p.y - ay * scale;
    if (ring) {
      const color = (io.html.match(/--c:\s*([^;"]+)/) || [])[1] || '#000';
      ctx.save();
      ctx.beginPath();
      ctx.arc(left + (w / 2) * scale, top + (h / 2) * scale, w * 0.8 * scale, 0, Math.PI * 2);
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
    ctx.drawImage(img, left, top, w * scale, h * scale);
    ctx.restore();
  };
  // Each dataset's canvas markers, in dataset order
  pointLayers.sort((a, b) => L.stamp(a) - L.stamp(b));
  for (const pl of pointLayers) await pl.drawTo(ctx, cam);

  markers.sort((a, b) => (a.getLatLng().lat < b.getLatLng().lat ? 1 : -1));
  for (const m of markers) await drawMarker(m, false);
  for (const m of events) await drawMarker(m, false);
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

/**
 * Legend box listing each dataset with its marker, plus a colour bar for any
 * dataset coloured by value. Long lists are cut short with "and N more".
 * Returns its height.
 */
export async function drawLegend(ctx, datasets, u, { x = 16, bottom = 36, maxRows = 12 } = {}) {
  if (!datasets.length) return 0;
  const rowH = 26 * u, scaleH = 44 * u, pad = 10 * u, icon = 18;
  const shown = datasets.length > maxRows ? datasets.slice(0, maxRows - 1) : datasets;
  const more = datasets.length - shown.length;
  ctx.save();
  ctx.font = `600 ${13 * u}px ${FONT}`;
  const names = shown.map((d) => truncate(ctx, d.name, 320 * u));
  const scales = shown.map((d) => { const sc = getScale(d); return sc && Number.isFinite(sc.min) ? sc : null; });
  const barW = 220 * u;
  // A dataset drawn as cell sectors gets a small sector shape next to its marker, so the text starts further along
  const offs = shown.map((d) => (cellActive(d) ? 52 : 26) * u);
  const w = Math.max(...names.map((n, i) => ctx.measureText(n).width + offs[i]), scales.some(Boolean) ? barW + 26 * u : 0) + pad * 2 + 2 * u;
  const h = shown.reduce((sum, _, i) => sum + rowH + (scales[i] ? scaleH : 0), 0) + (more ? rowH : 0) + pad * 1.2;
  const left = x * u, top = ctx.canvas.height - bottom * u - h;
  ctx.fillStyle = 'rgba(255,255,255,.93)';
  ctx.shadowColor = 'rgba(0,0,0,.25)';
  ctx.shadowBlur = 8 * u;
  roundRect(ctx, left, top, w, h, 8 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  let y = top + pad * 0.6;
  for (let i = 0; i < shown.length; i++) {
    const d = shown[i];
    const cy = y + rowH / 2;
    const img = await svgImage(markerSvg({ shape: d.style.shape, color: d.style.color, size: icon * u }));
    if (img) ctx.drawImage(img, left + pad, cy - (icon * u) / 2, icon * u, icon * u);
    if (cellActive(d)) drawSectorSwatch(ctx, left + pad + 34 * u, cy, 10 * u, d.style.color);
    ctx.font = `600 ${13 * u}px ${FONT}`;
    ctx.fillStyle = '#16202b';
    ctx.textBaseline = 'middle';
    ctx.fillText(names[i], left + pad + offs[i], cy);
    y += rowH;
    const sc = scales[i];
    if (sc) {
      // Scale title, colour bar, then the low and high values at each end
      const bx = left + pad + 26 * u, bh = 8 * u;
      ctx.font = `${11 * u}px ${FONT}`;
      ctx.fillStyle = '#4a5867';
      ctx.textBaseline = 'top';
      ctx.fillText(truncate(ctx, sc.title, barW), bx, y - 3 * u);
      const by = y + 12 * u;
      const grad = ctx.createLinearGradient(bx, 0, bx + barW, 0);
      RAMP_STOPS.forEach((c, k) => grad.addColorStop(k / (RAMP_STOPS.length - 1), c));
      ctx.fillStyle = grad;
      roundRect(ctx, bx, by, barW, bh, 4 * u);
      ctx.fill();
      ctx.fillStyle = '#4a5867';
      const lo = `${sc.clipped ? '≤ ' : ''}${sc.format(sc.min)}`, hi = `${sc.clipped ? '≥ ' : ''}${sc.format(sc.max)}`;
      ctx.fillText(truncate(ctx, lo, barW * 0.48), bx, by + bh + 3 * u);
      ctx.textAlign = 'right';
      ctx.fillText(truncate(ctx, hi, barW * 0.48), bx + barW, by + bh + 3 * u);
      ctx.textAlign = 'left';
      y += scaleH;
    }
  }
  if (more) {
    ctx.font = `600 ${13 * u}px ${FONT}`;
    ctx.fillStyle = '#4a5867';
    ctx.textBaseline = 'middle';
    ctx.fillText(`and ${more} more dataset${more === 1 ? '' : 's'}`, left + pad + 26 * u, y + rowH / 2);
  }
  ctx.restore();
  return h;
}

/** A small wedge, the legend's picture of a cell sector. (cx, cy) is the middle of its height. */
function drawSectorSwatch(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.8);
  ctx.arc(cx, cy + r * 0.8, r * 1.6, (-90 - 32) * (Math.PI / 180), (-90 + 32) * (Math.PI / 180));
  ctx.closePath();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();
  ctx.restore();
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

// ------------------------------------------------------------------ scale bar, north arrow, branding

/** Load an image (e.g. the uploaded logo, stored as a data: URL). Resolves to null if it can't be read. */
export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Metric and imperial scale bars, bottom-right, above the map credits.
 * `bottom` is the space to leave below it, in device pixels.
 */
export function drawScaleBar(ctx, cam, u, bottom = 0) {
  const mpp = metresPerPixel(cam.center.lat, cam.zoom) / cam.scale; // metres per device pixel
  const maxPx = 130 * u;
  const metric = metricScale(maxPx * mpp);
  const imperial = imperialScale(maxPx * mpp);
  const wM = metric.metres / mpp, wI = imperial.metres / mpp;
  const pad = 8 * u, w = Math.max(wM, wI) + pad * 2, h = 46 * u;
  const x = ctx.canvas.width - w - 10 * u, y = ctx.canvas.height - h - bottom - 6 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.88)';
  roundRect(ctx, x, y, w, h, 6 * u);
  ctx.fill();
  ctx.strokeStyle = '#16202b';
  ctx.fillStyle = '#16202b';
  ctx.lineWidth = 2 * u;
  ctx.font = `600 ${11 * u}px ${FONT}`;
  ctx.textBaseline = 'bottom';
  // Metric above the line, imperial below it, both starting at the left
  const lx = x + pad, ly = y + h / 2;
  ctx.beginPath();
  ctx.moveTo(lx, ly - 6 * u); ctx.lineTo(lx, ly + 6 * u);
  ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.max(wM, wI), ly);
  ctx.moveTo(lx + wM, ly - 6 * u); ctx.lineTo(lx + wM, ly);
  ctx.moveTo(lx + wI, ly); ctx.lineTo(lx + wI, ly + 6 * u);
  ctx.stroke();
  ctx.fillText(metric.label, lx + 3 * u, ly - 3 * u);
  ctx.textBaseline = 'top';
  ctx.fillText(imperial.label, lx + 3 * u, ly + 3 * u);
  ctx.restore();
}

/** A north arrow centred on (cx, cy). Web maps always have north at the top. */
export function drawNorthArrow(ctx, cx, cy, u) {
  const r = 20 * u;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.shadowColor = 'rgba(0,0,0,.25)';
  ctx.shadowBlur = 6 * u;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#16202b';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r + 5 * u);
  ctx.lineTo(cx + 7 * u, cy + 4 * u);
  ctx.lineTo(cx, cy + 1 * u);
  ctx.lineTo(cx - 7 * u, cy + 4 * u);
  ctx.closePath();
  ctx.fill();
  ctx.font = `700 ${10 * u}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy + 11 * u);
  ctx.restore();
}

/**
 * The organisation's logo and/or name in a white box, top-right.
 * Returns the box's height in device pixels (0 if there's nothing to show).
 */
export function drawBranding(ctx, logo, name, u, { size = 1, panel = true } = {}) {
  if (!logo && !name) return 0;
  // `size` scales the logo: 1 = up to 44 px tall / 200 px wide on a 1280 × 720 video
  const pad = (panel ? 10 : 0) * u, maxH = 44 * u * size, maxW = 200 * u * size;
  let lw = 0, lh = 0;
  if (logo) {
    const s = Math.min(maxH / logo.naturalHeight, maxW / logo.naturalWidth);
    lw = logo.naturalWidth * s; lh = logo.naturalHeight * s;
  }
  ctx.save();
  ctx.font = `700 ${15 * u}px ${FONT}`;
  const text = name ? truncate(ctx, name, 320 * u) : '';
  const tw = text ? ctx.measureText(text).width : 0;
  const gap = logo && text ? 10 * u : 0;
  const w = pad * 2 + lw + gap + tw;
  const h = pad * 2 + Math.max(lh, text ? 20 * u : 0);
  const x = ctx.canvas.width - w - 16 * u, y = 16 * u;
  if (panel) {
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 8 * u;
    roundRect(ctx, x, y, w, h, 10 * u);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  if (logo) {
    // Smooth, high-quality scaling so the logo stays crisp
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!panel) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4 * u; }
    ctx.drawImage(logo, x + pad, y + (h - lh) / 2, lw, lh);
    ctx.shadowColor = 'transparent';
  }
  if (text) {
    ctx.textBaseline = 'middle';
    if (!panel) {
      // No panel: a white outline keeps the name readable on the map
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4 * u;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.strokeText(text, x + pad + lw + gap, y + h / 2);
    }
    ctx.fillStyle = '#16202b';
    ctx.fillText(text, x + pad + lw + gap, y + h / 2);
  }
  ctx.restore();
  return h;
}

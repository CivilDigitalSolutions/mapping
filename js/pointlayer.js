/* global L */
// Fast marker layer: draws all of a dataset's markers onto one <canvas>
// instead of creating a page element per marker. This keeps the map smooth
// with tens of thousands of points.
//
// Keyboard and screen-reader access is provided by FocusTargets (below),
// which adds focusable buttons over the markers when few enough are in view.

import { spriteFor, labelSpec, SHAPES } from './icons.js';

const CRS = L.CRS.EPSG3857;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export const PointLayer = L.Layer.extend({
  options: { pane: 'dmPoints', padding: 0.2 },

  /**
   * @param {object} ds       dataset ({ id, name, style, points })
   * @param {Map} labels      point index -> sequence label (only when numbering is on)
   * @param {object} [options]
   */
  initialize(ds, labels, options) {
    L.setOptions(this, options);
    this.ds = ds;
    this.labels = labels || new Map();
    this._window = null; // [from, to] when replay limits which points show
    const n = ds.points.length;
    this._x0 = new Float64Array(n);
    this._y0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = CRS.latLngToPoint(L.latLng(ds.points[i].lat, ds.points[i].lon), 0);
      this._x0[i] = p.x;
      this._y0[i] = p.y;
    }
    // Draw from north to south so lower markers sit on top, as Leaflet does
    this._order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => this._y0[a] - this._y0[b]);
  },

  // ------------------------------------------------------------ Leaflet hooks

  onAdd(map) {
    this._canvas = L.DomUtil.create('canvas', 'dm-point-canvas');
    if (map._zoomAnimated) L.DomUtil.addClass(this._canvas, 'leaflet-zoom-animated');
    this._ctx = this._canvas.getContext('2d');
    this.getPane().appendChild(this._canvas);
    this._reset();
  },

  onRemove() {
    L.DomUtil.remove(this._canvas);
    this._canvas = null;
    this._drawnCount = 0;
  },

  getEvents() {
    const ev = { viewreset: this._reset, moveend: this._reset, resize: this._reset, zoom: this._onZoom };
    if (this._map && this._map._zoomAnimated) ev.zoomanim = this._onAnimZoom;
    return ev;
  },

  // ------------------------------------------------------------ public

  /** Only show points whose time is within [from, to]; null shows everything. */
  setTimeWindow(from, to) {
    this._window = from === null && to === null ? null : [from, to];
    this.redraw();
  },

  isShown(i) {
    if (!this._window) return true;
    const t = this.ds.points[i].t;
    return t !== null && t !== undefined && t >= this._window[0] && t <= this._window[1];
  },

  redraw() {
    if (this._map && this._canvas) this._draw();
    return this;
  },

  /** Topmost point under a container (screen) point, or -1. */
  hitTest(containerPoint) {
    if (!this._map || !this._drawnCount) return -1;
    const lp = this._map.containerPointToLayerPoint(containerPoint);
    const cx = lp.x - this._origin.x, cy = lp.y - this._origin.y;
    const s = this._sprite;
    const slop = 3;
    for (let k = this._drawnCount - 1; k >= 0; k--) {
      const left = this._dx[k] - (s.ax - 4), top = this._dy[k] - (s.ay - 4);
      if (cx >= left - slop && cx <= left + s.size + slop && cy >= top - slop && cy <= top + s.size + slop) return this._drawn[k];
    }
    return -1;
  },

  /** Indexes of shown points inside the given LatLngBounds. */
  pointsIn(bounds) {
    const out = [];
    const pts = this.ds.points;
    for (let i = 0; i < pts.length; i++) {
      if (this.isShown(i) && bounds.contains([pts[i].lat, pts[i].lon])) out.push(i);
    }
    return out;
  },

  /**
   * Draw onto another canvas through an export camera (see capture.js).
   * cam.toPoint(latlng) gives device pixels; cam.scale is device px per CSS px.
   */
  async drawTo(ctx, cam) {
    const st = this.ds.style;
    const sprite = spriteFor(st.shape, st.color, st.size, cam.scale);
    await sprite.promise;
    const W = ctx.canvas.width, H = ctx.canvas.height, pad = 60 * cam.scale;
    const occupied = occupancy(W + 2 * pad, H + 2 * pad, st.size * cam.scale);
    for (const i of this._order) {
      if (!this.isShown(i)) continue;
      const p = cam.toPoint([this.ds.points[i].lat, this.ds.points[i].lon]);
      if (p.x < -pad || p.y < -pad || p.x > W + pad || p.y > H + pad) continue;
      if (!this.labels.size && occupied(p.x + pad, p.y + pad)) continue;
      const x = p.x / cam.scale, y = p.y / cam.scale;
      ctx.drawImage(sprite.canvas, (x - sprite.ax) * cam.scale, (y - sprite.ay) * cam.scale, sprite.w * cam.scale, sprite.h * cam.scale);
      this._drawLabel(ctx, i, x - sprite.ax + 4, y - sprite.ay + 4, cam.scale);
    }
  },

  // ------------------------------------------------------------ internals

  _reset() {
    const map = this._map;
    const p = this.options.padding;
    const size = map.getSize();
    const min = map.containerPointToLayerPoint(size.multiplyBy(-p)).round();
    const box = size.multiplyBy(1 + p * 2).round();
    this._origin = min;
    this._box = box;
    this._center = map.getCenter();
    this._zoom = map.getZoom();
    L.DomUtil.setPosition(this._canvas, min);
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    this._canvas.width = Math.round(box.x * dpr);
    this._canvas.height = Math.round(box.y * dpr);
    this._canvas.style.width = `${box.x}px`;
    this._canvas.style.height = `${box.y}px`;
    this._draw();
  },

  _draw() {
    const map = this._map;
    const ctx = this._ctx;
    const st = this.ds.style;
    const dpr = this._dpr;
    const sprite = spriteFor(st.shape, st.color, st.size, dpr);
    this._sprite = sprite;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    if (!sprite.ready) {
      // First use of this marker style: draw as soon as its image is ready
      sprite.promise.then(() => this.redraw());
      this._drawnCount = 0;
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = 2 ** this._zoom;
    const po = map.getPixelOrigin();
    const ox = po.x + this._origin.x, oy = po.y + this._origin.y;
    const n = this._order.length;
    if (!this._drawn || this._drawn.length < n) {
      this._drawn = new Int32Array(n);
      this._dx = new Float32Array(n);
      this._dy = new Float32Array(n);
    }
    const bw = this._box.x, bh = this._box.y, m = sprite.w;
    const occupied = occupancy(bw + 2 * m, bh + 2 * m, st.size);
    let c = 0;
    for (let k = 0; k < n; k++) {
      const i = this._order[k];
      if (this._window && !this.isShown(i)) continue;
      const x = this._x0[i] * scale - ox, y = this._y0[i] * scale - oy;
      if (x < -m || y < -m || x > bw + m || y > bh + m) continue;
      if (!this.labels.size && occupied(x + m, y + m)) continue; // an identical marker is already drawn here
      ctx.drawImage(sprite.canvas, x - sprite.ax, y - sprite.ay, sprite.w, sprite.h);
      if (this.labels.size) this._drawLabel(ctx, i, x - sprite.ax + 4, y - sprite.ay + 4, 1);
      this._drawn[c] = i; this._dx[c] = x; this._dy[c] = y; c++;
    }
    this._drawnCount = c;
    this.fire('redraw');
  },

  /** Sequence number inside the marker; (left, top) is the marker's top-left in CSS px. */
  _drawLabel(ctx, i, left, top, scale) {
    const label = this.labels.get(i);
    if (label === undefined || label === null || label === '') return;
    const st = this.ds.style;
    const str = String(label);
    const spec = labelSpec(st.shape, st.color, str);
    const k = st.size / 32;
    ctx.save();
    ctx.font = `700 ${spec.fs * k * scale}px ${FONT}`;
    ctx.fillStyle = spec.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, (left + spec.x * k) * scale, (top + spec.y * k) * scale);
    ctx.restore();
  },

  // Zoom animation, as Leaflet's own canvas renderer does it
  _onAnimZoom(ev) { this._updateTransform(ev.center, ev.zoom); },
  _onZoom() { this._updateTransform(this._map.getCenter(), this._map.getZoom()); },
  _updateTransform(center, zoom) {
    const map = this._map;
    const scale = map.getZoomScale(zoom, this._zoom);
    const viewHalf = map.getSize().multiplyBy(0.5 + this.options.padding);
    const currentCenterPoint = map.project(this._center, zoom);
    const topLeftOffset = viewHalf.multiplyBy(-scale).add(currentCenterPoint).subtract(map._getNewPixelOrigin(center, zoom));
    if (L.Browser.any3d) L.DomUtil.setTransform(this._canvas, topLeftOffset, scale);
    else L.DomUtil.setPosition(this._canvas, topLeftOffset);
  },
});

/**
 * Returns occupied(x, y): true if a marker has already been drawn within a few
 * pixels of (x, y), otherwise marks the spot and returns false. Skipping these
 * near-duplicates looks identical (they'd be hidden underneath) but saves most
 * of the drawing when thousands of points overlap at low zoom.
 */
let gridBuf = new Uint8Array(0);
function occupancy(w, h, markerSize) {
  const cell = Math.max(2, markerSize / 6);
  const gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
  if (gridBuf.length < gw * gh) gridBuf = new Uint8Array(gw * gh);
  else gridBuf.fill(0, 0, gw * gh);
  return (x, y) => {
    const k = Math.floor(y / cell) * gw + Math.floor(x / cell);
    if (gridBuf[k]) return true;
    gridBuf[k] = 1;
    return false;
  };
}

/** Where a popup should point for a marker of this style (Leaflet popup offset). */
export function popupOffset(style) {
  const bottom = SHAPES[style.shape]?.anchor === 'bottom';
  return [0, 7 - (bottom ? style.size * 0.9 : style.size / 2)];
}

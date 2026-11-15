/* global L */
// Video (replay) and PDF report exports. Everything runs in the browser —
// no data is sent anywhere.
//
// Both exports draw through their own camera (see capture.js), so the
// on-screen map can be moved, zoomed or resized during an export without
// changing the result.

import {
  makeCamera, fitCamera, fitZoom, boundsCenter, currentViewCamera, tileSource, tilesFor, preloadTiles,
  drawTiles, drawOverlays, drawLegend, drawTitleClock, drawProgress, drawAttribution, markerPng,
  drawScaleBar, drawNorthArrow, drawBranding, loadImage,
} from './capture.js';
import { formatDateTime, formatDuration, formatDistance, displayTimeZone } from './dates.js';
import { distanceMetres } from './coords.js';
import { pdfLogoSize } from './branding-ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CRS = L.CRS.EPSG3857;

function boundsOf(datasets) {
  const b = L.latLngBounds([]);
  datasets.forEach((d) => d.points.forEach((p) => b.extend([p.lat, p.lon])));
  return b;
}

/** Stop the on-screen map from being dragged or zoomed while exporting. */
function freezeMap(map) {
  const handlers = ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard'];
  const was = handlers.filter((h) => map[h] && map[h].enabled());
  was.forEach((h) => map[h].disable());
  map.getContainer().classList.add('is-frozen');
  return () => {
    was.forEach((h) => map[h].enable());
    map.getContainer().classList.remove('is-frozen');
  };
}

// =================================================================== video

/**
 * How this browser can make videos:
 * - fast: encoded straight to MP4 with WebCodecs, much quicker than the video's length
 * - otherwise recorded in real time with MediaRecorder
 * Returns { mime, ext, fast } or null if neither works.
 */
export function videoSupport() {
  if (fastVideoPossible()) return { mime: 'video/mp4', ext: 'mp4', fast: true };
  return recorderSupport();
}

function recorderSupport() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const types = [
    ['video/mp4;codecs=avc1.640028', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
  ];
  const hit = types.find(([t]) => MediaRecorder.isTypeSupported(t));
  return hit ? { mime: hit[0], ext: hit[1], fast: false } : null;
}

// Tests can turn the fast path off to check the real-time fallback
const fastVideoPossible = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && !globalThis.__noFastVideo;

/** An H.264 encoder setup this browser supports at this size, or null. */
async function h264Config(W, H, fps) {
  if (!fastVideoPossible()) return null;
  // High, Main, then Baseline profile, all level 4.0/4.2 (enough for 1080p at 30 fps)
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a']) {
    const config = { codec, width: W, height: H, bitrate: W > 1500 ? 12e6 : 8e6, framerate: fps, avc: { format: 'avc' } };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch { /* try the next */ }
  }
  return null;
}

/**
 * Encode frames to an MP4 as fast as they can be drawn.
 * draw(f) draws frame f onto the canvas. Returns a Blob, or null if cancelled.
 */
async function encodeMp4({ canvas, config, fps, total, draw, onFrame, signal }) {
  const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer/mp4-muxer.mjs');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: config.width, height: config.height, frameRate: fps }, fastStart: 'in-memory' });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  const frameUs = 1e6 / fps;
  let lastYield = performance.now();
  try {
    for (let f = 0; f < total; f++) {
      if (signal?.aborted) return null;
      if (failure) throw failure;
      await draw(f);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(f * frameUs), duration: Math.round(frameUs) });
      encoder.encode(vf, { keyFrame: f % (fps * 2) === 0 }); // a key frame every 2 s, so players can seek
      vf.close();
      // Don't race ahead of the encoder (keeps memory down)
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      onFrame(f);
      // Let the page repaint the progress bar now and then
      if (performance.now() - lastYield > 100) { await sleep(0); lastYield = performance.now(); }
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

/**
 * Work out a camera for every frame before recording starts.
 * camera: 'fit' | 'current' | 'follow'
 * For 'follow', the camera glides after the moving markers (one dataset, or all of them).
 */
function planCameras({ map, replay, frames, W, H, opts, legendBounds }) {
  if (opts.camera !== 'follow') {
    const cam = opts.camera === 'current' ? currentViewCamera(map, W, H) : fitCamera(legendBounds, W, H);
    return frames.map(() => cam);
  }

  // How close to zoom in: relative to the zoom that fits the whole route, so it
  // works for a walk around a site and for a drive across a country alike.
  const overview = fitZoom(legendBounds, W, H, { padX: W * 0.08, padY: H * 0.12, maxZoom: 18 });
  const followZoom = Math.min(17, overview + Number(opts.followZoom || 2));
  const follow = opts.followTarget || 'all';
  // Generous margins so markers stay clear of the clock and legend boxes
  const padX = W * 0.22, padY = H * 0.28;

  // Raw target (centre in world pixels at zoom 0, plus zoom) for each frame
  let last = null;
  const targets = frames.map((t) => {
    replay.seek(t);
    let heads = replay.heads();
    if (follow !== 'all') heads = heads.filter((h) => h.ds.id === follow);
    else if (heads.some((h) => !h.done)) heads = heads.filter((h) => !h.done); // let go of finished routes
    if (!heads.length) return last;
    const b = L.latLngBounds(heads.map((h) => h.latlng));
    // With several markers, zoom out as needed to keep them all in shot
    const z = heads.length > 1 ? Math.min(followZoom, fitZoom(b, W, H, { padX, padY, maxZoom: followZoom })) : followZoom;
    last = { p: CRS.latLngToPoint(boundsCenter(b), 0), z };
    return last;
  });
  // Frames before anything starts moving look at the first position
  const first = targets.find(Boolean) || { p: CRS.latLngToPoint(boundsCenter(legendBounds), 0), z: overview };
  for (let i = 0; i < targets.length && !targets[i]; i++) targets[i] = first;

  // Smooth the path so the camera glides instead of jerking from point to point.
  // Forward and backward passes cancel out the lag a one-way filter would add.
  const smooth = (vals, a) => {
    const f = vals.slice();
    for (let i = 1; i < f.length; i++) f[i] = f[i - 1] + (f[i] - f[i - 1]) * a;
    for (let i = f.length - 2; i >= 0; i--) f[i] = f[i + 1] + (f[i] - f[i + 1]) * a;
    return f;
  };
  const a = 0.08;
  const xs = smooth(targets.map((t) => t.p.x), a);
  const ys = smooth(targets.map((t) => t.p.y), a);
  const zs = smooth(targets.map((t) => t.z), a / 2);
  return frames.map((_, i) => makeCamera(CRS.pointToLatLng(L.point(xs[i], ys[i]), 0), zs[i], W, H));
}

/**
 * Record the route replay to a video file.
 * opts: { title, seconds, size: '720'|'1080', camera: 'fit'|'current'|'follow', followTarget, followZoom, trail }
 * Every setting is fixed when recording starts; nothing on screen can change the result.
 * Returns { blob, ext, tilesOk } or null if cancelled.
 */
export async function recordVideo({ map, replay, datasets = [], opts, onProgress, signal }) {
  if (!videoSupport()) throw new Error('This browser cannot record video. Please use a recent version of Chrome, Edge, Firefox or Safari.');
  if (!replay.active && !replay.open()) throw new Error('None of the visible datasets have dates and times to replay.');
  replay.pause();
  if (opts.trail) replay.setTrail(opts.trail);
  let { min, max } = replay.range;
  const shown = replay.datasets;
  // Following one dataset: the video covers just that dataset's time span
  if (opts.camera === 'follow' && opts.followTarget && opts.followTarget !== 'all') {
    const target = shown.find((d) => d.id === opts.followTarget);
    const ts = target ? target.points.map((p) => p.t).filter((t) => t !== null && t !== undefined) : [];
    if (ts.length > 1) { min = Math.min(...ts); max = Math.max(...ts); }
  }
  if (!(max > min)) throw new Error('The replay needs at least two different dates or times.');
  // Legend and framing cover every visible dataset, including ones without dates
  const legend = datasets.length ? datasets : shown;
  const legendBounds = boundsOf(legend);

  const [W, H] = opts.size === '1080' ? [1920, 1080] : [1280, 720];
  const u = W / 1280;
  const fps = 30;
  const N = Math.max(2, Math.round(opts.seconds * fps));
  const lead = fps;        // 1 s still at the start
  const hold = fps * 2;    // 2 s still at the end
  const total = lead + N + hold;
  const timeAt = (f) => {
    const k = Math.min(Math.max(f - lead, 0), N - 1);
    return min + ((max - min) * k) / (N - 1);
  };
  const frameTimes = Array.from({ length: total }, (_, f) => timeAt(f));

  const unfreeze = freezeMap(map);
  try {
    // 1. Plan the camera for every frame, then download every map tile needed.
    onProgress?.(0, 'Planning the camera…');
    await sleep(0);
    const cams = planCameras({ map, replay, frames: frameTimes, W, H, opts, legendBounds });
    const src = tileSource(map);
    const urls = new Set();
    for (const c of cams) for (const t of tilesFor(c, src)) urls.add(t.url);
    const tiles = await preloadTiles([...urls], (d, n) => onProgress?.(0, `Downloading map… ${d} of ${n} tiles`), signal);
    if (signal?.aborted) return null;

    // 2. Draw each frame on a canvas of its own, then encode it
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const color = shown[0]?.style.color || '#0b5cab';
    const brand = opts.branding || {};
    const logo = await loadImage(brand.logo);

    const frame = async (f) => {
      const t = frameTimes[f];
      const cam = cams[f];
      replay.seek(t);
      drawTiles(ctx, cam, src);
      await drawOverlays(ctx, map, cam);
      drawTitleClock(ctx, { title: opts.title, time: formatDateTime(t), u });
      // Top right: logo / organisation name, with the north arrow underneath
      const brandH = drawBranding(ctx, logo, brand.name, u, { size: brand.videoSize, panel: brand.panel });
      if (brand.extras !== false) {
        drawNorthArrow(ctx, W - 40 * u, 16 * u + (brandH ? brandH + 12 * u : 0) + 22 * u, u);
        drawScaleBar(ctx, cam, u, 26 * u);
      }
      await drawLegend(ctx, legend, u, { bottom: 34 });
      drawAttribution(ctx, map, u, 6 * u);
      drawProgress(ctx, (t - min) / (max - min), color, u);
    };

    // Warm up the marker image cache so the first frames aren't slow
    await frame(0);
    await frame(total - 1);

    // 2a. Fast: encode each frame as soon as it's drawn
    const config = await h264Config(W, H, fps);
    if (config) {
      const t0 = performance.now();
      const blob = await encodeMp4({
        canvas, config, fps, total, draw: frame, signal,
        onFrame: (f) => {
          const done = (f + 1) / total;
          const secs = ((performance.now() - t0) / done) * (1 - done) / 1000;
          onProgress?.(done, `Making the video… ${Math.round(done * 100)}%${f > fps && secs >= 1 ? `, about ${formatDuration(secs * 1000 + 999)} left` : ''}`);
        },
      });
      if (!blob) return null;
      onProgress?.(1, 'Done');
      return { blob, ext: 'mp4', tilesOk: tiles.failed === 0, fast: true };
    }

    // 2b. Otherwise record in real time
    const support = recorderSupport();
    if (!support) throw new Error('This browser cannot record video. Please use a recent version of Chrome, Edge, Firefox or Safari.');
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const manual = typeof track.requestFrame === 'function';
    const liveStream = manual ? stream : canvas.captureStream(fps);
    const rec = new MediaRecorder(liveStream, { mimeType: support.mime, videoBitsPerSecond: W > 1500 ? 12e6 : 8e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start(1000);
    const t0 = performance.now();
    for (let f = 0; f < total; f++) {
      if (signal?.aborted) break;
      await frame(f);
      if (manual) track.requestFrame();
      onProgress?.(f / total, `Recording… ${Math.round((f / total) * 100)}%`);
      const wait = t0 + ((f + 1) * 1000) / fps - performance.now();
      if (wait > 0) await sleep(wait);
    }
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    liveStream.getTracks().forEach((t) => t.stop());
    if (signal?.aborted) return null;
    onProgress?.(1, 'Done');
    return { blob: new Blob(chunks, { type: support.mime.split(';')[0] }), ext: support.ext, tilesOk: tiles.failed === 0, fast: false };
  } finally {
    unfreeze();
  }
}

// =================================================================== PDF

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error(`Couldn't load ${src}`)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}

/** The PDF's built-in fonts only cover Western European characters. */
function pdfText(s) {
  return String(s ?? '')
    .replace(/[    ]/g, ' ')
    .replace(/[–—−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0a\x0d\x20-\xff]/g, '?');
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Stats along a dataset's route. */
function stats(ds, seq) {
  let dist = 0;
  for (let k = 1; k < seq.order.length; k++) {
    const a = ds.points[seq.order[k - 1]], b = ds.points[seq.order[k]];
    dist += distanceMetres([a.lat, a.lon], [b.lat, b.lon]);
  }
  const times = ds.points.map((p) => p.t).filter((t) => t !== null && t !== undefined);
  const start = times.length ? Math.min(...times) : null;
  const end = times.length ? Math.max(...times) : null;
  const dur = start !== null ? end - start : null;
  const speed = dur ? (dist / 1000) / (dur / 3600000) : null;
  return { dist, start, end, dur, speed, timed: times.length };
}

/**
 * Build and download a PDF report of the visible datasets.
 * opts: { title, preparedFor, notes, paper: 'a4'|'letter', view, tables, extraColumns }
 */
export async function buildPdf({ map, replay, datasets, sequenceOf, opts, onProgress }) {
  onProgress?.(0.05, 'Loading PDF tools…');
  await loadScript('vendor/jspdf/jspdf.umd.min.js');
  await loadScript('vendor/jspdf/jspdf.plugin.autotable.min.js');
  const { jsPDF } = window.jspdf;

  if (replay.active) replay.close();
  if (!datasets.length) throw new Error('Switch on at least one dataset to include in the report.');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: opts.paper || 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 14;
  const generated = formatDateTime(Date.now());
  const ink = [22, 32, 43], grey = [90, 104, 119], brand = [11, 92, 171];

  // ---- Map image sized to fill page 1 below the header
  onProgress?.(0.15, 'Drawing the map…');
  const branding = opts.branding || {};
  const logoSize = pdfLogoSize(branding); // mm, chosen with the size slider
  // A big logo pushes the map down rather than overlapping it
  const headerH = Math.max((opts.preparedFor ? 24 : 19) + (opts.filterText ? 5 : 0), logoSize ? logoSize.h + 6 : 0);
  const mapW = pageW - 2 * M;
  const mapH = pageH - M - headerH - 12;
  const pxW = 1400, pxH = Math.round(pxW * (mapH / mapW));
  const scale = 2;
  const unfreeze = freezeMap(map);
  let shot;
  try {
    const cam = opts.view === 'current' ? currentViewCamera(map, pxW, pxH, scale) : fitCamera(boundsOf(datasets), pxW, pxH, scale);
    const src = tileSource(map);
    const tiles = await preloadTiles(tilesFor(cam, src).map((t) => t.url), (d, n) => onProgress?.(0.15, `Downloading map… ${d} of ${n} tiles`));
    const c = document.createElement('canvas');
    c.width = pxW * scale; c.height = pxH * scale;
    const ctx = c.getContext('2d');
    drawTiles(ctx, cam, src);
    await drawOverlays(ctx, map, cam);
    await drawLegend(ctx, datasets, scale * 1.1, { bottom: 26 });
    if (opts.branding?.extras !== false) {
      drawNorthArrow(ctx, c.width - 34 * scale, 34 * scale, scale);
      drawScaleBar(ctx, cam, scale, 22 * scale);
    }
    drawAttribution(ctx, map, scale);
    shot = { url: c.toDataURL('image/jpeg', 0.9), tilesOk: tiles.failed === 0 };
  } finally {
    unfreeze();
  }

  // ---- Page 1: title + map
  onProgress?.(0.45, 'Laying out the report…');
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(pdfText(opts.title || 'Map report'), M, M + 5);
  // The organisation's logo, top right of the first page
  if (logoSize) {
    const { w: lw, h: lh } = logoSize;
    const top = lh < 15 ? M - 4 + (15 - lh) / 2 : M - 4;
    try { doc.addImage(branding.logo, 'PNG', pageW - M - lw, top, lw, lh, undefined, 'FAST'); } catch { /* an unreadable logo is left out */ }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...grey);
  let y = M + 11;
  if (opts.preparedFor) { doc.text(pdfText(`Prepared for: ${opts.preparedFor}`), M, y); y += 5; }
  const total = datasets.reduce((n, d) => n + d.points.length, 0);
  doc.text(pdfText(`Generated ${generated}  ·  ${datasets.length} dataset${datasets.length === 1 ? '' : 's'}, ${total.toLocaleString()} points`), M, y);
  if (opts.filterText) {
    // Make it obvious the report doesn't cover everything
    y += 5;
    doc.setTextColor(...brand);
    doc.text(pdfText(`Filtered to: ${opts.filterText}`), M, y);
    doc.setTextColor(...grey);
  }
  const mapY = M + headerH;
  doc.addImage(shot.url, 'JPEG', M, mapY, mapW, mapH, undefined, 'FAST');
  doc.setDrawColor(200, 208, 216);
  doc.setLineWidth(0.3);
  doc.rect(M, mapY, mapW, mapH);
  if (!shot.tilesOk) {
    doc.setFontSize(8);
    doc.text('Some of the map background could not be downloaded.', M, mapY + mapH + 4);
  }

  // ---- Page 2: summary
  doc.addPage();
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Summary', M, M + 5);
  const icons = await Promise.all(datasets.map((d) => markerPng(d.style, 64)));
  const seqs = datasets.map((d) => sequenceOf(d));
  const summaryRows = datasets.map((d, i) => {
    const s = stats(d, seqs[i]);
    return [
      pdfText(d.name),
      d.points.length.toLocaleString(),
      s.start !== null ? pdfText(formatDateTime(s.start)) : '-',
      s.end !== null ? pdfText(formatDateTime(s.end)) : '-',
      s.dur ? formatDuration(s.dur) : '-',
      d.style.showLine || s.timed ? formatDistance(s.dist) : '-',
      s.speed ? `${s.speed.toFixed(1)} km/h` : '-',
      eventCounts(opts.eventsOf?.(d) || []),
    ];
  });
  doc.autoTable({
    startY: M + 9,
    margin: { left: M, right: M },
    head: [['Dataset', 'Points', 'First date & time', 'Last date & time', 'Duration', 'Route distance', 'Average speed', 'Stops and problems']],
    body: summaryRows,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, textColor: ink },
    headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [244, 247, 250] },
    columnStyles: { 0: { cellWidth: 70, cellPadding: { left: 9, top: 2, bottom: 2, right: 2 } } },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const sz = 5;
        doc.addImage(icons[data.row.index], 'PNG', data.cell.x + 2, data.cell.y + data.cell.height / 2 - sz / 2, sz, sz);
      }
    },
  });
  y = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...grey);
  doc.text(pdfText(`All times are shown in ${displayTimeZone().replace(/_/g, ' ')} time. Route distance is measured in a straight line between consecutive points, in the order the points are joined on the map.`), M, y);
  y += 8;

  if (opts.notes && opts.notes.trim()) {
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Notes', M, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(pdfText(opts.notes.trim()), pageW - 2 * M);
    for (const line of lines) {
      if (y > pageH - 16) { doc.addPage(); y = M + 5; }
      doc.text(line, M, y);
      y += 5;
    }
  }

  // ---- Stops and problems, all datasets together
  const eventRowsAll = datasets.flatMap((d) => (opts.eventsOf?.(d) || []).map((r) => [
    pdfText(d.name), r.kind, pdfText(formatDateTime(r.from)), r.to != null ? pdfText(formatDateTime(r.to)) : '', r.dur != null ? formatDuration(r.dur) : '', pdfText(r.detail),
  ]));
  if (eventRowsAll.length) {
    if (y > pageH - 40) { doc.addPage(); y = M + 5; }
    doc.setTextColor(...ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Stops and problems', M, y + 2);
    doc.autoTable({
      startY: y + 5,
      margin: { left: M, right: M, top: M },
      head: [['Dataset', 'What', 'From', 'To', 'How long', 'Details']],
      body: eventRowsAll,
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: ink, overflow: 'linebreak' },
      headStyles: { fillColor: brand, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 247, 250] },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 32 } },
      showHead: 'everyPage',
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    y = doc.lastAutoTable.finalY + 5;
    doc.text('A possible GPS jump is a move faster than the limit set in the app, usually a bad GPS reading. A gap is a time when nothing was recorded while moving.', M, y);
    y += 8;
  }

  // ---- Point tables
  if (opts.tables) {
    for (let i = 0; i < datasets.length; i++) {
      onProgress?.(0.5 + (0.45 * i) / datasets.length, `Adding ${datasets[i].name}…`);
      await sleep(0); // keep the page responsive
      const d = datasets[i], seq = seqs[i];
      const indexes = [...seq.order, ...seq.untimed];
      const extras = opts.extraColumns ? [...new Set(d.points.flatMap((p) => Object.keys(p.props || {})))].slice(0, 5) : [];
      const body = indexes.map((pi, k) => {
        const p = d.points[pi];
        const inSeq = k < seq.order.length;
        const prev = inSeq && k > 0 ? d.points[seq.order[k - 1]] : null;
        return [
          inSeq ? String(k + 1) : '-',
          pdfText(p.label),
          p.t != null ? pdfText(formatDateTime(p.t)) : '',
          p.lat.toFixed(6),
          p.lon.toFixed(6),
          prev ? formatDistance(distanceMetres([prev.lat, prev.lon], [p.lat, p.lon])) : '',
          prev && prev.t != null && p.t != null ? formatDuration(p.t - prev.t) : '',
          ...extras.map((f) => pdfText(p.props?.[f] ?? '')),
        ];
      });
      doc.addPage();
      doc.addImage(icons[i], 'PNG', M, M, 6, 6);
      doc.setTextColor(...ink);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(pdfText(d.name), M + 8, M + 4.8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...grey);
      doc.text(pdfText(`${d.points.length.toLocaleString()} points, ${d.style.lineOrder === 'time' ? 'in date and time order' : 'in file order'}`), M + 8, M + 9.5);
      doc.autoTable({
        startY: M + 13,
        margin: { left: M, right: M, top: M },
        head: [['#', 'Name', 'Date & time', 'Latitude', 'Longitude', 'From previous', 'Time since previous', ...extras.map(pdfText)]],
        body,
        styles: { font: 'helvetica', fontSize: extras.length > 2 ? 7.5 : 8.5, cellPadding: 1.6, textColor: ink, overflow: 'linebreak' },
        headStyles: { fillColor: hexToRgb(d.style.color), textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [244, 247, 250] },
        columnStyles: { 0: { cellWidth: 10 }, 3: { font: 'courier' }, 4: { font: 'courier' } },
        showHead: 'everyPage',
      });
    }
  }

  // ---- Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(pdfText([branding.name, opts.title || 'Map report'].filter(Boolean).join('  ·  ')), M, pageH - 6);
    doc.text(`Page ${i} of ${pages}`, pageW - M, pageH - 6, { align: 'right' });
  }

  onProgress?.(1, 'Done');
  return doc.output('blob');
}

/** "3 stops · 1 gap · 2 jumps" for the summary table. */
function eventCounts(rows) {
  const n = (kind) => rows.filter((r) => r.kind === kind).length;
  const parts = [];
  const s = n('Stop'), g = n('Gap in recording'), j = n('Possible GPS jump');
  if (s) parts.push(`${s} stop${s === 1 ? '' : 's'}`);
  if (g) parts.push(`${g} gap${g === 1 ? '' : 's'}`);
  if (j) parts.push(`${j} jump${j === 1 ? '' : 's'}`);
  return parts.join(', ') || '-';
}

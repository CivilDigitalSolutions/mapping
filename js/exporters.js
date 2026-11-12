/* global L */
// Video (replay) and PDF report exports. Everything runs in the browser —
// no data is sent anywhere.

import { withMapSize, drawBasemap, drawOverlays, drawLegend, drawTitleClock, drawProgress, drawAttribution, markerPng } from './capture.js';
import { formatDateTime, formatDuration, formatDistance } from './dates.js';
import { distanceMetres } from './coords.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boundsOf(datasets) {
  const b = L.latLngBounds([]);
  datasets.forEach((d) => d.points.forEach((p) => b.extend([p.lat, p.lon])));
  return b;
}

// =================================================================== video

export function videoSupport() {
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
  return hit ? { mime: hit[0], ext: hit[1] } : null;
}

/**
 * Record the route replay to a video file.
 * opts: { title, seconds, size: '720'|'1080', view: 'fit'|'current', trail }
 * Returns { blob, ext, tilesOk } or null if cancelled.
 */
export async function recordVideo({ map, replay, datasets = [], opts, onProgress, signal }) {
  const support = videoSupport();
  if (!support) throw new Error('This browser cannot record video. Please use a recent version of Chrome, Edge, Firefox or Safari.');
  if (!replay.active && !replay.open()) throw new Error('None of the visible datasets have dates and times to replay.');
  replay.pause();
  if (opts.trail) replay.setTrail(opts.trail);
  const { min, max } = replay.range;
  if (!(max > min)) throw new Error('The replay needs at least two different dates or times.');
  const shown = replay.datasets;
  // Legend and framing cover every visible dataset, including ones without dates
  const legend = datasets.length ? datasets : shown;

  const [W, H] = opts.size === '1080' ? [1920, 1080] : [1280, 720];
  const u = W / 1280;

  return withMapSize(map, W, H, { view: opts.view, bounds: boundsOf(legend) }, async () => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const base = document.createElement('canvas');
    base.width = W; base.height = H;
    const tilesOk = drawBasemap(base.getContext('2d'), map, 1);

    const fps = 30;
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const manual = typeof track.requestFrame === 'function';
    const liveStream = manual ? stream : canvas.captureStream(fps);
    const rec = new MediaRecorder(liveStream, { mimeType: support.mime, videoBitsPerSecond: W > 1500 ? 12e6 : 8e6 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });

    const N = Math.max(2, Math.round(opts.seconds * fps));
    const lead = fps;        // 1 s still at the start
    const hold = fps * 2;    // 2 s still at the end
    const total = lead + N + hold;
    const color = shown[0]?.style.color || '#0b5cab';

    const frame = async (f) => {
      const k = Math.min(Math.max(f - lead, 0), N - 1);
      const t = min + ((max - min) * k) / (N - 1);
      replay.seek(t);
      ctx.drawImage(base, 0, 0);
      await drawOverlays(ctx, map, 1);
      drawTitleClock(ctx, { title: opts.title, time: formatDateTime(t), u });
      await drawLegend(ctx, legend, u, { bottom: 34 });
      drawAttribution(ctx, map, u, 6 * u);
      drawProgress(ctx, k / (N - 1), color, u);
    };

    // Warm up the image cache so the first frames aren't slow
    await frame(0);
    await frame(lead + N - 1);

    rec.start(1000);
    const t0 = performance.now();
    for (let f = 0; f < total; f++) {
      if (signal?.aborted) break;
      await frame(f);
      if (manual) track.requestFrame();
      onProgress?.(f / total);
      const wait = t0 + ((f + 1) * 1000) / fps - performance.now();
      if (wait > 0) await sleep(wait);
    }
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    liveStream.getTracks().forEach((t) => t.stop());
    if (signal?.aborted) return null;
    onProgress?.(1);
    return { blob: new Blob(chunks, { type: support.mime.split(';')[0] }), ext: support.ext, tilesOk };
  });
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
  const headerH = opts.preparedFor ? 24 : 19;
  const mapW = pageW - 2 * M;
  const mapH = pageH - M - headerH - 12;
  const pxW = 1400, pxH = Math.round(pxW * (mapH / mapW));
  const scale = 2;
  const shot = await withMapSize(map, pxW, pxH, { view: opts.view, bounds: boundsOf(datasets) }, async () => {
    const c = document.createElement('canvas');
    c.width = pxW * scale; c.height = pxH * scale;
    const ctx = c.getContext('2d');
    const tilesOk = drawBasemap(ctx, map, scale);
    await drawOverlays(ctx, map, scale);
    await drawLegend(ctx, datasets, scale * 1.1, { bottom: 26 });
    drawAttribution(ctx, map, scale);
    return { url: c.toDataURL('image/jpeg', 0.9), tilesOk };
  });

  // ---- Page 1: title + map
  onProgress?.(0.45, 'Laying out the report…');
  doc.setTextColor(...ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(pdfText(opts.title || 'Map report'), M, M + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...grey);
  let y = M + 11;
  if (opts.preparedFor) { doc.text(pdfText(`Prepared for: ${opts.preparedFor}`), M, y); y += 5; }
  const total = datasets.reduce((n, d) => n + d.points.length, 0);
  doc.text(pdfText(`Generated ${generated}  ·  ${datasets.length} dataset${datasets.length === 1 ? '' : 's'}, ${total.toLocaleString()} points`), M, y);
  const mapY = M + headerH;
  doc.addImage(shot.url, 'JPEG', M, mapY, mapW, mapH, undefined, 'FAST');
  doc.setDrawColor(200, 208, 216);
  doc.setLineWidth(0.3);
  doc.rect(M, mapY, mapW, mapH);
  if (!shot.tilesOk) {
    doc.setFontSize(8);
    doc.text('Map background could not be included (tile server did not allow it).', M, mapY + mapH + 4);
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
    ];
  });
  doc.autoTable({
    startY: M + 9,
    margin: { left: M, right: M },
    head: [['Dataset', 'Points', 'First date & time', 'Last date & time', 'Duration', 'Route distance', 'Average speed']],
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
  doc.text('Route distance is measured in a straight line between consecutive points, in the order the points are joined on the map.', M, y);
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
    doc.text(pdfText(opts.title || 'Map report'), M, pageH - 6);
    doc.text(`Page ${i} of ${pages}`, pageW - M, pageH - 6, { align: 'right' });
  }

  onProgress?.(1, 'Done');
  return doc.output('blob');
}

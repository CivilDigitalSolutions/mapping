// "Your branding" in the Export dialog: the organisation's logo and name for
// PDF reports and videos, how big the logo appears on each, whether it sits on
// a white panel in videos, and the scale bar / north arrow. Saved with the
// preferences in this browser.

import { prefs, savePrefs } from './state.js';
import { drawBranding, loadImage } from './capture.js';
import { $, announce, esc, toast } from './util.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_W = 1600, MAX_H = 800; // stored at most this size: sharp even when shown large

// Logo size on PDFs at 100%: fits within 15 mm tall and 60 mm wide
const PDF_BASE_H = 15, PDF_BASE_W = 60;
export const SIZE_MIN = 0.5, SIZE_MAX = 3;

/** How big the logo is on the PDF, in mm: { w, h }, or null without a logo. */
export function pdfLogoSize(b) {
  if (!b.logo || !b.logoW || !b.logoH) return null;
  const k = clampSize(b.pdfSize);
  const s = Math.min((PDF_BASE_H * k) / b.logoH, (PDF_BASE_W * k) / b.logoW);
  return { w: b.logoW * s, h: b.logoH * s };
}

const clampSize = (v) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Number(v) || 1));

// ------------------------------------------------------------------ reading and trimming

/**
 * Crop away empty margins: transparent pixels, and plain background matching
 * the corners (e.g. a white box around the artwork). Keeps a hair of space.
 * Returns the cropped canvas (or the original if there's nothing to crop).
 */
export function trimCanvas(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = c;
  const data = ctx.getImageData(0, 0, w, h).data;
  const at = (x, y) => (y * w + x) * 4;
  // Background colour: taken from the corners if they agree (e.g. all white)
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].map((i) => [data[i], data[i + 1], data[i + 2], data[i + 3]]);
  const same = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30;
  const bg = corners.every((k) => k[3] > 200 && same(k, corners[0])) ? corners[0] : null;
  const empty = (i) => data[i + 3] < 16 || (bg && Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 30);
  let top = h, left = w, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (empty(at(x, y))) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return c; // nothing but background: leave it alone
  const margin = Math.round(Math.max(right - left, bottom - top) * 0.02);
  left = Math.max(0, left - margin); top = Math.max(0, top - margin);
  right = Math.min(w - 1, right + margin); bottom = Math.min(h - 1, bottom + margin);
  const cw = right - left + 1, ch = bottom - top + 1;
  if (cw === w && ch === h) return c;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(c, left, top, cw, ch, 0, 0, cw, ch);
  return out;
}

/** Draw an image onto a canvas no bigger than MAX_W × MAX_H (vector logos are drawn at full size). */
function toCanvas(img, isVector) {
  let w = img.naturalWidth || 400, h = img.naturalHeight || 200;
  const fit = Math.min(MAX_W / w, MAX_H / h);
  const s = isVector ? fit : Math.min(1, fit); // never enlarge a bitmap: that only blurs it
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/**
 * Read an image file into a trimmed PNG data: URL (at most 1600 × 800).
 * SVG and WebP logos are converted too, so the PDF tools can use them.
 * Resolves to { url, w, h }; rejects with a readable message.
 */
export function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file chosen.')); return; }
    if (file.size > MAX_FILE_BYTES) { reject(new Error('That image is over 5 MB. Please choose a smaller logo.')); return; }
    if (file.type && !/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { reject(new Error('Please choose a PNG, JPEG, SVG or WebP image.')); return; }
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      try {
        const c = trimCanvas(toCanvas(img, /svg/.test(file.type) || /\.svg$/i.test(file.name)));
        resolve({ url: c.toDataURL('image/png'), w: c.width, h: c.height });
      } catch {
        reject(new Error("That image couldn't be used."));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("That file couldn't be read as an image.")); };
    img.src = src;
  });
}

/** Logos saved before trimming existed get trimmed once. */
async function trimSavedLogo() {
  const b = prefs.branding;
  if (!b.logo || b.trimmed) return;
  const img = await loadImage(b.logo);
  if (!img) return;
  const c = trimCanvas(toCanvas(img, false));
  Object.assign(b, { logo: c.toDataURL('image/png'), logoW: c.width, logoH: c.height, trimmed: true });
  savePrefs();
  showPreview();
}

// ------------------------------------------------------------------ previews

let logoImg = null; // the current logo, loaded once for the previews

/** Mock-ups of the PDF header and the video's top-right corner, at the chosen sizes. */
async function drawPreviews() {
  const b = prefs.branding;
  if (b.logo && (!logoImg || logoImg.src !== b.logo)) logoImg = await loadImage(b.logo);
  if (!b.logo) logoImg = null;

  // PDF: the top of an A4 landscape page (297 mm across)
  const pdf = $('#brand-pdf-preview');
  const pw = pdf.width, k = pw / 297; // px per mm
  let ctx = pdf.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pdf.width, pdf.height);
  const size = pdfLogoSize(b);
  const M = 14 * k;
  ctx.fillStyle = '#16202b';
  ctx.font = `700 ${6.3 * k}px system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText($('#ex-title')?.value.trim() || 'Map report', M, M + 5 * k);
  ctx.fillStyle = '#5a6877';
  ctx.font = `${3.5 * k}px system-ui, sans-serif`;
  ctx.fillText('Generated …', M, M + 11 * k);
  const headerMm = Math.max(19, size ? size.h + 6 : 0);
  ctx.fillStyle = '#e8edf2';
  ctx.fillRect(M, M + headerMm * k, pw - 2 * M, pdf.height);
  if (size && logoImg) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logoImg, pw - M - size.w * k, M - 4 * k, size.w * k, size.h * k);
  }
  $('#brand-pdf-size-out').textContent = size ? `${Math.round(size.w)} × ${Math.round(size.h)} mm` : '';

  // Video: the top-right corner of a 1280 × 720 frame
  const vid = $('#brand-video-preview');
  ctx = vid.getContext('2d');
  const u = vid.width / 640; // the preview shows the right half of the frame
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#dfe7da';
  ctx.fillRect(0, 0, vid.width, vid.height);
  ctx.strokeStyle = '#c8d3c2';
  ctx.lineWidth = 1;
  for (let x = 0; x < vid.width; x += 40 * u) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, vid.height); ctx.stroke(); }
  for (let y = 0; y < vid.height; y += 40 * u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vid.width, y); ctx.stroke(); }
  drawBranding(ctx, logoImg, b.name, u, { size: clampSize(b.videoSize), panel: b.panel !== false });
  const vh = logoImg ? Math.round(Math.min(44 * clampSize(b.videoSize), (200 * clampSize(b.videoSize) * logoImg.naturalHeight) / logoImg.naturalWidth)) : 0;
  $('#brand-video-size-out').textContent = logoImg ? `${vh} px tall in HD` : '';
}

function showPreview() {
  const b = prefs.branding;
  $('#brand-preview').innerHTML = b.logo
    ? `<img src="${esc(b.logo)}" alt="Your logo${b.name ? `, ${esc(b.name)}` : ''}">`
    : '<span class="muted">No logo</span>';
  $('#brand-remove').hidden = !b.logo;
  $('#brand-choose').textContent = b.logo ? 'Change logo…' : 'Choose logo…';
  $('#brand-sizing').hidden = !b.logo && !b.name;
  drawPreviews();
}

/** Fill the branding section from the saved preferences. Call when the Export dialog opens. */
export function showBranding() {
  const b = prefs.branding;
  $('#brand-name').value = b.name || '';
  $('#brand-extras').checked = b.extras !== false;
  $('#brand-panel').checked = b.panel !== false;
  $('#brand-pdf-size').value = Math.round(clampSize(b.pdfSize) * 100);
  $('#brand-video-size').value = Math.round(clampSize(b.videoSize) * 100);
  updateSliderLabels();
  showPreview();
  trimSavedLogo();
}

function updateSliderLabels() {
  $('#brand-pdf-size-pct').textContent = `${$('#brand-pdf-size').value}%`;
  $('#brand-video-size-pct').textContent = `${$('#brand-video-size').value}%`;
}

/** What the exporters need. */
export function brandingForExport() {
  const b = prefs.branding;
  return { ...b, pdfSize: clampSize(b.pdfSize), videoSize: clampSize(b.videoSize), panel: b.panel !== false };
}

export function initBrandingUi() {
  $('#brand-choose').addEventListener('click', () => { $('#brand-file').value = ''; $('#brand-file').click(); });
  $('#brand-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const logo = await readLogo(file);
      Object.assign(prefs.branding, { logo: logo.url, logoW: logo.w, logoH: logo.h, trimmed: true });
      savePrefs();
      showPreview();
      announce('Logo added. Empty space around it was trimmed. Use the size sliders to fine-tune it.');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#brand-remove').addEventListener('click', () => {
    Object.assign(prefs.branding, { logo: '', logoW: 0, logoH: 0 });
    savePrefs();
    showPreview();
    announce('Logo removed');
    $('#brand-choose').focus();
  });
  $('#brand-name').addEventListener('input', (e) => { prefs.branding.name = e.target.value.trim(); savePrefs(); showPreview(); });
  $('#brand-extras').addEventListener('change', (e) => { prefs.branding.extras = e.target.checked; savePrefs(); });
  $('#brand-panel').addEventListener('change', (e) => { prefs.branding.panel = e.target.checked; savePrefs(); drawPreviews(); });
  for (const [id, key] of [['#brand-pdf-size', 'pdfSize'], ['#brand-video-size', 'videoSize']]) {
    $(id).addEventListener('input', (e) => {
      prefs.branding[key] = clampSize(Number(e.target.value) / 100);
      updateSliderLabels();
      drawPreviews();
    });
    $(id).addEventListener('change', savePrefs);
  }
  $('#brand-reset-size').addEventListener('click', () => {
    Object.assign(prefs.branding, { pdfSize: 1, videoSize: 1 });
    savePrefs();
    showBranding();
    announce('Logo sizes reset to 100%');
  });
  $('#ex-title').addEventListener('input', () => drawPreviews());
}

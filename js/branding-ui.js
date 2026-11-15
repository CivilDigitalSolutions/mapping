// "Your branding" in the Export dialog: the organisation's logo and name for
// PDF reports and videos, and whether to add a scale bar and north arrow.
// Saved with the preferences in this browser.

import { prefs, savePrefs } from './state.js';
import { $, announce, esc, toast } from './util.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_W = 800, MAX_H = 400; // logos are stored at most this size

/**
 * Read an image file and turn it into a PNG data: URL no bigger than 800 × 400.
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
      // SVGs without a size report 0 (or a default); give them a sensible one
      let w = img.naturalWidth || 400, h = img.naturalHeight || 200;
      const s = Math.min(1, MAX_W / w, MAX_H / h);
      w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try {
        resolve({ url: c.toDataURL('image/png'), w, h });
      } catch {
        reject(new Error("That image couldn't be used."));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("That file couldn't be read as an image.")); };
    img.src = src;
  });
}

function showPreview() {
  const b = prefs.branding;
  $('#brand-preview').innerHTML = b.logo
    ? `<img src="${esc(b.logo)}" alt="Your logo${b.name ? `, ${esc(b.name)}` : ''}">`
    : '<span class="muted">No logo</span>';
  $('#brand-remove').hidden = !b.logo;
  $('#brand-choose').textContent = b.logo ? 'Change logo…' : 'Choose logo…';
}

/** Fill the branding section from the saved preferences. Call when the Export dialog opens. */
export function showBranding() {
  $('#brand-name').value = prefs.branding.name || '';
  $('#brand-extras').checked = prefs.branding.extras !== false;
  showPreview();
}

/** What the exporters need. */
export function brandingForExport() {
  return { ...prefs.branding };
}

export function initBrandingUi() {
  $('#brand-choose').addEventListener('click', () => { $('#brand-file').value = ''; $('#brand-file').click(); });
  $('#brand-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const logo = await readLogo(file);
      Object.assign(prefs.branding, { logo: logo.url, logoW: logo.w, logoH: logo.h });
      savePrefs();
      showPreview();
      announce('Logo added. It will appear on PDF reports and videos.');
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
  $('#brand-name').addEventListener('input', (e) => { prefs.branding.name = e.target.value.trim(); savePrefs(); });
  $('#brand-extras').addEventListener('change', (e) => { prefs.branding.extras = e.target.checked; savePrefs(); });
}

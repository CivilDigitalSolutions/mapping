// Small helpers shared by every part of the app: element lookup, escaping,
// screen-reader announcements, the toast message, file downloads and choice dialogs.

export const $ = (sel, root = document) => root.querySelector(sel);

export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const uid = () => Math.random().toString(36).slice(2, 10);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function announce(msg) {
  const live = $('#live');
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 50);
}

export let toastTimer;

/**
 * Show a short message at the bottom of the screen.
 * action: { label, onClick } adds a button (e.g. Undo). duration in ms (0 = stay until closed).
 */
export function toast(msg, kind = 'info', { action = null, duration = 5000 } = {}) {
  const t = $('#toast');
  $('#toast-msg').textContent = msg;
  const btn = $('#toast-action');
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { t.hidden = true; action.onClick(); };
  }
  t.dataset.kind = kind;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (duration) toastTimer = setTimeout(() => { t.hidden = true; }, duration);
  return btn;
}

export function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * A value made safe for a CSV cell. Spreadsheets run text starting with
 * = + - @ (or a tab / return) as a formula, so such text gets a leading
 * apostrophe. Plain numbers like -0.1278 are left alone.
 */
export function csvCell(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? `'${s}` : s;
}

export function safeFilename(s) { return String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'dataset'; }

/**
 * Ask the user to choose. buttons: [{ value, label, kind }] where kind is
 * 'primary' | 'danger' | undefined. Resolves to the chosen value ('' if dismissed).
 */
export function choiceDialog(title, message, buttons) {
  const dlg = $('#dlg-confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-msg').textContent = message;
  $('#confirm-buttons').innerHTML = buttons.map((b, i) =>
    `<button type="submit" class="btn${b.kind ? ` btn-${b.kind}` : ''}" value="${esc(b.value)}"${i === 0 ? ' autofocus' : ''}>${esc(b.label)}</button>`).join('');
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
  });
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  const m = Math.round(s / 60); if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h} hours ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The "Keep your work safe" box under the datasets. */
export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** On phones the Datasets panel slides over the map; close it so the map can be seen. */
export function closePanelOnMobile() {
  const el = $('#panel');
  if (matchMedia('(max-width: 760px)').matches && el.classList.contains('open')) {
    el.classList.remove('open');
    $('#btn-panel').setAttribute('aria-expanded', 'false');
  }
}

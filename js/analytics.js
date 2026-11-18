// Visitor counting with GoatCounter (https://www.goatcounter.com).
//
// Privacy: GoatCounter uses no cookies and doesn't identify people. Only page
// visits and the names of a few actions (e.g. "export-pdf") are counted.
// No coordinates, files or other data people load are ever sent, and no
// GoatCounter script runs in the app: counts are sent as image requests.
//
// Turn it on by setting GOATCOUNTER_CODE in js/config.js. Nothing is counted
// while it's empty, or when the app is running on this computer (localhost).

import { GOATCOUNTER_CODE } from './config.js';

function enabled() {
  return Boolean(GOATCOUNTER_CODE) &&
    location.protocol === 'https:' &&
    !/^(localhost|127\.|\[::1\])/.test(location.hostname);
}

/**
 * Send one count as a plain image request. No outside script is loaded into
 * the app, so nothing from another server ever runs alongside people's data.
 */
function send(params) {
  const q = new URLSearchParams({ ...params, rnd: Math.random().toString(36).slice(2, 8) });
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.src = `https://${GOATCOUNTER_CODE}.goatcounter.com/count?${q}`;
}

/** Count this visit: the page's path, its title, the screen width and where the visitor came from. */
export function initAnalytics() {
  if (!enabled()) return;
  const params = { p: location.pathname, t: document.title, s: String(screen.width || '') };
  // Only the site that linked here, never a full address (which could hold someone's search)
  try { if (document.referrer) params.r = new URL(document.referrer).origin; } catch { /* no referrer */ }
  send(params);
}

/** Count that a feature was used. `name` must never contain user data. */
export function trackEvent(name) {
  if (!enabled()) return;
  try {
    send({ p: name, t: name, e: 'true' });
  } catch {
    /* counting is best-effort */
  }
}

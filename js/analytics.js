// Visitor counting with GoatCounter (https://www.goatcounter.com).
//
// Privacy: GoatCounter uses no cookies and doesn't identify people. Only page
// visits and the names of a few actions (e.g. "export-pdf") are counted.
// No coordinates, files or other data people load are ever sent.
//
// Turn it on by setting GOATCOUNTER_CODE in js/config.js. Nothing is counted
// while it's empty, or when the app is running on this computer (localhost).

import { GOATCOUNTER_CODE } from './config.js';

function enabled() {
  return Boolean(GOATCOUNTER_CODE) &&
    location.protocol === 'https:' &&
    !/^(localhost|127\.|\[::1\])/.test(location.hostname);
}

export function initAnalytics() {
  if (!enabled()) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  document.head.appendChild(s);
}

/** Count that a feature was used. `name` must never contain user data. */
export function trackEvent(name) {
  if (!enabled()) return;
  try {
    window.goatcounter?.count?.({ path: name, title: name, event: true });
  } catch {
    /* counting is best-effort */
  }
}

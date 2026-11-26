// Service worker: makes the app installable and usable offline.
// - App files are pre-cached (bump VERSION whenever you change them).
// - Map tiles are cached as you browse (newest 3000 kept), so areas you've viewed still show offline.
const VERSION = 'v21';
const APP_CACHE = `app-${VERSION}`;
const TILE_CACHE = 'tiles-v1';
const MAX_TILES = 3000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/analysis.js',
  'js/analytics.js',
  'js/app.js',
  'js/branding-ui.js',
  'js/cellsites-ui.js',
  'js/cellsites.js',
  'js/capture.js',
  'js/colour.js',
  'js/config.js',
  'js/coords.js',
  'js/dates.js',
  'js/export-ui.js',
  'js/exporters.js',
  'js/filter-ui.js',
  'js/filters.js',
  'js/icons.js',
  'js/import-flow.js',
  'js/importers.js',
  'js/interactive.js',
  'js/mapview.js',
  'js/nearby-ui.js',
  'js/nearby.js',
  'js/panel.js',
  'js/pointlayer.js',
  'js/project-ui.js',
  'js/project.js',
  'js/replay.js',
  'js/samples.js',
  'js/scalebar.js',
  'js/sectorlayer.js',
  'js/settings.js',
  'js/state.js',
  'js/store.js',
  'js/style-controls.js',
  'js/table.js',
  'js/util.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/papaparse.min.js',
  'vendor/jspdf/jspdf.umd.min.js',
  'vendor/jspdf/jspdf.plugin.autotable.min.js',
  'vendor/mp4-muxer/mp4-muxer.mjs',
  'viewer/viewer.js',
  'viewer/viewer.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

const TILE_HOSTS = ['tile.openstreetmap.org', 'tile.opentopomap.org', 'server.arcgisonline.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    event.respondWith(tile(req));
    return;
  }
  if (url.origin === self.location.origin) {
    // Network first for the page itself so updates show up; cache first for everything else.
    if (req.mode === 'navigate') {
      // Only a good copy of the app's own page replaces the saved one (never a 404 or an error page)
      const isAppPage = new URL('./', self.location).pathname === url.pathname || url.pathname.endsWith('/index.html');
      event.respondWith(fetch(req).then((res) => {
        if (res.ok && isAppPage) {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put('./', copy));
        }
        return res;
      }).catch(() => caches.match('./')));
      return;
    }
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

async function tile(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit; // cache first: kinder to the free tile servers, and works offline
  const network = fetch(req).then(async (res) => {
    // Opaque (no-CORS) responses aren't kept: browsers count each one as several MB of storage,
    // which could crowd out people's saved data
    if (res.ok) {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  }).catch(() => null);
  return (await network) || new Response('', { status: 504 });
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  trimming = false;
}

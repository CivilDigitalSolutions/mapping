// Checks on how the app's files fit together.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'js');
const jsFiles = fs.readdirSync(JS).filter((f) => f.endsWith('.js')).sort();

function importsOf(file) {
  const src = fs.readFileSync(path.join(JS, file), 'utf8');
  return [...src.matchAll(/^import (?:[^'"]+ from )?'\.\/([\w-]+\.js)';/gm)].map((m) => m[1]);
}

test('every module in js/ is loaded, starting from app.js', () => {
  // A module that only sets up buttons is easy to forget, because nothing calls it by name.
  const seen = new Set();
  const visit = (f) => { if (seen.has(f)) return; seen.add(f); importsOf(f).forEach(visit); };
  visit('app.js');
  const unused = jsFiles.filter((f) => !seen.has(f));
  assert.deepEqual(unused, [], `not loaded by the app: ${unused.join(', ')}`);
});

test('the modules have no circular imports', () => {
  const state = {};
  const visit = (f, trail) => {
    if (state[f] === 'active') assert.fail(`circular import: ${[...trail, f].join(' -> ')}`);
    if (state[f] === 'done') return;
    state[f] = 'active';
    importsOf(f).forEach((d) => visit(d, [...trail, f]));
    state[f] = 'done';
  };
  jsFiles.forEach((f) => visit(f, []));
});

test('the service worker keeps every app file for offline use', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]));
  const missing = [
    ...jsFiles.map((f) => `js/${f}`),
    'index.html', 'css/app.css', 'manifest.webmanifest',
    'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/papaparse.min.js',
    'vendor/jspdf/jspdf.umd.min.js', 'vendor/jspdf/jspdf.plugin.autotable.min.js',
    'vendor/mp4-muxer/mp4-muxer.mjs', 'viewer/viewer.js', 'viewer/viewer.css',
  ].filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `add these to APP_FILES in sw.js: ${missing.join(', ')}`);
  for (const f of listed) {
    if (f === './') continue;
    assert.ok(fs.existsSync(path.join(ROOT, f)), `sw.js lists ${f}, which doesn't exist`);
  }
});

test('the deployed site includes every file the service worker pre-caches', () => {
  // If one is missing from the site, the browser refuses the new service worker and
  // people who have used the app before keep being served their old cached copy.
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]).filter((f) => f !== './');
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  const cp = wf.match(/^\s*cp -r (.+) _site\/\s*$/m);
  assert.ok(cp, 'could not find the "cp -r ... _site/" line in pages.yml');
  const deployed = cp[1].trim().split(/\s+/);
  const missing = listed.filter((f) => !deployed.some((d) => f === d || f.startsWith(`${d}/`)));
  assert.deepEqual(missing, [], `add these to the cp line in .github/workflows/pages.yml: ${missing.join(', ')}`);
});

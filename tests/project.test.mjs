// Run with: npm test
// Project files come from outside the app, so everything in them is checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanStyle, readProject } from '../js/project.js';

const base = { shape: 'circle', color: '#0072B2', size: 26, showLine: true, lineOrder: 'time', lineStyle: 'solid', showArrows: true, numbered: false, colourBy: 'none', speedUnit: 'mph' };
const defaultStyle = () => ({ ...base });

test('styles: only values the app understands get through', () => {
  const st = cleanStyle({
    color: '#000"><img src=x onerror=alert(1)>', size: '26" onmouseover="x', shape: 'nope',
    lineStyle: 'zigzag', lineOrder: 'random', colourBy: '<b>', speedUnit: 'warp', showLine: 'yes', extra: 'ignored',
  }, base);
  assert.deepEqual(st, base);
  assert.deepEqual(cleanStyle({ color: '#ABCDEF', size: 90, shape: 'star', colourBy: 'col:Speed (mph)' }, base),
    { ...base, color: '#ABCDEF', size: 48, shape: 'star', colourBy: 'col:Speed (mph)' });
  assert.deepEqual(cleanStyle(null, base), base);
});

test('a hostile project file is cleaned, not trusted', () => {
  const { datasets, dropped } = readProject({
    format: 'data-mapper-project', version: 1,
    datasets: [{
      name: 'X', style: { color: 'red;background:url(x)' }, timeZone: 'Not/AZone', source: { evil: true },
      skipped: [{ row: '3', reason: { toString: 1 } }],
      points: [
        { lat: 51.5, lon: -0.1, t: 1e20, label: 7, props: { note: { nested: true }, ok: 'fine', n: 5, ['__proto__']: 'x' }, src: 'abc' },
        { lat: 95, lon: 0 },
        { lat: '51.6', lon: '-0.2', t: '1710403200000' },
      ],
    }],
  }, defaultStyle);
  const d = datasets[0];
  assert.equal(dropped, 1);
  assert.equal(d.style.color, '#0072B2');
  assert.equal(d.timeZone, undefined, 'unknown time zone dropped');
  assert.equal(d.source, 'Project file');
  assert.deepEqual(d.skipped, [{ row: 3, reason: '' }]);
  assert.equal(d.points[0].t, null, 'impossible time dropped');
  assert.equal(d.points[0].label, '7');
  assert.deepEqual({ ...d.points[0].props }, { ok: 'fine', n: '5', ['__proto__']: 'x' });
  assert.equal(Object.getPrototypeOf(d.points[0].props), Object.prototype, 'no prototype tampering');
  assert.equal(d.points[0].src, undefined);
  assert.equal(d.points[1].t, 1710403200000);
});

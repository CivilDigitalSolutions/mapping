// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metresPerPixel, roundDown, metricScale, imperialScale } from '../js/scalebar.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('metres per pixel: equator vs London, and halving with each zoom level', () => {
  near(metresPerPixel(0, 0), 156543.03, 0.01);
  near(metresPerPixel(51.5, 15), 2.98, 0.01);
  near(metresPerPixel(51.5, 16), metresPerPixel(51.5, 15) / 2, 1e-9);
});

test('round numbers', () => {
  assert.equal(roundDown(0.73), 0.5);
  assert.equal(roundDown(1), 1);
  assert.equal(roundDown(1.99), 1);
  assert.equal(roundDown(3.4), 2);
  assert.equal(roundDown(87), 50);
  assert.equal(roundDown(4999), 2000);
  assert.equal(roundDown(0), 0);
});

test('metric bar labels', () => {
  assert.deepEqual(metricScale(730), { metres: 500, label: '500 m' });
  assert.deepEqual(metricScale(2600), { metres: 2000, label: '2 km' });
  assert.deepEqual(metricScale(60000), { metres: 50000, label: '50 km' });
});

test('imperial bar labels: feet under a mile, miles above', () => {
  assert.equal(imperialScale(700).label, '2000 ft');
  near(imperialScale(700).metres, 609.6, 0.01);
  assert.equal(imperialScale(5000).label, '2 mi');
  near(imperialScale(5000).metres, 3218.688, 0.001);
});

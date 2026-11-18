// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unwrapRoute } from '../js/coords.js';
import { csvCell } from '../js/util.js';

test('routes cross the date line the short way', () => {
  assert.deepEqual(unwrapRoute([[-17, 179.9], [-17, -179.9], [-17, -179.5]]), [[-17, 179.9], [-17, 180.1], [-17, 180.5]]);
  assert.deepEqual(unwrapRoute([[0, 10], [0, 20]]), [[0, 10], [0, 20]], 'ordinary routes are untouched');
});

test('CSV cells that a spreadsheet would run as formulas are neutralised', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `'=HYPERLINK("http://x","y")`);
  assert.equal(csvCell('+cmd|calc'), "'+cmd|calc");
  assert.equal(csvCell('@SUM(1)'), "'@SUM(1)");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('-0.1278'), '-0.1278', 'negative numbers stay numbers');
  assert.equal(csvCell(-0.1278), -0.1278);
  assert.equal(csvCell('Kerb damage'), 'Kerb damage');
});

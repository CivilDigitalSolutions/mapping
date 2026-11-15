// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMask, isActive, localToMs, describeFilter, EMPTY_FILTER } from '../js/filters.js';

const T = (h, m, day = 14) => Date.UTC(2024, 2, day, h, m); // March: London is on GMT, same as UTC
const ds = {
  points: [
    { lat: 51.5, lon: -0.1, t: T(7, 0), label: 'A', props: { Vehicle: 'VAN-01', Load: '120' } },
    { lat: 51.51, lon: -0.1, t: T(9, 30), label: 'B', props: { Vehicle: 'VAN-02', Load: '80' } },
    { lat: 51.52, lon: -0.1, t: T(12, 0), label: 'C', props: { Vehicle: 'van-02', Load: '1,200' } },
    { lat: 51.53, lon: -0.1, t: T(23, 0), label: 'D', props: { Vehicle: 'VAN-03', Load: '' } },
    { lat: 51.54, lon: -0.1, t: null, label: 'E', props: { Vehicle: 'VAN-01', Load: '5' } },
  ],
};
const f = (over) => ({ ...EMPTY_FILTER, ...over });
const shown = (mask) => (mask ? [...mask].map((v, i) => (v ? 'ABCDE'[i] : '')).join('') : 'ABCDE');
const opts = { zone: 'Europe/London' };

test('no filter shows everything', () => {
  assert.equal(isActive(EMPTY_FILTER), false);
  assert.equal(filterMask(ds, EMPTY_FILTER, opts), null);
  assert.equal(filterMask(ds, f({ field: 'Vehicle', value: '  ' }), opts), null);
});

test('date and time range (the "to" minute is included); points without a time are hidden', () => {
  assert.equal(shown(filterMask(ds, f({ from: '2024-03-14T09:00', to: '2024-03-14T12:00' }), opts)), 'BC');
  assert.equal(shown(filterMask(ds, f({ from: '2024-03-14T10:00' }), opts)), 'CD');
  assert.equal(shown(filterMask(ds, f({ to: '2024-03-14T09:29' }), opts)), 'A');
  assert.equal(localToMs('2024-07-01T09:00', 'Europe/London'), Date.UTC(2024, 6, 1, 8, 0), 'British Summer Time');
});

test('time of day, including overnight ranges', () => {
  assert.equal(shown(filterMask(ds, f({ todFrom: '08:00', todTo: '12:00' }), opts)), 'B');
  assert.equal(shown(filterMask(ds, f({ todFrom: '22:00', todTo: '08:00' }), opts)), 'AD');
  assert.equal(shown(filterMask(ds, f({ todFrom: '08:00', todTo: '09:00' }), { zone: 'America/New_York' })), 'C', '12:00 GMT is 08:00 in New York (EDT, daylight saving started 10 March)');
});

test('rules on a column: is / is not / contains / at least / at most', () => {
  assert.equal(shown(filterMask(ds, f({ field: 'Vehicle', op: 'is', value: 'VAN-02' }), opts)), 'BC', 'ignores letter case');
  assert.equal(shown(filterMask(ds, f({ field: 'Vehicle', op: 'not', value: 'van-02' }), opts)), 'ADE');
  assert.equal(shown(filterMask(ds, f({ field: 'Vehicle', op: 'contains', value: '0' }), opts)), 'ABCDE');
  assert.equal(shown(filterMask(ds, f({ field: 'Load', op: 'gte', value: '100' }), opts)), 'AC', '"1,200" is read as 1200');
  assert.equal(shown(filterMask(ds, f({ field: 'Load', op: 'lte', value: '80' }), opts)), 'BE');
  assert.equal(shown(filterMask(ds, f({ field: '@label', op: 'is', value: 'c' }), opts)), 'C');
});

test('a rule on a column the dataset does not have leaves it alone', () => {
  assert.equal(filterMask(ds, f({ field: 'Driver', op: 'is', value: 'Sam' }), opts), null);
});

test('rules combine with time filters', () => {
  assert.equal(shown(filterMask(ds, f({ todFrom: '08:00', field: 'Vehicle', value: 'VAN-02' }), opts)), 'BC');
});

test('speed rule uses speeds worked out from times and distances', () => {
  // ~1.1 km per 2.5 h etc. — all slow; the last leg (11 h, 1.1 km) slowest
  assert.equal(shown(filterMask(ds, f({ field: '@speed', op: 'gte', value: '0.25' }), opts)), 'ABC');
});

test('describing a filter', () => {
  const fmt = (ms) => new Date(ms).toISOString().slice(11, 16);
  assert.equal(describeFilter(f({ from: '2024-03-14T09:00', to: '2024-03-14T12:00', todFrom: '08:00', field: 'Vehicle', op: 'not', value: 'VAN-01' }), (k) => k, fmt, 'UTC'),
    '09:00 to 12:00 · 08:00–24:00 each day · Vehicle is not VAN-01');
});

// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLat, parseLon, parseCombined, guessCombinedOrder } from '../js/coords.js';
import { parseDateTime, parseDateAndTime, guessDateOrder, parseTimeOfDay } from '../js/dates.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('decimal and hemisphere coordinates', () => {
  near(parseLat('51.5007'), 51.5007);
  near(parseLon('-0.1246'), -0.1246);
  near(parseLat('51.5N'), 51.5);
  near(parseLat('S 33.86'), -33.86);
  near(parseLon('151.2 E'), 151.2);
  near(parseLon('0.12W'), -0.12);
  near(parseLat('51,5'), 51.5);
  assert.equal(parseLat('95'), null);
  assert.equal(parseLon('190'), null);
  assert.equal(parseLat('0.12W'), null);
  assert.equal(parseLat('Name'), null);
  assert.equal(parseLat(''), null);
});

test('DMS and DDM coordinates', () => {
  near(parseLat(`51°30'26"N`), 51 + 30 / 60 + 26 / 3600);
  near(parseLon(`0°07'39"W`), -(7 / 60 + 39 / 3600));
  near(parseLat('51 30 26 N'), 51 + 30 / 60 + 26 / 3600);
  near(parseLat(`51°30.433'N`), 51 + 30.433 / 60);
  near(parseLat('-33 52 04'), -(33 + 52 / 60 + 4 / 3600));
  near(parseLat('51d30m26s'), 51 + 30 / 60 + 26 / 3600);
  near(parseLat('51º30′26″N'), 51 + 30 / 60 + 26 / 3600);
  assert.equal(parseLat(`51°75'N`), null);
});

test('combined coordinates', () => {
  assert.deepEqual(parseCombined('51.5, -0.12'), [51.5, -0.12]);
  assert.deepEqual(parseCombined('(51.5,-0.12)'), [51.5, -0.12]);
  assert.deepEqual(parseCombined('51.5 -0.12'), [51.5, -0.12]);
  assert.deepEqual(parseCombined('51.5;-0.12'), [51.5, -0.12]);
  assert.deepEqual(parseCombined('POINT(-0.12 51.5)'), [51.5, -0.12]);
  assert.deepEqual(parseCombined('151.2, -33.8'), [-33.8, 151.2]); // auto-swap
  assert.deepEqual(parseCombined('-0.12, 51.5', 'lonlat'), [51.5, -0.12]);
  const dms = parseCombined(`51°30'00"N 0°07'30"W`);
  near(dms[0], 51.5); near(dms[1], -0.125);
  const ddm = parseCombined('N51 30.000 W0 07.500');
  near(ddm[0], 51.5); near(ddm[1], -0.125);
  const lonFirst = parseCombined('0.125W 51.5N');
  near(lonFirst[0], 51.5); near(lonFirst[1], -0.125);
  assert.equal(parseCombined('hello world'), null);
  assert.equal(guessCombinedOrder(['-0.1, 51.5', '120.5, 30.1', '170, -40']), 'lonlat');
  assert.equal(guessCombinedOrder(['51.5, -0.1', '30.1, 120.5']), 'latlon');
});

const local = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

test('dates', () => {
  assert.equal(parseDateTime('2024-03-05T09:15:00Z'), Date.UTC(2024, 2, 5, 9, 15));
  assert.equal(parseDateTime('2024-03-05T09:15:00+01:00'), Date.UTC(2024, 2, 5, 8, 15));
  assert.equal(parseDateTime('2024-03-05 09:15'), local(2024, 3, 5, 9, 15));
  assert.equal(parseDateTime('2024/03/05 09:15:30'), local(2024, 3, 5, 9, 15, 30));
  assert.equal(parseDateTime('05/03/2024 09:15', 'dmy'), local(2024, 3, 5, 9, 15));
  assert.equal(parseDateTime('05/03/2024 09:15', 'mdy'), local(2024, 5, 3, 9, 15));
  assert.equal(parseDateTime('25/03/2024', 'mdy'), local(2024, 3, 25)); // unambiguous
  assert.equal(parseDateTime('3/5/2024 2:30 PM', 'mdy'), local(2024, 3, 5, 14, 30));
  assert.equal(parseDateTime('5 Mar 2024 14:30'), local(2024, 3, 5, 14, 30));
  assert.equal(parseDateTime('March 5, 2024 2:30 pm'), local(2024, 3, 5, 14, 30));
  assert.equal(parseDateTime('Tue 5 March 2024'), local(2024, 3, 5));
  assert.equal(parseDateTime('1709630100'), 1709630100000);
  assert.equal(parseDateTime('1709630100000'), 1709630100000);
  assert.equal(parseDateTime('31/02/2024'), null);
  assert.equal(parseDateTime('Point 1'), null);
  assert.equal(parseDateTime('hello'), null);
  assert.equal(parseDateTime('12'), null);
});

test('separate date and time', () => {
  assert.equal(parseDateAndTime('05/03/2024', '14:30', 'dmy'), local(2024, 3, 5, 14, 30));
  assert.equal(parseDateAndTime('2024-03-05', '2:30:15 PM'), local(2024, 3, 5, 14, 30, 15));
  assert.equal(parseDateAndTime('2024-03-05', '14:30Z'), Date.UTC(2024, 2, 5, 14, 30));
  assert.equal(parseDateAndTime('2024-03-05', ''), local(2024, 3, 5));
  assert.deepEqual(parseTimeOfDay('0.5'), { h: 12, m: 0, s: 0, ms: 0 });
});

test('date order guessing', () => {
  assert.equal(guessDateOrder(['01/02/2024', '25/02/2024']), 'dmy');
  assert.equal(guessDateOrder(['01/02/2024', '02/25/2024']), 'mdy');
});

import { wallToUtc, wallClock, hasExplicitZone, shiftTimes } from '../js/dates.js';

test('times read in a chosen time zone', () => {
  // New York: EST (UTC-5) in winter, EDT (UTC-4) in summer
  assert.equal(parseDateTime('2024-03-05 09:15', 'dmy', 'America/New_York'), Date.UTC(2024, 2, 5, 14, 15));
  assert.equal(parseDateTime('2024-07-01 09:00', 'dmy', 'America/New_York'), Date.UTC(2024, 6, 1, 13, 0));
  // London: GMT in winter, BST in summer
  assert.equal(parseDateTime('14/03/2024 09:10', 'dmy', 'Europe/London'), Date.UTC(2024, 2, 14, 9, 10));
  assert.equal(parseDateTime('01/07/2024 09:10', 'dmy', 'Europe/London'), Date.UTC(2024, 6, 1, 8, 10));
  assert.equal(parseDateTime('2024-03-05 09:15', 'dmy', 'UTC'), Date.UTC(2024, 2, 5, 9, 15));
  // A value that states its own zone ignores the chosen one
  assert.equal(parseDateTime('2024-03-05T09:15:00Z', 'dmy', 'America/New_York'), Date.UTC(2024, 2, 5, 9, 15));
  assert.equal(parseDateTime('1709630100', 'dmy', 'Asia/Tokyo'), 1709630100000);
  // Separate date and time columns
  assert.equal(parseDateAndTime('14/03/2024', '09:10', 'dmy', 'Asia/Tokyo'), Date.UTC(2024, 2, 14, 0, 10));
  // Excel serial numbers are wall-clock times too (45000.5 = 15 Mar 2023 12:00)
  assert.equal(parseDateTime('45000.5', 'dmy', 'UTC'), Date.UTC(2023, 2, 15, 12, 0));
  assert.equal(parseDateTime('45000.5', 'dmy', 'Europe/Paris'), Date.UTC(2023, 2, 15, 11, 0));
});

test('daylight saving edges', () => {
  // London clocks went forward at 01:00 GMT on 31 Mar 2024; 01:30 local doesn't exist, 02:30 BST = 01:30 UTC
  assert.equal(wallToUtc(2024, 2, 31, 2, 30, 0, 0, 'Europe/London'), Date.UTC(2024, 2, 31, 1, 30));
  assert.equal(wallToUtc(2024, 2, 31, 0, 30, 0, 0, 'Europe/London'), Date.UTC(2024, 2, 31, 0, 30));
  const w = wallClock(Date.UTC(2024, 6, 1, 8, 10), 'Europe/London');
  assert.deepEqual([w.y, w.mo, w.d, w.h, w.mi], [2024, 6, 1, 9, 10]);
});

test('explicit zone detection and shifting', () => {
  assert.ok(hasExplicitZone('2024-03-05T09:15:00Z'));
  assert.ok(hasExplicitZone('2024-03-05 09:15+01:00'));
  assert.ok(hasExplicitZone('14:30 UTC'));
  assert.ok(hasExplicitZone('1709630100'));
  assert.ok(!hasExplicitZone('2024-03-05 09:15'));
  assert.ok(!hasExplicitZone('14-03-2024'));
  assert.ok(!hasExplicitZone('05/03/2024 09:15'));
  const pts = [{ t: Date.UTC(2024, 2, 14, 9, 10) }, { t: Date.UTC(2024, 2, 14, 9, 10), tzx: true }, { t: null }];
  shiftTimes(pts, 'UTC', 'America/New_York'); // 09:10 wall time, now read as New York time
  assert.equal(pts[0].t, Date.UTC(2024, 2, 14, 13, 10));
  assert.equal(pts[1].t, Date.UTC(2024, 2, 14, 9, 10)); // stated its own zone: unchanged
  assert.equal(pts[2].t, null);
});

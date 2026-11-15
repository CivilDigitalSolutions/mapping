// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, summarise } from '../js/analysis.js';

const T0 = Date.UTC(2024, 2, 14, 8, 0);
const min = (m) => T0 + m * 60000;
// About 111 m per 0.001 degree of latitude
const pt = (latOffsetMetres, minutes) => ({ lat: 51.5 + latOffsetMetres / 111195, lon: -0.1, t: min(minutes) });
const all = (pts) => pts.map((_, i) => i);

test('a stop: stays within 50 m for 5 minutes or more', () => {
  const pts = [pt(0, 0), pt(500, 1), pt(510, 2), pt(495, 4), pt(505, 8), pt(1000, 9)];
  const { stops, gaps, jumps } = analyse(pts, all(pts));
  assert.equal(stops.length, 1);
  assert.equal(stops[0].i0, 1);
  assert.equal(stops[0].i1, 4);
  assert.equal(stops[0].minutes, 7);
  assert.equal(stops[0].count, 4);
  assert.equal(gaps.length, 0);
  assert.equal(jumps.length, 0);
});

test('a short pause is not a stop', () => {
  const pts = [pt(0, 0), pt(500, 1), pt(505, 3), pt(1000, 4)];
  assert.equal(analyse(pts, all(pts)).stops.length, 0);
});

test('a long silence in the same place is a stop, not a gap', () => {
  const pts = [pt(0, 0), pt(500, 1), pt(510, 31), pt(1000, 32)];
  const r = analyse(pts, all(pts));
  assert.equal(r.stops.length, 1);
  assert.equal(r.stops[0].minutes, 30);
  assert.equal(r.gaps.length, 0);
});

test('a gap: no data for 10+ minutes while moving', () => {
  const pts = [pt(0, 0), pt(300, 1), pt(5000, 16), pt(5300, 17)];
  const r = analyse(pts, all(pts));
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].a, 1);
  assert.equal(r.gaps[0].b, 2);
  assert.equal(r.gaps[0].minutes, 15);
  assert.ok(r.gaps[0].metres > 4000);
});

test('a GPS jump is flagged once, and the route either side is unaffected', () => {
  // 50 km away and back within a minute
  const pts = [pt(0, 0), pt(300, 1), pt(50000, 2), pt(600, 3), pt(900, 4)];
  const r = analyse(pts, all(pts));
  assert.equal(r.jumps.length, 1);
  assert.equal(r.jumps[0].i, 2);
  assert.ok(r.jumps[0].speed > 1000);
  assert.equal(r.stops.length, 0);
  assert.equal(r.gaps.length, 0);
});

test('GPS wobble over a few metres is not a jump', () => {
  const pts = [pt(0, 0), { ...pt(30, 0), t: T0 + 1000 }, { ...pt(5, 0), t: T0 + 2000 }];
  assert.equal(analyse(pts, all(pts)).jumps.length, 0);
});

test('settings change the results', () => {
  const pts = [pt(0, 0), pt(500, 1), pt(505, 3), pt(1000, 4)];
  assert.equal(analyse(pts, all(pts), { stopMinutes: 2 }).stops.length, 1);
  const fast = [pt(0, 0), pt(3000, 1)]; // 3 km in a minute ≈ 112 mph / 180 km/h
  assert.equal(analyse(fast, all(fast)).jumps.length, 0);
  assert.equal(analyse(fast, all(fast), { jumpSpeed: 100 }).jumps.length, 1);
  assert.equal(analyse(fast, all(fast), { jumpSpeed: 150, speedUnit: 'kmh' }).jumps.length, 1);
});

test('points without a time, or out of the given order, are ignored', () => {
  const pts = [pt(0, 0), { lat: 52, lon: 1, t: null }, pt(500, 1), pt(505, 9), pt(1000, 10)];
  const r = analyse(pts, [0, 2, 3, 4]);
  assert.equal(r.stops.length, 1);
  assert.equal(r.jumps.length, 0);
});

test('summary line', () => {
  const fmt = (ms) => `${Math.round(ms / 60000)}m`;
  assert.equal(summarise({ stops: [{ minutes: 7 }, { minutes: 5 }], gaps: [{}], jumps: [] }, fmt), '2 stops (12m) · 1 gap in the recording');
  assert.equal(summarise({ stops: [], gaps: [], jumps: [{}] }, fmt), '1 possible GPS jump');
  assert.equal(summarise({ stops: [], gaps: [], jumps: [] }, fmt), '');
});

test('data recorded sparsely on purpose is not all gaps; a real dropout still is', () => {
  // A survey every 30–45 minutes, moving each time: nothing unusual
  const survey = [pt(0, 0), pt(800, 30), pt(1600, 75), pt(2400, 105), pt(3200, 140), pt(4000, 172)];
  assert.equal(analyse(survey, all(survey)).gaps.length, 0);
  // The same survey with one 3-hour silence: that one stands out
  const dropout = [...survey, pt(4800, 360), pt(5600, 392)];
  const r = analyse(dropout, all(dropout));
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].minutes, 188);
});

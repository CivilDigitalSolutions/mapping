// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitsNear, segmentInside } from '../js/nearby.js';

const T0 = Date.UTC(2024, 2, 14, 8, 0);
const min = (m) => T0 + m * 60000;
const PLACE = { lat: 51.5, lon: -0.1 };
// A point `north` metres north of the place (about 111,195 m per degree)
const pt = (north, minutes) => ({ lat: 51.5 + north / 111195, lon: -0.1, t: minutes == null ? null : min(minutes) });
const all = (pts) => pts.map((_, i) => i);
const near = (a, b, tol = 2000) => Math.abs(a - b) <= tol; // within 2 s

test('segment inside a circle', () => {
  assert.deepEqual(segmentInside([-100, 0], [100, 0], 50), [0.25, 0.75]);
  assert.equal(segmentInside([-100, 60], [100, 60], 50), null, 'passes 60 m away');
  assert.equal(segmentInside([100, 0], [200, 0], 50), null, 'pointing away');
  assert.deepEqual(segmentInside([0, 0], [0, 0], 50), [0, 1], 'not moving, inside');
});

test('driving through: entry and exit times are worked out between points', () => {
  const pts = [-200, -100, 0, 100, 200].map((m, k) => pt(m, k));
  const { visits, nearest } = visitsNear(pts, all(pts), PLACE, 50);
  assert.equal(visits.length, 1);
  const v = visits[0];
  assert.ok(near(v.from, min(1.5)), 'enters halfway between 08:01 and 08:02');
  assert.ok(near(v.to, min(2.5)));
  assert.equal(v.count, 1);
  assert.equal(v.i, 2);
  assert.ok(v.closest < 1);
  assert.ok(nearest.dist < 1 && nearest.i === 2);
});

test('passing by between two recorded points still counts', () => {
  const pts = [pt(-150, 0), pt(150, 2)];
  const { visits } = visitsNear(pts, all(pts), PLACE, 50);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].count, 0, 'no recorded point inside');
  assert.ok(near(visits[0].from, min(2 / 3)) && near(visits[0].to, min(4 / 3)));
  assert.ok(near(visits[0].closestAt, min(1)));
});

test('leaving and coming back makes two visits; parked inside makes one long one', () => {
  const pts = [pt(0, 0), pt(10, 30), pt(500, 40), pt(5, 60), pt(0, 90)];
  const { visits } = visitsNear(pts, all(pts), PLACE, 50);
  assert.equal(visits.length, 2);
  assert.ok(near(visits[0].from, min(0)));
  assert.ok(visits[0].to > min(30) && visits[0].to < min(31));
  assert.equal(visits[0].count, 2);
  assert.ok(visits[1].from > min(58) && visits[1].from < min(58.5), "back within 50 m about 18 minutes into the 20-minute leg");
  assert.ok(near(visits[1].to, min(90)));
});

test('never close: nothing found, but the nearest approach is reported', () => {
  const pts = [pt(300, 0), pt(200, 5), pt(400, 10)];
  const { visits, nearest } = visitsNear(pts, all(pts), PLACE, 100);
  assert.equal(visits.length, 0);
  assert.ok(Math.abs(nearest.dist - 200) < 1);
  assert.equal(nearest.i, 1);
  assert.equal(nearest.t, min(5));
});

test('points without times, and a single point', () => {
  const pts = [pt(-500, 0), pt(500, 5), pt(20, null)];
  const r = visitsNear(pts, [0, 1], PLACE, 50, [2]);
  assert.equal(r.visits.length, 2, 'the route passes through, and the untimed point is inside');
  assert.equal(r.visits[1].from, null);
  assert.equal(r.visits[1].i, 2);
  const one = visitsNear([pt(10, 3)], [0], PLACE, 50);
  assert.equal(one.visits.length, 1);
  assert.equal(one.visits[0].from, min(3));
});

// Finding stops, gaps in the recording and GPS jumps along a route.
//
// Works on a dataset's points in time order. Points without a time are ignored.
//
//  - Stop: the route stays within `stopRadius` metres of where the stop began for
//    at least `stopMinutes`. (A long silence between two points in the same place
//    counts as a stop too: many trackers send less often when parked.)
//  - Gap: nothing recorded for at least `gapMinutes` while the position moved more
//    than `stopRadius`, so we don't know the route taken in between. It must also
//    be at least GAP_FACTOR times the dataset's usual time between points, so data
//    that's recorded sparsely on purpose (e.g. a survey every 30 minutes) isn't
//    flagged at every step.
//  - Jump: the speed needed to get from one point to the next is faster than
//    `jumpSpeed`, which usually means a bad GPS reading. Short hops (under 200 m)
//    are ignored, because a few metres of GPS wobble over a second can look fast.

import { distanceMetres } from './coords.js';

export const SPEED_UNITS = {
  mph: { label: 'mph', perMs: 3600 / 1.609344 }, // metres per millisecond → mph
  kmh: { label: 'km/h', perMs: 3600 },
};

export const DEFAULT_ANALYSIS = {
  stopMinutes: 5,
  stopRadius: 50,      // metres
  gapMinutes: 10,
  jumpSpeed: 150,      // in `speedUnit`
  speedUnit: 'mph',
  showOnMap: true,
};

const MIN_JUMP_DISTANCE = 200; // metres
export const GAP_FACTOR = 3;   // a gap is at least this many times the usual interval

/**
 * @param {Array} points  the dataset's points ({ lat, lon, t })
 * @param {number[]} order  indexes of the points to look at, in time order
 * @param {object} opts  see DEFAULT_ANALYSIS
 * @returns {{ stops: Stop[], gaps: Gap[], jumps: Jump[] }}
 *   Stop: { from, to, i0, i1, lat, lon, minutes, count }
 *   Gap:  { from, to, a, b, minutes, metres }
 *   Jump: { i, prev, metres, seconds, speed }   (speed in opts.speedUnit)
 */
export function analyse(points, order, opts = {}) {
  const o = { ...DEFAULT_ANALYSIS, ...opts };
  const unit = SPEED_UNITS[o.speedUnit] || SPEED_UNITS.mph;
  const seq = order.filter((i) => points[i].t !== null && points[i].t !== undefined);
  const stops = [], gaps = [], jumps = [];
  const at = (i) => [points[i].lat, points[i].lon];

  // ---- GPS jumps first, so they don't break up stops or count as gaps
  const bad = new Set();
  for (let k = 1; k < seq.length; k++) {
    // Compare against the last good point, so one bad reading is flagged once
    let p = k - 1;
    while (p > 0 && bad.has(seq[p])) p--;
    const a = seq[p], b = seq[k];
    const metres = distanceMetres(at(a), at(b));
    const ms = points[b].t - points[a].t;
    if (metres < MIN_JUMP_DISTANCE || ms < 0) continue;
    const speed = ms > 0 ? (metres / ms) * unit.perMs : Infinity;
    if (speed > o.jumpSpeed) {
      jumps.push({ i: b, prev: a, metres, seconds: ms / 1000, speed });
      bad.add(b);
    }
  }
  const good = seq.filter((i) => !bad.has(i));

  // ---- Stops: grow a run while the points stay near where it started
  const stopMs = o.stopMinutes * 60000;
  let k = 0;
  while (k < good.length) {
    const start = good[k];
    let j = k;
    while (j + 1 < good.length && distanceMetres(at(start), at(good[j + 1])) <= o.stopRadius) j++;
    const end = good[j];
    if (j > k && points[end].t - points[start].t >= stopMs) {
      const run = good.slice(k, j + 1);
      stops.push({
        from: points[start].t,
        to: points[end].t,
        i0: start,
        i1: end,
        lat: run.reduce((s, i) => s + points[i].lat, 0) / run.length,
        lon: run.reduce((s, i) => s + points[i].lon, 0) / run.length,
        minutes: (points[end].t - points[start].t) / 60000,
        count: run.length,
      });
      k = j + 1;
    } else {
      k++;
    }
  }

  // ---- Gaps: long silences while on the move
  // The usual time between points (median), so sparse-on-purpose data isn't all "gaps"
  const intervals = [];
  for (let n = 1; n < good.length; n++) intervals.push(points[good[n]].t - points[good[n - 1]].t);
  intervals.sort((x, y) => x - y);
  const usual = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 0;
  const gapMs = Math.max(o.gapMinutes * 60000, usual * GAP_FACTOR);
  for (let n = 1; n < good.length; n++) {
    const a = good[n - 1], b = good[n];
    const ms = points[b].t - points[a].t;
    if (ms < gapMs) continue;
    const metres = distanceMetres(at(a), at(b));
    if (metres <= o.stopRadius) continue; // stayed put: that's a stop, not a gap
    gaps.push({ from: points[a].t, to: points[b].t, a, b, minutes: ms / 60000, metres });
  }

  return { stops, gaps, jumps };
}

/** One line summing up an analysis, e.g. "3 stops (1h 12m) · 1 gap · 2 possible GPS jumps". */
export function summarise(result, formatDuration) {
  if (!result) return '';
  const { stops, gaps, jumps } = result;
  const parts = [];
  if (stops.length) {
    const total = stops.reduce((s, x) => s + x.minutes, 0) * 60000;
    parts.push(`${stops.length} stop${stops.length === 1 ? '' : 's'} (${formatDuration(total)})`);
  }
  if (gaps.length) parts.push(`${gaps.length} gap${gaps.length === 1 ? '' : 's'} in the recording`);
  if (jumps.length) parts.push(`${jumps.length} possible GPS jump${jumps.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

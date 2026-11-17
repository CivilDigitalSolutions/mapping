// "Who was here?": when each dataset came within a distance of a place.
//
// A route is treated as straight lines between its recorded points, so a
// vehicle that drove past between two fixes is still caught, and the times it
// entered and left the area are worked out along those lines.

const R = 6371008.8; // mean Earth radius, metres
const RAD = Math.PI / 180;

/** Flat x/y in metres around a centre: accurate to well under 1% within tens of km. */
function projector(lat0, lon0) {
  const cos = Math.cos(lat0 * RAD);
  return (lat, lon) => [(lon - lon0) * RAD * R * cos, (lat - lat0) * RAD * R];
}

/**
 * The part of the segment a→b (x/y metres, centre at 0,0) inside a circle of
 * radius r, as fractions [s0, s1] of the way along, or null if it never enters.
 */
export function segmentInside(a, b, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const A = dx * dx + dy * dy;
  const C = a[0] * a[0] + a[1] * a[1] - r * r;
  if (A === 0) return C <= 0 ? [0, 1] : null;
  const B = 2 * (a[0] * dx + a[1] * dy);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const s0 = (-B - sq) / (2 * A), s1 = (-B + sq) / (2 * A);
  if (s1 < 0 || s0 > 1) return null;
  return [Math.max(0, s0), Math.min(1, s1)];
}

/** Closest point of segment a→b to the centre: { s, dist }. */
export function closestOnSegment(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const A = dx * dx + dy * dy;
  const s = A === 0 ? 0 : Math.min(1, Math.max(0, -(a[0] * dx + a[1] * dy) / A));
  return { s, dist: Math.hypot(a[0] + dx * s, a[1] + dy * s) };
}

const lerp = (x, y, s) => (x == null || y == null ? null : x + (y - x) * s);

/**
 * Visits by one dataset to a circle around `place` ({ lat, lon }).
 * order:   point indexes in route order (consecutive ones are joined by lines)
 * untimed: indexes of points that aren't on the route (checked one by one)
 * Returns {
 *   visits: [{ from, to, closest, closestAt, i, count }]  (times in ms, or null without times;
 *            closest in metres; i = index of the recorded point nearest the place; count = recorded points inside)
 *   nearest: { dist, t, i } the closest the route came, inside or not (null for no points)
 * }
 */
export function visitsNear(points, order, place, radius, untimed = []) {
  const xy = projector(place.lat, place.lon);
  const pos = new Map();
  const at = (i) => { let v = pos.get(i); if (!v) { v = xy(points[i].lat, points[i].lon); pos.set(i, v); } return v; };
  const dist = (i) => Math.hypot(...at(i));
  const visits = [];
  let nearest = null;
  const consider = (d, t, i) => { if (!nearest || d < nearest.dist) nearest = { dist: d, t, i }; };
  let open = null; // the visit in progress

  const nearer = (v, i) => { const d = dist(i); if (d < v.pointDist) { v.pointDist = d; v.i = i; } };
  const close = (to) => { open.to = to; visits.push(open); open = null; };

  if (order.length === 1) {
    const i = order[0];
    consider(dist(i), points[i].t ?? null, i);
    if (dist(i) <= radius) visits.push({ from: points[i].t ?? null, to: points[i].t ?? null, closest: dist(i), closestAt: points[i].t ?? null, i, count: 1, pointDist: dist(i) });
  }
  for (let k = 0; k + 1 < order.length; k++) {
    const ia = order[k], ib = order[k + 1];
    const a = at(ia), b = at(ib);
    const ta = points[ia].t ?? null, tb = points[ib].t ?? null;
    const c = closestOnSegment(a, b);
    consider(c.dist, lerp(ta, tb, c.s), c.s < 0.5 ? ia : ib);
    const inside = segmentInside(a, b, radius);
    if (!inside) {
      if (open) close(open.lastT);
      continue;
    }
    const [s0, s1] = inside;
    if (open && s0 > 0) close(open.lastT); // left between points and came back: a new visit
    if (!open) {
      open = { from: lerp(ta, tb, s0), closest: Infinity, closestAt: null, i: ia, count: 0, pointDist: Infinity, lastT: null };
      if (s0 === 0) { open.count++; nearer(open, ia); }
    }
    if (c.dist < open.closest) { open.closest = c.dist; open.closestAt = lerp(ta, tb, c.s); }
    nearer(open, ia); nearer(open, ib);
    if (s1 === 1) open.count++;
    open.lastT = lerp(ta, tb, s1);
    if (s1 < 1) close(open.lastT);
  }
  if (open) close(open.lastT);

  // Points that aren't on the route (no time in a time-ordered dataset)
  for (const i of untimed) {
    const d = dist(i);
    consider(d, null, i);
    if (d <= radius) visits.push({ from: null, to: null, closest: d, closestAt: null, i, count: 1, pointDist: d });
  }
  for (const v of visits) { delete v.pointDist; delete v.lastT; }
  return { visits, nearest };
}

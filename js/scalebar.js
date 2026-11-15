// Scale bar maths for exported maps (web maps use the Web Mercator projection,
// where the ground distance covered by one pixel depends on latitude and zoom).

const EARTH_CIRCUMFERENCE = 40075016.686; // metres at the equator
const METRES_PER_FOOT = 0.3048;
const METRES_PER_MILE = 1609.344;

/** Ground metres covered by one CSS pixel at this latitude and zoom. */
export function metresPerPixel(lat, zoom) {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** zoom);
}

/** The largest "round" number (1, 2 or 5 × a power of ten) not above `max`. */
export function roundDown(max) {
  if (!(max > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

/** A metric bar no longer than `maxMetres`: { metres, label }, e.g. { 500, '500 m' } or { 2000, '2 km' }. */
export function metricScale(maxMetres) {
  const m = roundDown(maxMetres);
  return { metres: m, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

/** An imperial bar no longer than `maxMetres`: feet below a mile, miles above. */
export function imperialScale(maxMetres) {
  const miles = maxMetres / METRES_PER_MILE;
  if (miles >= 1) {
    const n = roundDown(miles);
    return { metres: n * METRES_PER_MILE, label: `${n} mi` };
  }
  const n = roundDown(maxMetres / METRES_PER_FOOT);
  return { metres: n * METRES_PER_FOOT, label: `${n} ft` };
}

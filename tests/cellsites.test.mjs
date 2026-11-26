// Cell site (mast) logic: guessing columns, reading values and the shape of a sector.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL_DEFAULTS, MAX_RADIUS_METRES, cellSectors, cleanCell, destination, guessCellColumns, normaliseAzimuth, parseNumber, sectorOutline } from '../js/cellsites.js';
import { CELL_SAMPLE } from '../js/samples.js';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} should be within ${eps} of ${b}`);

// Metres between two points (haversine), to check outlines against the radius asked for
function metres([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180, R = 6371008.8;
  const a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function bearing([la1, lo1], [la2, lo2]) {
  const r = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * r) * Math.cos(la2 * r);
  const x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

test('numbers are read from cells that include units or degree signs', () => {
  assert.equal(parseNumber('120'), 120);
  assert.equal(parseNumber('120°'), 120);
  assert.equal(parseNumber('65 deg'), 65);
  assert.equal(parseNumber('1,5'), 1.5);
  assert.equal(parseNumber(' -30 '), -30);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('n/a'), null);
  assert.equal(parseNumber(undefined), null);
});

test('azimuths wrap onto a 0 to 360 compass', () => {
  assert.equal(normaliseAzimuth(360), 0);
  assert.equal(normaliseAzimuth(-90), 270);
  assert.equal(normaliseAzimuth(450), 90);
  assert.equal(normaliseAzimuth(0), 0);
});

test('azimuth, beamwidth and radius columns are guessed from their names', () => {
  const data = { Azimuth: ['10', '130'], Beamwidth: ['65', '65'], 'Radius (km)': ['1.2', '2'], Name: ['a', 'b'] };
  const g = guessCellColumns(Object.keys(data), (c) => data[c]);
  assert.deepEqual(g, { az: 'Azimuth', beam: 'Beamwidth', radius: 'Radius (km)', unit: 'km' });

  const other = { 'Antenna Bearing': ['5'], HBW: ['60'], 'Coverage_Range_m': ['900'] };
  const g2 = guessCellColumns(Object.keys(other), (c) => other[c]);
  assert.equal(g2.az, 'Antenna Bearing');
  assert.equal(g2.beam, 'HBW');
  assert.equal(g2.radius, 'Coverage_Range_m');
  assert.equal(g2.unit, 'm');
});

test('a column with the right name but no numbers is not suggested', () => {
  const data = { Direction: ['north', 'south'], Notes: ['x', 'y'] };
  assert.equal(guessCellColumns(Object.keys(data), (c) => data[c]).az, '');
  assert.deepEqual(guessCellColumns([], () => []), { az: '', beam: '', radius: '', unit: 'm' });
});

test('a point 1 km away on a bearing is 1 km away on that bearing', () => {
  for (const b of [0, 45, 90, 180, 270, 333]) {
    const d = destination(51.5, -0.12, b, 1000);
    near(metres([51.5, -0.12], d), 1000, 1);
    near((bearing([51.5, -0.12], d) - b + 540) % 360 - 180, 0, 0.1);
  }
});

test('a sector starts at the mast, is centred on the azimuth and reaches the radius', () => {
  const out = sectorOutline(51.5, -0.12, 90, 60, 800);
  assert.deepEqual(out[0], [51.5, -0.12]);
  const arc = out.slice(1);
  for (const p of arc) near(metres([51.5, -0.12], p), 800, 1);
  near(bearing([51.5, -0.12], arc[0]), 60, 0.2);                 // 90 - 60/2
  near(bearing([51.5, -0.12], arc[arc.length - 1]), 120, 0.2);   // 90 + 60/2
  assert.ok(arc.length >= 4, 'the arc is more than a triangle');
});

test('a sector across north is drawn the right way round', () => {
  const arc = sectorOutline(51.5, -0.12, 0, 60, 500).slice(1);
  near(bearing([51.5, -0.12], arc[0]), 330, 0.2);
  near(bearing([51.5, -0.12], arc[arc.length - 1]), 30, 0.2);
});

test('a 360 degree beamwidth is a full circle with no centre point', () => {
  const ring = sectorOutline(51.5, -0.12, 0, 360, 300);
  assert.equal(ring.length, 72);
  for (const p of ring) near(metres([51.5, -0.12], p), 300, 1);
});

const dsWith = (rows, cell) => ({
  points: rows.map((props) => ({ lat: 51.5, lon: -0.1, t: null, label: '', props })),
  cell: { ...CELL_DEFAULTS, on: true, az: 'az', beam: 'bw', radius: 'r', ...cell },
});

test('sectors use each row\'s values, and the defaults where a row has none', () => {
  const ds = dsWith([{ az: '90', bw: '40', r: '5' }, { az: '200' }, { bw: '40' }], { defaultBeam: 70, defaultRadius: 2, unit: 'km' });
  const { sectors, missing } = cellSectors(ds);
  assert.equal(sectors.length, 2);
  assert.equal(missing, 1);
  assert.deepEqual([sectors[0].az, sectors[0].beam, sectors[0].radius], [90, 40, 5000]);
  assert.deepEqual([sectors[1].az, sectors[1].beam, sectors[1].radius], [200, 70, 2000]);
});

test('absurd values fall back to the defaults or are capped', () => {
  const ds = dsWith([{ az: '10', bw: '0', r: '-5' }, { az: '10', bw: '999', r: '99999999' }], { defaultBeam: 65, defaultRadius: 1000, unit: 'm' });
  const { sectors } = cellSectors(ds);
  assert.deepEqual([sectors[0].beam, sectors[0].radius], [65, 1000]);
  assert.deepEqual([sectors[1].beam, sectors[1].radius], [360, MAX_RADIUS_METRES]);
});

test('nothing is drawn unless the feature is switched on for the dataset and an azimuth column is chosen', () => {
  assert.equal(cellSectors(dsWith([{ az: '1' }], { on: false })).sectors.length, 0);
  assert.equal(cellSectors(dsWith([{ az: '1' }], { az: '' })).sectors.length, 0);
  assert.equal(cellSectors({ points: [{ lat: 1, lon: 1, props: { az: '1' } }] }).sectors.length, 0);
});

test('hidden (filtered out) points get no sector', () => {
  const ds = dsWith([{ az: '1' }, { az: '2' }, { az: '3' }], {});
  assert.deepEqual(cellSectors(ds, [true, false, true]).sectors.map((s) => s.i), [0, 2]);
});

test('saved settings are cleaned', () => {
  assert.equal(cleanCell(null), null);
  assert.equal(cleanCell([1]), null);
  const c = cleanCell({ on: 'yes', az: 5, beam: 'BW', radius: 'R', defaultBeam: -3, defaultRadius: 'x', unit: '<img>' });
  assert.deepEqual(c, { on: false, az: '', beam: 'BW', radius: 'R', defaultBeam: 65, defaultRadius: 1000, unit: 'm' });
  assert.equal(cleanCell({ on: true, az: 'Az', unit: 'mi', defaultRadius: 3 }).unit, 'mi');
});

test('the sample data draws every sector, using defaults where it leaves a value out', async () => {
  const text = CELL_SAMPLE.text.split('\n');
  const headers = text[0].split(',');
  const rows = text.slice(1).map((l) => l.split(','));
  assert.equal(rows.length, 22);
  const ds = {
    points: rows.map((r) => ({ lat: Number(r[2]), lon: Number(r[3]), t: null, label: r[0], props: Object.fromEntries(headers.map((h, i) => [h, r[i]]).filter(([h, v]) => v !== '' && h !== 'Latitude' && h !== 'Longitude')) })),
    cell: CELL_SAMPLE.cell,
  };
  const { sectors, missing } = cellSectors(ds);
  assert.equal(sectors.length, 22);
  assert.equal(missing, 0);
  assert.equal(sectors.filter((s) => s.beam === 360).length, 1);
  const bermondsey = sectors.filter((s, k) => ds.points[s.i].label === 'LDN008 Bermondsey');
  assert.deepEqual(bermondsey.map((s) => s.radius), [600, 600, 600], 'rows with no radius use the default');
  const mayfair = sectors.filter((s) => ds.points[s.i].label === 'LDN007 Mayfair');
  assert.deepEqual(mayfair.map((s) => s.beam), [65, 65, 65], 'rows with no beamwidth use the default');
});

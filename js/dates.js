// Date / time parsing for spreadsheet-style data.
// Supports ISO 8601, D/M/Y and M/D/Y (with auto-detection), YYYY/MM/DD,
// month names, Unix timestamps (s and ms), Excel serial numbers and
// separate date + time columns.
//
// Time zones: a value that names its own zone ("Z", "+01:00", "UTC", or a Unix
// timestamp) is used exactly. Any other value is a wall-clock time and is read
// in the `zone` passed in (an IANA name such as "Europe/London"); with no zone
// it is read in this device's zone.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// ------------------------------------------------------------------ time zones

export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function isValidTimeZone(zone) {
  if (!zone) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

const FALLBACK_ZONES = [
  'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Athens',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney',
  'Pacific/Auckland', 'Africa/Johannesburg', 'Africa/Lagos',
];

/** Every IANA time zone the browser knows, plus UTC. */
export function timeZoneList() {
  let list;
  try { list = Intl.supportedValuesOf('timeZone'); } catch { list = FALLBACK_ZONES; }
  return ['UTC', ...list.filter((z) => z !== 'UTC')];
}

const zoneFmts = new Map();
function zoneFmt(zone) {
  if (!zoneFmts.has(zone)) {
    zoneFmts.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }));
  }
  return zoneFmts.get(zone);
}

/** The wall-clock date and time at instant `ts` in `zone` (device zone if empty). */
export function wallClock(ts, zone) {
  const ms = ((ts % 1000) + 1000) % 1000;
  if (!zone) {
    const d = new Date(ts);
    return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), ms };
  }
  const parts = {};
  for (const p of zoneFmt(zone).formatToParts(new Date(ts))) parts[p.type] = p.value;
  return { y: Number(parts.year), mo: Number(parts.month) - 1, d: Number(parts.day), h: Number(parts.hour) % 24, mi: Number(parts.minute), s: Number(parts.second), ms };
}

function offsetMinutes(zone, ts) {
  const w = wallClock(ts, zone);
  return (Date.UTC(w.y, w.mo, w.d, w.h, w.mi, w.s, w.ms) - ts) / 60000;
}

/** Convert a wall-clock time in `zone` to an instant (epoch ms). Handles daylight saving. */
export function wallToUtc(y, mo, d, h, mi, s, ms, zone) {
  if (!zone) return new Date(y, mo, d, h, mi, s, ms).getTime();
  const guess = Date.UTC(y, mo, d, h, mi, s, ms);
  if (zone === 'UTC') return guess;
  const off1 = offsetMinutes(zone, guess);
  let t = guess - off1 * 60000;
  const off2 = offsetMinutes(zone, t);
  if (off2 !== off1) t = guess - off2 * 60000;
  return t;
}

/** True if a date/time value states its own zone, so it doesn't need one chosen. */
export function hasExplicitZone(value) {
  const s = String(value ?? '').trim();
  if (/^\d{10}(\.\d+)?$|^\d{13}$/.test(s)) return true; // Unix timestamps are absolute
  return /\d:\d{2}(:\d{2}([.,]\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|UTC|GMT)$/i.test(s);
}

/**
 * Re-read the stored times of `points` as if they had been recorded in `toZone`
 * instead of `fromZone`. Times that stated their own zone (p.tzx) are left alone.
 */
export function shiftTimes(points, fromZone, toZone) {
  for (const p of points) {
    if (p.t === null || p.t === undefined || p.tzx) continue;
    const w = wallClock(p.t, fromZone);
    p.t = wallToUtc(w.y, w.mo, w.d, w.h, w.mi, w.s, w.ms, toZone);
  }
}

// ------------------------------------------------------------------ parsing

/** Parse a time-of-day string. Returns { h, m, s, ms, tz } or null. */
export function parseTimeOfDay(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  // Excel fraction of a day, e.g. 0.5 = 12:00
  if (/^0?\.\d+$/.test(s)) {
    const total = Math.round(parseFloat(s) * 86400000);
    return { h: Math.floor(total / 3600000), m: Math.floor(total / 60000) % 60, s: Math.floor(total / 1000) % 60, ms: total % 1000 };
  }
  const m = s.match(/^(\d{1,2})(?::|\.|h)?(\d{2})?(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*([AaPp]\.?[Mm]\.?)?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const sec = Number(m[3] ?? 0);
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  const ampm = m[5] ? m[5][0].toLowerCase() : '';
  // Bare "1430" style needs minutes; reject a single bare number with no separator like "7"
  if (m[2] === undefined && !ampm) return null;
  if (ampm === 'p' && h < 12) h += 12;
  if (ampm === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return { h, m: min, s: sec, ms, tz: m[6] || '' };
}

function tzOffsetMinutes(tz) {
  if (!tz) return null;
  if (/^(Z|UTC|GMT)$/i.test(tz)) return 0;
  const m = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Turn date parts + optional time into an instant, reading wall-clock times in `zone`. */
function build(y, mo, d, t, zone) {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  if (new Date(Date.UTC(y, mo, d)).getUTCDate() !== d) return null; // e.g. 31 Feb
  const tm = t || { h: 0, m: 0, s: 0, ms: 0, tz: '' };
  const off = tzOffsetMinutes(tm.tz);
  const ms = off !== null
    ? Date.UTC(y, mo, d, tm.h, tm.m, tm.s, tm.ms) - off * 60000
    : wallToUtc(y, mo, d, tm.h, tm.m, tm.s, tm.ms, zone);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Inspect sample values to guess day/month order for slash dates.
 * Returns 'dmy' | 'mdy'.
 */
export function guessDateOrder(values) {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    if (b > 12 && a <= 12) mdy++;
  }
  if (dmy > mdy) return 'dmy';
  if (mdy > dmy) return 'mdy';
  // Ambiguous — fall back to the browser's locale
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-GB';
  return /^en-(US|PH)|^en$/i.test(lang) ? 'mdy' : 'dmy';
}

/**
 * Split a date / date-time value into parts.
 * Returns { abs } for values that are already an instant, { y, mo, d, t } for
 * calendar values (t = time of day or null), or null if it isn't a date.
 */
function parseParts(input, order) {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? { abs: input.getTime() } : null;
  let s = String(input).trim();
  if (!s) return null;

  // Pure number: Unix seconds / ms, or Excel serial date
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (/^\d{13}$/.test(s)) return { abs: n };              // ms
    if (/^\d{10}(\.\d+)?$/.test(s)) return { abs: n * 1000 }; // seconds
    if (n > 20000 && n < 80000) {                           // Excel serial (1954 – 2119): a wall-clock date and time
      const w = new Date(Math.round((n - 25569) * 86400000));
      return { y: w.getUTCFullYear(), mo: w.getUTCMonth(), d: w.getUTCDate(), t: { h: w.getUTCHours(), m: w.getUTCMinutes(), s: w.getUTCSeconds(), ms: 0, tz: '' } };
    }
    return null;
  }

  const withTime = (y, mo, d, rest, fixIso) => {
    if (!rest) return { y, mo, d, t: null };
    const t = parseTimeOfDay(fixIso ? rest.replace(/^(\d{2})(\d{2})(\d{2})/, '$1:$2:$3') : rest);
    return t ? { y, mo, d, t } : null;
  };

  // ISO 8601: 2024-03-05, 2024-03-05T14:30:00Z, 2024-03-05 14:30, 20240305T143000
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T\s]+(.+))?$/);
  if (m) return withTime(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4], true);

  // YYYY/MM/DD
  m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:[T,\s]+(.+))?$/);
  if (m) return withTime(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4]);

  // DD/MM/YYYY or MM/DD/YYYY (also with - or .)
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[T,\s]+(.+))?$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    let day, mon;
    if (a > 12) { day = a; mon = b; }
    else if (b > 12) { day = b; mon = a; }
    else if (order === 'mdy') { mon = a; day = b; }
    else { day = a; mon = b; }
    return withTime(Number(m[3]), mon - 1, day, m[4]);
  }

  // Month names: "5 Mar 2024 14:30", "March 5, 2024 2:30 PM", "Tue 5 Mar 2024"
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '');
  const monthIndex = (name) => MONTHS[name.slice(0, 4).toLowerCase()] ?? MONTHS[name.slice(0, 3).toLowerCase()];
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2,4})(?:[T,\s]+(.+))?$/);
  if (m && monthIndex(m[2]) !== undefined) return withTime(Number(m[3]), monthIndex(m[2]), Number(m[1]), m[4]);
  m = s.match(/^([A-Za-z]{3,9})\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2,4})(?:[T,\s]+(.+))?$/);
  if (m) {
    const mon = monthIndex(m[1]);
    if (mon === undefined) return null;
    return withTime(Number(m[3]), mon, Number(m[2]), m[4]);
  }

  // Last resort: let the browser try (handles RFC 2822 etc.), but only for strings that
  // clearly look like a date — some browsers will "parse" almost anything with a number in it.
  if (!/\d{4}/.test(s) || !/(\d{1,2}:\d{2})|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s)) return null;
  const fallback = Date.parse(s);
  return Number.isFinite(fallback) ? { abs: fallback } : null;
}

/**
 * Parse a date or date-time value to epoch milliseconds.
 * order: 'dmy' | 'mdy' (only matters for ambiguous numeric dates)
 * zone:  IANA zone for wall-clock values ('' / undefined = this device)
 */
export function parseDateTime(input, order = 'dmy', zone) {
  const p = parseParts(input, order);
  if (!p) return null;
  if (p.abs !== undefined) return p.abs;
  return build(p.y, p.mo, p.d, p.t, zone);
}

/** Combine a date column value with a separate time column value. */
export function parseDateAndTime(dateVal, timeVal, order = 'dmy', zone) {
  let p = parseParts(dateVal, order);
  if (!p) return null;
  if (p.abs !== undefined) {
    const w = wallClock(p.abs, zone);
    p = { y: w.y, mo: w.mo, d: w.d, t: { h: w.h, m: w.mi, s: w.s, ms: w.ms, tz: '' } };
  }
  const t = parseTimeOfDay(timeVal) || p.t;
  return build(p.y, p.mo, p.d, t, zone);
}

// ------------------------------------------------------------------ formatting

let displayZone = ''; // '' = this device's zone

function makeFormatter() {
  const opts = { dateStyle: 'medium', timeStyle: 'long' }; // "long" time includes the zone, e.g. "8:00:00 AM GMT"
  try { return new Intl.DateTimeFormat(undefined, displayZone ? { ...opts, timeZone: displayZone } : opts); } catch { return new Intl.DateTimeFormat(undefined, opts); }
}
let dtf = makeFormatter();

/** Choose which zone times are shown in ('' = this device). */
export function setDisplayTimeZone(zone) {
  displayZone = isValidTimeZone(zone) ? zone : '';
  dtf = makeFormatter();
}

/** The zone times are currently shown in, as an IANA name. */
export function displayTimeZone() {
  return displayZone || deviceTimeZone();
}

/** Short form for scales and legends: "08:11" (withDate false) or "14 Mar, 08:11". Uses the display zone. */
export function formatShort(ms, withDate) {
  const opts = withDate ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
  try { return new Intl.DateTimeFormat(undefined, displayZone ? { ...opts, timeZone: displayZone } : opts).format(new Date(ms)); } catch { return formatDateTime(ms); }
}

export function formatDateTime(ms) {
  return ms === null || ms === undefined ? '—' : dtf.format(new Date(ms));
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const neg = ms < 0;
  let s = Math.round(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h && (s || !parts.length)) parts.push(`${s}s`);
  return (neg ? '-' : '') + parts.join(' ');
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

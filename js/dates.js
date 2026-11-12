// Date / time parsing for spreadsheet-style data.
// Supports ISO 8601, D/M/Y and M/D/Y (with auto-detection), YYYY/MM/DD,
// month names, Unix timestamps (s and ms), Excel serial numbers and
// separate date + time columns.

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a time-of-day string. Returns { h, m, s, ms } or null. */
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

function build(y, mo, d, t) {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const tm = t || { h: 0, m: 0, s: 0, ms: 0, tz: '' };
  const off = tzOffsetMinutes(tm.tz);
  let ms;
  if (off !== null) {
    ms = Date.UTC(y, mo, d, tm.h, tm.m, tm.s, tm.ms) - off * 60000;
  } else {
    ms = new Date(y, mo, d, tm.h, tm.m, tm.s, tm.ms).getTime();
  }
  const check = off !== null ? new Date(Date.UTC(y, mo, d)) : new Date(y, mo, d);
  const dd = off !== null ? check.getUTCDate() : check.getDate();
  if (dd !== d) return null; // e.g. 31 Feb
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
 * Parse a date or date-time value to epoch milliseconds.
 * order: 'dmy' | 'mdy' (only matters for ambiguous numeric dates)
 */
export function parseDateTime(input, order = 'dmy') {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? input.getTime() : null;
  let s = String(input).trim();
  if (!s) return null;

  // Pure number: Unix seconds / ms, or Excel serial date
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (/^\d{13}$/.test(s)) return n;               // ms
    if (/^\d{10}(\.\d+)?$/.test(s)) return n * 1000; // seconds
    if (n > 20000 && n < 80000) {                    // Excel serial (1954 – 2119)
      return Math.round((n - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000;
    }
    return null;
  }

  // ISO 8601: 2024-03-05, 2024-03-05T14:30:00Z, 2024-03-05 14:30, 20240305T143000
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T\s]+(.+))?$/);
  if (m) {
    const t = m[4] ? parseTimeOfDay(m[4].replace(/^(\d{2})(\d{2})(\d{2})/, '$1:$2:$3')) : null;
    if (m[4] && !t) return null;
    return build(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t);
  }

  // YYYY/MM/DD
  m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:[T,\s]+(.+))?$/);
  if (m) {
    const t = m[4] ? parseTimeOfDay(m[4]) : null;
    if (m[4] && !t) return null;
    return build(Number(m[1]), Number(m[2]) - 1, Number(m[3]), t);
  }

  // DD/MM/YYYY or MM/DD/YYYY (also with - or .)
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[T,\s]+(.+))?$/);
  if (m) {
    const t = m[4] ? parseTimeOfDay(m[4]) : null;
    if (m[4] && !t) return null;
    let a = Number(m[1]), b = Number(m[2]);
    let day, mon;
    if (a > 12) { day = a; mon = b; }
    else if (b > 12) { day = b; mon = a; }
    else if (order === 'mdy') { mon = a; day = b; }
    else { day = a; mon = b; }
    return build(Number(m[3]), mon - 1, day, t);
  }

  // Month names: "5 Mar 2024 14:30", "March 5, 2024 2:30 PM", "Tue 5 Mar 2024"
  s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '');
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2,4})(?:[T,\s]+(.+))?$/);
  const monthIndex = (name) => MONTHS[name.slice(0, 4).toLowerCase()] ?? MONTHS[name.slice(0, 3).toLowerCase()];
  if (m && monthIndex(m[2]) !== undefined) {
    const mon = monthIndex(m[2]);
    const t = m[4] ? parseTimeOfDay(m[4]) : null;
    if (m[4] && !t) return null;
    return build(Number(m[3]), mon, Number(m[1]), t);
  }
  m = s.match(/^([A-Za-z]{3,9})\.?[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2,4})(?:[T,\s]+(.+))?$/);
  if (m) {
    const mon = monthIndex(m[1]);
    if (mon === undefined) return null;
    const t = m[4] ? parseTimeOfDay(m[4]) : null;
    if (m[4] && !t) return null;
    return build(Number(m[3]), mon, Number(m[2]), t);
  }

  // Last resort: let the browser try (handles RFC 2822 etc.), but only for strings that
  // clearly look like a date — some browsers will "parse" almost anything with a number in it.
  if (!/\d{4}/.test(s) || !/(\d{1,2}:\d{2})|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(s)) return null;
  const fallback = Date.parse(s);
  return Number.isFinite(fallback) ? fallback : null;
}

/** Combine a date column value with a separate time column value. */
export function parseDateAndTime(dateVal, timeVal, order = 'dmy') {
  const base = parseDateTime(dateVal, order);
  if (base === null) return null;
  const t = parseTimeOfDay(timeVal);
  if (!t) return base;
  const d = new Date(base);
  const off = tzOffsetMinutes(t.tz);
  if (off !== null) {
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m, t.s, t.ms) - off * 60000;
  }
  d.setHours(t.h, t.m, t.s, t.ms);
  return d.getTime();
}

const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

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

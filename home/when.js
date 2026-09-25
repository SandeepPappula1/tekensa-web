/**
 * DATE WORDS IN THE SEARCH BOX (plan 6.1), read on the client.
 *
 * "last year", "this month", "march", "2024" typed into the one search box
 * narrow the results by the day a thing was captured, with no server call.
 * The word set is the server's own: last/this year, last/this month,
 * last/this week, yesterday, today, a month name with an optional year, and a
 * bare year 2000–2099. Nothing else is a date word here; a phrase this file
 * does not know is left in the query for the search to read.
 *
 * Pure: `parse(q, today)` returns `{ match, index, from, to, label }` or null.
 * `from` and `to` are inclusive YYYY-MM-DD days in the browser's own time.
 * `without(q, r)` gives the query back with the date words taken out, so the
 * search sees "hotels" when the person typed "hotels last year".
 *
 * A plain script that hangs its surface on `window.DUMP_WHEN`, the same as
 * `types.js`: no imports, no build step, loaded before `app.js`.
 */
(() => {
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const isoDay = (t) => iso(t.getFullYear(), t.getMonth(), t.getDate());
  const addDays = (t, n) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + n);
  const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
  const monthIndex = (w) => { const i = MONTHS.indexOf(w); if (i >= 0) return i; const s = SHORT.indexOf(w); return s < 0 ? -1 : s > 8 ? s - 1 : s; };
  const MONTH_RE = new RegExp(`\\b(${MONTHS.join('|')}|${SHORT.join('|')})\\b(?:\\s+(20\\d\\d)\\b)?`);
  const YEAR_RE = /\b(20\d\d)\b/;

  /** The one date phrase in `q`, or null. The first phrase wins; a second is left in the text. */
  function parse(q, today) {
    const t = today instanceof Date ? today : new Date();
    const s = String(q ?? '').toLowerCase();
    const y0 = t.getFullYear(), m0 = t.getMonth();
    const out = (m, from, to, label) => ({ match: m[0], index: m.index, from, to, label });
    let m;
    if ((m = /\b(last|this)\s+year\b/.exec(s))) { const y = m[1] === 'last' ? y0 - 1 : y0; return out(m, iso(y, 0, 1), iso(y, 11, 31), String(y)); }
    if ((m = /\b(last|this)\s+month\b/.exec(s))) {
      const y = m[1] === 'last' && m0 === 0 ? y0 - 1 : y0, mm = m[1] === 'last' ? (m0 + 11) % 12 : m0;
      return out(m, iso(y, mm, 1), iso(y, mm, lastDay(y, mm)), `${MONTHS[mm]} ${y}`);
    }
    if ((m = /\b(last|this)\s+week\b/.exec(s))) {
      // a week runs Monday to Sunday; "this week" ends today, "last week" is the whole one before
      const monday = addDays(t, -((t.getDay() + 6) % 7));
      return m[1] === 'this' ? out(m, isoDay(monday), isoDay(t), 'this week') : out(m, isoDay(addDays(monday, -7)), isoDay(addDays(monday, -1)), 'last week');
    }
    if ((m = /\byesterday\b/.exec(s))) { const d = isoDay(addDays(t, -1)); return out(m, d, d, 'yesterday'); }
    if ((m = /\btoday\b/.exec(s))) { const d = isoDay(t); return out(m, d, d, 'today'); }
    if ((m = MONTH_RE.exec(s))) {
      // a month with no year is the most recent one of that name: "march" in September is this year, "november" is last year's
      const mm = monthIndex(m[1]); const y = m[2] ? Number(m[2]) : (mm > m0 ? y0 - 1 : y0);
      return out(m, iso(y, mm, 1), iso(y, mm, lastDay(y, mm)), `${MONTHS[mm]} ${y}`);
    }
    if ((m = YEAR_RE.exec(s))) { const y = Number(m[1]); return out(m, iso(y, 0, 1), iso(y, 11, 31), String(y)); }
    return null;
  }

  /** `q` with the parsed words taken out, spaces tidied. */
  function without(q, r) {
    const s = String(q ?? '');
    if (!r) return s.trim();
    return (s.slice(0, r.index) + ' ' + s.slice(r.index + r.match.length)).replace(/\s+/g, ' ').trim();
  }

  /** Is the day `day` (YYYY-MM-DD) inside the range? Same-shaped strings compare as dates. */
  const inRange = (day, r) => !!r && day >= r.from && day <= r.to;

  /** The overlap of two ranges, or the one that exists. Two that do not meet give from > to, which matches nothing. */
  function intersect(a, b) {
    if (!a) return b ?? null; if (!b) return a;
    return { from: a.from > b.from ? a.from : b.from, to: a.to < b.to ? a.to : b.to, label: a.label };
  }

  window.DUMP_WHEN = { parse, without, inRange, intersect, isoDay, addDays, MONTHS };
})();

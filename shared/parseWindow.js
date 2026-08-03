// Parses PanamaCompra's window text, e.g. "31-07-2026 - 11:30 AM a 03:30 PM",
// and returns the closing (deadline) instant as a JS Date, in Panama time (UTC-5, no DST).
const RE = /(\d{2})-(\d{2})-(\d{4})\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*a\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;

function parseDeadline(windowInfo) {
  if (!windowInfo) return null;
  const m = windowInfo.match(RE);
  if (!m) return null;

  const [, day, month, year, hourStr, minute, ampm] = m;
  let hour = parseInt(hourStr, 10) % 12;
  if (/pm/i.test(ampm)) hour += 12;

  const iso = `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${minute}:00-05:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = { parseDeadline };

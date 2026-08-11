// Parses PanamaCompra's window text. Dos formatos vistos según el tipo de
// proceso: Cotización en línea da un rango, "31-07-2026 - 11:30 AM a 03:30
// PM" (se usa la hora de cierre, la segunda); Compra Menor da un solo
// límite, "25-08-2026 hasta 10:00 AM". Ambos devuelven el instante de
// cierre como JS Date, en hora de Panamá (UTC-5, sin DST).
const RE_RANGO = /(\d{2})-(\d{2})-(\d{4})\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*a\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;
const RE_HASTA = /(\d{2})-(\d{2})-(\d{4})\s*hasta\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;

function parseDeadline(windowInfo) {
  if (!windowInfo) return null;
  const m = windowInfo.match(RE_RANGO) || windowInfo.match(RE_HASTA);
  if (!m) return null;

  const [, day, month, year, hourStr, minute, ampm] = m;
  let hour = parseInt(hourStr, 10) % 12;
  if (/pm/i.test(ampm)) hour += 12;

  const iso = `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${minute}:00-05:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = { parseDeadline };

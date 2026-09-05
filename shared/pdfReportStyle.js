// Estilo visual compartido entre los reportes financieros en PDF (anual y
// por proyecto) -- un solo lugar para que ambos luzcan como el mismo
// sistema de diseño en vez de dos documentos que evolucionan distinto.
const NAVY = '#0a0a1a';
const BLUE = '#1616e6';
const BLUE_DARK = '#0d0d9e';
const GRAY = '#565873';
const GRAY_SOFT = '#8a8ca3';
const LIGHT = '#f5f6fb';
const BORDER = '#e9eaf5';
const GREEN = '#1a9c63';
const RED = '#c0392b';

function money(n) {
  return 'B/. ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "T00:00:00" fuerza a interpretar la fecha en hora LOCAL, no UTC -- sin
// esto, "2026-06-20" se interpreta como medianoche UTC, que en Panama
// (UTC-5) cae la tarde del 19, y la fecha se corre un dia hacia atras.
function fmtFecha(f) {
  if (!f) return 'Sin fecha';
  const iso = f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10);
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-PA');
}

// Encabezado de sección consistente: título + una línea delgada de acento
// debajo, en vez de solo texto en negrita suelto -- le da al documento una
// jerarquía visual más clara entre secciones.
function sectionTitle(doc, { x, y, width, title, subtitle }) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(title, x, y);
  doc.moveTo(x, y + 17).lineTo(x + 34, y + 17).strokeColor(BLUE).lineWidth(2).stroke();
  let bottom = y + 24;
  if (subtitle) {
    doc.font('Helvetica').fontSize(8).fillColor(GRAY_SOFT).text(subtitle, x, bottom, { width });
    bottom += doc.heightOfString(subtitle, { width }) + 8;
  }
  return bottom;
}

// Tarjeta de cifra destacada (usada en los resúmenes) con un acento de
// color a la izquierda en vez de solo texto de color -- más legible incluso
// impreso en blanco y negro, porque la jerarquía no depende solo del color.
function statCard(doc, { x, y, width, label, valor, color }) {
  const h = 56;
  doc.roundedRect(x, y, width, h, 8).fill(LIGHT);
  doc.rect(x, y, 4, h).fill(color);
  doc.font('Helvetica').fontSize(7.5).fillColor(GRAY_SOFT)
    .text(label.toUpperCase(), x + 16, y + 11, { characterSpacing: 0.4 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text(money(valor), x + 16, y + 25);
}

// Barras verticales con panel de fondo, líneas de referencia horizontales y
// esquinas suavizadas -- reemplaza el chart "a pelo" (solo rectángulos
// sueltos sobre blanco) por algo que se lee como una gráfica de reporte de
// verdad, no un boceto.
function drawBarChart(doc, { x, y, width, height, data, color }) {
  const panelPad = 14;
  doc.roundedRect(x, y, width, height, 8).fill('#ffffff').strokeColor(BORDER).lineWidth(1).stroke();

  const innerX = x + panelPad;
  const innerW = width - panelPad * 2;
  const innerY = y + panelPad;
  const innerH = height - panelPad * 2;

  if (!data.length) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY_SOFT)
      .text('Sin datos para graficar.', innerX, y + height / 2 - 5, { width: innerW, align: 'center' });
    return;
  }

  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const hayNegativos = data.some((d) => d.value < 0);
  const labelsH = hayNegativos ? 28 : 16;
  const plotH = innerH - labelsH;
  const baseY = hayNegativos ? innerY + plotH / 2 : innerY + plotH;
  const maxBarH = hayNegativos ? plotH / 2 - 16 : plotH - 16;

  // Líneas de referencia (25/50/75/100%) por encima de la base, suaves, para
  // que se pueda ubicar a ojo la magnitud de cada barra sin leer el número.
  [0.25, 0.5, 0.75, 1].forEach((frac) => {
    const ly = baseY - maxBarH * frac;
    doc.moveTo(innerX, ly).lineTo(innerX + innerW, ly).strokeColor('#eef0fa').lineWidth(0.75).stroke();
  });
  doc.moveTo(innerX, baseY).lineTo(innerX + innerW, baseY).strokeColor(BORDER).lineWidth(1).stroke();

  const n = data.length;
  const gap = Math.min(20, innerW / n * 0.25);
  const barW = Math.min(64, (innerW - gap * (n - 1)) / n);
  const totalBarsW = barW * n + gap * (n - 1);
  const startX = innerX + (innerW - totalBarsW) / 2;

  data.forEach((d, i) => {
    const bx = startX + i * (barW + gap);
    const barH = Math.max(2, (Math.abs(d.value) / maxAbs) * maxBarH);
    const barColor = d.value >= 0 ? color : RED;
    const radius = Math.min(4, barW / 2, barH / 2);
    if (d.value >= 0) {
      doc.roundedRect(bx, baseY - barH, barW, barH, radius).fill(barColor);
    } else {
      doc.roundedRect(bx, baseY, barW, barH, radius).fill(barColor);
    }

    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
      .text(d.label, bx - 6, baseY + (hayNegativos ? maxBarH + 8 : 8), { width: barW + 12, align: 'center' });

    const valorY = d.value >= 0 ? baseY - barH - 12 : baseY + barH + 3;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NAVY)
      .text(money(d.value), bx - 16, valorY, { width: barW + 32, align: 'center' });
  });
}

// Encabezado de tabla consistente (NAVY, esquinas redondeadas, texto con
// character spacing) -- cada archivo sigue armando sus propias filas (las
// columnas difieren entre reportes), pero el encabezado se ve igual en
// ambos.
function tableHeader(doc, { x, y, width, cols }) {
  doc.roundedRect(x, y, width, 22, 4).fill(NAVY);
  let cx = x;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
  cols.forEach((c) => {
    doc.text(c.label.toUpperCase(), cx + 8, y + 7, { width: c.w - 12, align: c.align, characterSpacing: 0.3 });
    cx += c.w;
  });
  return y + 22;
}

module.exports = { NAVY, BLUE, BLUE_DARK, GRAY, GRAY_SOFT, LIGHT, BORDER, GREEN, RED, money, fmtFecha, sectionTitle, statCard, drawBarChart, tableHeader };

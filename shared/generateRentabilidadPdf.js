// PDF del resumen de rentabilidad (mensual o anual) -- mismos números que
// la pantalla de Finanzas (ver shared/rentabilidad.js), mismo estilo que los
// demás reportes financieros (pdfReportStyle).
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { COMPANY } = require('./generateQuoteExcel');
const {
  NAVY, BLUE, GRAY, GRAY_SOFT, LIGHT, BORDER, GREEN, RED,
  money, fmtFecha, sectionTitle, statCard, tableHeader,
} = require('./pdfReportStyle');

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

// Colores fijos por concepto (no por posición) -- validados para daltonismo
// con la guía de gráficas; iguales a los de la pantalla de Finanzas.
const SEGMENTOS = [
  { key: 'gastos_proyectos', label: 'Gastos de proyectos', color: '#2a78d6' },
  { key: 'gastos_generales', label: 'Gastos generales', color: '#eb6834' },
  { key: 'ganancia', label: 'Ganancia', color: '#1baf7a' },
];

// Partes del anillo. Con ganancia, el todo son los ingresos (gastos +
// ganancia = ingresos). Con pérdida no hay "porción de ganancia" posible,
// así que el anillo muestra cómo se repartieron los gastos y el centro
// indica la pérdida.
function partesDonut(r) {
  const conGanancia = r.ganancia >= 0 && r.ingresos > 0;
  const partes = SEGMENTOS
    .filter((s) => conGanancia || s.key !== 'ganancia')
    .map((s) => ({ ...s, value: Math.max(0, r[s.key]) }))
    .filter((s) => s.value > 0);
  const total = partes.reduce((a, p) => a + p.value, 0);
  return { partes: partes.map((p) => ({ ...p, pct: total ? (p.value / total) * 100 : 0 })), total, conGanancia };
}

function pctTxt(n) {
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function drawDonut(doc, { cx, cy, R, r, partes, total }) {
  let a0 = -Math.PI / 2;
  const pt = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  for (const p of partes) {
    // Un solo segmento al 100%: un arco con mismo inicio y fin no dibuja nada.
    const sweep = Math.min((p.value / total) * Math.PI * 2, Math.PI * 2 - 0.0001);
    const a1 = a0 + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const [ox0, oy0] = pt(R, a0); const [ox1, oy1] = pt(R, a1);
    const [ix1, iy1] = pt(r, a1); const [ix0, iy0] = pt(r, a0);
    const d = `M ${ox0} ${oy0} A ${R} ${R} 0 ${large} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${r} ${r} 0 ${large} 0 ${ix0} ${iy0} Z`;
    // Borde blanco de 2pt = separación visible entre porciones.
    if (partes.length > 1) doc.path(d).lineWidth(2).fillAndStroke(p.color, '#ffffff');
    else doc.path(d).fill(p.color);
    a0 = a1;
  }
}

function generateRentabilidadPdf(r) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const marginX = 42;
    const contentW = pageW - marginX * 2;
    const pageBottom = doc.page.height - 50;
    const nuevaPaginaSi = (alto) => { if (y + alto > pageBottom) { doc.addPage(); y = 40; } };

    // ===== Header =====
    const headerH = 112;
    doc.rect(0, headerH - 5, pageW, 5).fill(BLUE);
    if (fs.existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, marginX, 16, { height: 80 }); } catch (e) { /* logo opcional */ }
    }
    doc.font('Helvetica').fontSize(8).fillColor(GRAY_SOFT)
      .text(r.periodo.mes ? 'REPORTE DE RENTABILIDAD MENSUAL' : 'REPORTE DE RENTABILIDAD ANUAL', 0, 30, { align: 'right', width: pageW - marginX, characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(22).fillColor(NAVY)
      .text(r.periodo.label, 0, 42, { align: 'right', width: pageW - marginX });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(COMPANY.nombre, 0, 74, { align: 'right', width: pageW - marginX });
    doc.text(`Generado el ${fmtFecha(new Date())}`, 0, 86, { align: 'right', width: pageW - marginX });

    let y = headerH + 22;

    // ===== Resumen =====
    y = sectionTitle(doc, {
      x: marginX, y, width: contentW, title: 'Resumen del período',
      subtitle: 'Todos los montos son SIN ITBM (subtotal de cada factura): el ITBM se cobra y se paga a la DGI, no es ganancia ni costo de la empresa.',
    });
    const boxW = (contentW - 20) / 3;
    statCard(doc, { x: marginX, y, width: boxW, label: 'Ingresos', valor: r.ingresos, color: GREEN });
    statCard(doc, { x: marginX + boxW + 10, y, width: boxW, label: 'Gastos', valor: r.gastos, color: RED });
    statCard(doc, { x: marginX + (boxW + 10) * 2, y, width: boxW, label: r.ganancia >= 0 ? 'Ganancia' : 'Pérdida', valor: r.ganancia, color: r.ganancia >= 0 ? BLUE : RED });
    y += 56 + 10;
    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY)
      .text(`${r.ingresos_detalle.length} factura(s) emitida(s) · ${r.gastos_detalle.length} gasto(s) · Gastos de proyectos ${money(r.gastos_proyectos)} · Gastos generales ${money(r.gastos_generales)}`, marginX, y, { width: contentW });
    y += 26;

    // ===== Gráfica de rentabilidad =====
    const { partes, total, conGanancia } = partesDonut(r);
    y = sectionTitle(doc, {
      x: marginX, y, width: contentW, title: 'Rentabilidad',
      subtitle: conGanancia
        ? 'De cada balboa que entró: cuánto se fue en gastos de proyectos, cuánto en gastos generales y cuánto quedó de ganancia. Al centro, el margen (ganancia ÷ ingresos).'
        : 'El período no dejó ganancia: el anillo muestra cómo se repartieron los gastos; al centro, la pérdida.',
    });
    const donutH = 170;
    if (!total) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('No hay ingresos ni gastos en este período.', marginX, y);
      y += 24;
    } else {
      const R = 75, rIn = 47;
      const cx = marginX + 20 + R, cy = y + R + 5;
      drawDonut(doc, { cx, cy, R, r: rIn, partes, total });
      const centro = r.margen == null ? 'Sin ingresos' : pctTxt(r.margen);
      doc.font('Helvetica-Bold').fontSize(r.margen == null ? 10 : 16).fillColor(r.ganancia >= 0 ? NAVY : RED)
        .text(centro, cx - rIn, cy - 12, { width: rIn * 2, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY_SOFT)
        .text(conGanancia ? 'margen' : `pérdida ${money(-r.ganancia)}`, cx - rIn, cy + 7, { width: rIn * 2, align: 'center' });

      // Leyenda con nombre, monto y % (no depende solo del color).
      let ly = y + 30;
      const lx = cx + R + 50;
      for (const p of partes) {
        doc.roundedRect(lx, ly + 1, 10, 10, 2).fill(p.color);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(p.label, lx + 18, ly);
        doc.font('Helvetica').fontSize(9).fillColor(GRAY)
          .text(`${money(p.value)}  ·  ${pctTxt(p.pct)}`, lx + 18, ly + 13);
        ly += 36;
      }
      y += donutH + 10;
    }

    // ===== Mes a mes (solo anual) =====
    if (r.por_mes) {
      nuevaPaginaSi(80);
      y = sectionTitle(doc, { x: marginX, y, width: contentW, title: 'Mes a mes' });
      const cols = [
        { label: 'Mes', w: contentW - 100 * 3 - 70, align: 'left' },
        { label: 'Ingresos', w: 100, align: 'right' },
        { label: 'Gastos', w: 100, align: 'right' },
        { label: 'Ganancia', w: 100, align: 'right' },
        { label: 'Margen', w: 70, align: 'right' },
      ];
      y = tableHeader(doc, { x: marginX, y, width: contentW, cols });
      const fila = (vals, idx, bold) => {
        if (!bold && idx % 2 === 1) doc.rect(marginX, y, contentW, 18).fill(LIGHT);
        let cx = marginX;
        vals.forEach((v, i) => {
          const esGanancia = i === 3 || i === 4;
          const negativo = esGanancia && typeof v.n === 'number' && v.n < 0;
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(negativo ? RED : '#10101f')
            .text(v.t, cx + 8, y + 5, { width: cols[i].w - 12, align: cols[i].align });
          cx += cols[i].w;
        });
        y += 18;
      };
      r.por_mes.forEach((p, idx) => {
        nuevaPaginaSi(18);
        fila([
          { t: p.nombre }, { t: money(p.ingresos) }, { t: money(p.gastos) },
          { t: money(p.ganancia), n: p.ganancia }, { t: p.margen == null ? '—' : pctTxt(p.margen), n: p.margen },
        ], idx, false);
      });
      doc.moveTo(marginX, y).lineTo(marginX + contentW, y).strokeColor(BLUE).lineWidth(1.3).stroke();
      y += 2;
      fila([
        { t: 'TOTAL' }, { t: money(r.ingresos) }, { t: money(r.gastos) },
        { t: money(r.ganancia), n: r.ganancia }, { t: r.margen == null ? '—' : pctTxt(r.margen), n: r.margen },
      ], 0, true);
      y += 18;
    }

    // ===== Detalle de facturas =====
    const tablaFacturas = (titulo, facturas, etiqueta) => {
      nuevaPaginaSi(80);
      y = sectionTitle(doc, { x: marginX, y, width: contentW, title: `${titulo} (${facturas.length})` });
      if (!facturas.length) {
        doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('No hay facturas en este período.', marginX, y);
        y += 26;
        return;
      }
      const cols = [
        { label: 'Fecha', w: 62, align: 'left' },
        { label: etiqueta, w: contentW - 62 - 70 - 120 - 95, align: 'left' },
        { label: '# Factura', w: 70, align: 'left' },
        { label: 'Proyecto', w: 120, align: 'left' },
        { label: 'Sin ITBM', w: 95, align: 'right' },
      ];
      y = tableHeader(doc, { x: marginX, y, width: contentW, cols });
      facturas.forEach((f, idx) => {
        if (y + 18 > pageBottom) { doc.addPage(); y = 40; y = tableHeader(doc, { x: marginX, y, width: contentW, cols }); }
        if (idx % 2 === 1) doc.rect(marginX, y, contentW, 18).fill(LIGHT);
        const vals = [fmtFecha(f.fecha), f.contraparte, f.numero_factura, (f.proyecto || (f.tipo === 'emitida' ? 'Sin proyecto' : 'Gasto general')), money(f.monto)];
        let cx = marginX;
        vals.forEach((v, i) => {
          doc.font('Helvetica').fontSize(8).fillColor('#10101f')
            .text(String(v || ''), cx + 8, y + 5, { width: cols[i].w - 12, align: cols[i].align, height: 10, ellipsis: true, lineBreak: false });
          cx += cols[i].w;
        });
        y += 18;
      });
      doc.moveTo(marginX, y).lineTo(marginX + contentW, y).strokeColor(BLUE).lineWidth(1.3).stroke();
      y += 6;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY)
        .text(`TOTAL ${money(facturas.reduce((s, f) => s + f.monto, 0))}`, marginX, y, { width: contentW - 4, align: 'right' });
      y += 28;
    };
    tablaFacturas('Ingresos', r.ingresos_detalle, 'Cliente');
    tablaFacturas('Gastos', r.gastos_detalle, 'Proveedor');

    // ===== Footer en cada página =====
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 30;
      doc.moveTo(marginX, footerY - 8).lineTo(pageW - marginX, footerY - 8).strokeColor(BORDER).lineWidth(0.75).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
        .text(`${COMPANY.nombre} — Rentabilidad ${r.periodo.label}`, marginX, footerY, { width: contentW - 60, lineBreak: false });
      doc.text(`Página ${i - rango.start + 1} de ${rango.count}`, pageW - marginX - 60, footerY, { width: 60, align: 'right', lineBreak: false });
    }

    doc.end();
  });
}

module.exports = { generateRentabilidadPdf };

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { COMPANY } = require('./generateQuoteExcel');
const {
  NAVY, BLUE, GRAY, LIGHT, BORDER, GREEN, RED,
  money, fmtFecha, sectionTitle, statCard, drawBarChart, tableHeader,
} = require('./pdfReportStyle');

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

// facturas: filas crudas de finance_invoices (tipo 'emitida' o 'gasto') ya
// filtradas por proyecto -- este modulo solo arma el documento, no consulta
// la base de datos (eso lo hace el endpoint en server/index.js).
function generateProjectReportPdf({ proyecto, facturas }) {
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

    const emitidas = facturas.filter((f) => f.tipo === 'emitida').sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));
    const gastos = facturas.filter((f) => f.tipo === 'gasto').sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));
    const totalEmitido = emitidas.reduce((s, f) => s + Number(f.total || 0), 0);
    const totalGastos = gastos.reduce((s, f) => s + Number(f.total || 0), 0);
    const ganancia = totalEmitido - totalGastos;

    // ===== Header =====
    const headerH = 112;
    doc.rect(0, 0, pageW, headerH).fill('#ffffff');
    doc.rect(0, headerH - 5, pageW, 5).fill(BLUE);
    if (fs.existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, marginX, 16, { height: 80 }); } catch (e) { /* logo opcional */ }
    }
    doc.font('Helvetica').fontSize(8).fillColor('#8a8ca3')
      .text('REPORTE FINANCIERO DE PROYECTO', 0, 26, { align: 'right', width: pageW - marginX, characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(19).fillColor(NAVY)
      .text(proyecto, 0, 38, { align: 'right', width: pageW - marginX });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(COMPANY.nombre, 0, 68, { align: 'right', width: pageW - marginX });
    doc.text(`Generado el ${fmtFecha(new Date())}`, 0, 80, { align: 'right', width: pageW - marginX });

    let y = headerH + 22;

    // ===== Resumen =====
    y = sectionTitle(doc, {
      x: marginX, y, width: contentW, title: 'Resumen del proyecto',
      subtitle: `${emitidas.length} factura(s) emitida(s) y ${gastos.length} gasto(s) registrado(s). Utilidad = Facturado menos Gastos.`,
    });
    const boxW = (contentW - 20) / 3;
    statCard(doc, { x: marginX, y, width: boxW, label: 'Facturado', valor: totalEmitido, color: GREEN });
    statCard(doc, { x: marginX + boxW + 10, y, width: boxW, label: 'Gastos', valor: totalGastos, color: RED });
    statCard(doc, { x: marginX + (boxW + 10) * 2, y, width: boxW, label: 'Utilidad', valor: ganancia, color: ganancia >= 0 ? BLUE : RED });
    y += 56 + 22;

    const chartH = 150;
    drawBarChart(doc, {
      x: marginX, y, width: contentW, height: chartH,
      data: [
        { label: 'Facturado', value: totalEmitido },
        { label: 'Gastos', value: -totalGastos },
        { label: 'Utilidad', value: ganancia },
      ],
      color: BLUE,
    });
    y += chartH + 26;

    // ===== Tabla genérica reutilizada para emitidas y gastos =====
    function tablaFacturas(titulo, lista, colorTotal) {
      if (y + 70 > pageBottom) { doc.addPage(); y = 40; }
      y = sectionTitle(doc, { x: marginX, y, width: contentW, title: titulo });

      if (!lista.length) {
        doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin registros.', marginX, y);
        return y + 20;
      }

      const cols = [
        { label: 'Fecha', w: 68, align: 'left' },
        { label: 'Contraparte', w: contentW - 68 - 90 - 90, align: 'left' },
        { label: '# Factura', w: 90, align: 'left' },
        { label: 'Total', w: 90, align: 'right' },
      ];
      y = tableHeader(doc, { x: marginX, y, width: contentW, cols });

      let total = 0;
      lista.forEach((f, idx) => {
        if (y + 18 > pageBottom) { doc.addPage(); y = 40; y = tableHeader(doc, { x: marginX, y, width: contentW, cols }); }
        if (idx % 2 === 1) doc.rect(marginX, y, contentW, 18).fill(LIGHT);
        let cx = marginX;
        doc.font('Helvetica').fontSize(8.5).fillColor('#10101f');
        doc.text(fmtFecha(f.fecha), cx + 8, y + 5, { width: cols[0].w - 12 }); cx += cols[0].w;
        doc.text(f.contraparte || '(sin nombre)', cx + 8, y + 5, { width: cols[1].w - 12 }); cx += cols[1].w;
        doc.text(f.numero_factura || '-', cx + 8, y + 5, { width: cols[2].w - 12 }); cx += cols[2].w;
        doc.text(money(f.total), cx + 8, y + 5, { width: cols[3].w - 12, align: 'right' });
        total += Number(f.total || 0);
        y += 18;
      });
      doc.moveTo(marginX, y).lineTo(marginX + contentW, y).strokeColor(BLUE).lineWidth(1.3).stroke();
      y += 6;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colorTotal)
        .text(`TOTAL: ${money(total)}`, marginX, y, { width: contentW, align: 'right' });
      return y + 28;
    }

    y = tablaFacturas('Facturas emitidas', emitidas, GREEN);
    tablaFacturas('Gastos', gastos, RED);

    // ===== Footer =====
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 30;
      doc.moveTo(marginX, footerY - 8).lineTo(pageW - marginX, footerY - 8).strokeColor(BORDER).lineWidth(0.75).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
        .text(`${COMPANY.nombre} — Reporte de proyecto: ${proyecto}`, marginX, footerY, { width: contentW - 60 });
      doc.text(`Página ${i - rango.start + 1} de ${rango.count}`, pageW - marginX - 60, footerY, { width: 60, align: 'right' });
    }

    doc.end();
  });
}

module.exports = { generateProjectReportPdf };

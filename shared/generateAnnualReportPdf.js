const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { COMPANY } = require('./generateQuoteExcel');
const {
  NAVY, BLUE, GRAY, LIGHT, BORDER, GREEN, RED,
  money, fmtFecha, sectionTitle, statCard, drawBarChart, tableHeader,
} = require('./pdfReportStyle');

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function generateAnnualReportPdf(resumen) {
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

    // ===== Header =====
    const headerH = 112;
    doc.rect(0, 0, pageW, headerH).fill('#ffffff');
    doc.rect(0, headerH - 5, pageW, 5).fill(BLUE);
    if (fs.existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, marginX, 16, { height: 80 }); } catch (e) { /* logo opcional */ }
    }
    doc.font('Helvetica').fontSize(8).fillColor('#8a8ca3')
      .text('REPORTE FINANCIERO ANUAL', 0, 30, { align: 'right', width: pageW - marginX, characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(24).fillColor(NAVY)
      .text(String(resumen.anio), 0, 40, { align: 'right', width: pageW - marginX });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(COMPANY.nombre, 0, 74, { align: 'right', width: pageW - marginX });
    doc.text(`Generado el ${fmtFecha(new Date())}`, 0, 86, { align: 'right', width: pageW - marginX });

    let y = headerH + 22;

    // ===== Estado de Resultados resumido =====
    y = sectionTitle(doc, {
      x: marginX, y, width: contentW, title: 'Estado de Resultados — Resumen del año',
      subtitle: `Ingresos totales: suma de todas las facturas emitidas en el año. Gastos totales: ${money(resumen.total_gastos - resumen.total_gastos_generales)} en proyectos identificados más ${money(resumen.total_gastos_generales)} en gastos generales de operación. Utilidad neta = Ingresos totales menos Gastos totales.`,
    });

    const boxW = (contentW - 20) / 3;
    statCard(doc, { x: marginX, y, width: boxW, label: 'Ingresos totales', valor: resumen.total_emitido, color: GREEN });
    statCard(doc, { x: marginX + boxW + 10, y, width: boxW, label: 'Gastos totales', valor: resumen.total_gastos, color: RED });
    statCard(doc, { x: marginX + (boxW + 10) * 2, y, width: boxW, label: 'Utilidad neta', valor: resumen.ganancia, color: resumen.ganancia >= 0 ? BLUE : RED });
    y += 56 + 26;

    // ===== Panorama anual =====
    y = sectionTitle(doc, {
      x: marginX, y, width: contentW, title: 'Panorama anual',
      subtitle: 'Vista rápida de las tres cifras clave del año, para comparar de un vistazo sin tener que leer el detalle.',
    });
    const panoramaH = 150;
    drawBarChart(doc, {
      x: marginX, y, width: contentW, height: panoramaH,
      data: [
        { label: 'Ingresos', value: resumen.total_emitido },
        { label: 'Gastos', value: -resumen.total_gastos },
        { label: 'Utilidad neta', value: resumen.ganancia },
      ],
      color: BLUE,
    });
    y += panoramaH + 28;

    // ===== Tabla + gráfica: utilidad por proyecto =====
    if (y + 70 > pageBottom) { doc.addPage(); y = 40; }
    y = sectionTitle(doc, {
      x: marginX, y, width: contentW, title: 'Utilidad por proyecto',
      subtitle: 'Ingresos y gastos identificados a un proyecto específico, y la utilidad que dejó cada uno. Un proyecto en rojo costó más de lo que facturó.',
    });

    const proyectos = resumen.por_proyecto || [];
    if (!proyectos.length) {
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('No hay facturas asociadas a un proyecto todavía.', marginX, y);
      y += 20;
    } else {
      const cols = [
        { label: 'Proyecto', w: contentW - 90 * 3, align: 'left' },
        { label: 'Emitido', w: 90, align: 'right' },
        { label: 'Gastos', w: 90, align: 'right' },
        { label: 'Ganancia', w: 90, align: 'right' },
      ];
      y = tableHeader(doc, { x: marginX, y, width: contentW, cols });

      let totEmitido = 0, totGasto = 0, totGanancia = 0;
      proyectos.forEach((p, idx) => {
        if (y + 18 > pageBottom) { doc.addPage(); y = 40; y = tableHeader(doc, { x: marginX, y, width: contentW, cols }); }
        if (idx % 2 === 1) doc.rect(marginX, y, contentW, 18).fill(LIGHT);
        let cx = marginX;
        doc.font('Helvetica').fontSize(8.5).fillColor('#10101f');
        doc.text(p.proyecto, cx + 8, y + 5, { width: cols[0].w - 12, align: 'left' }); cx += cols[0].w;
        doc.text(money(p.emitida), cx + 8, y + 5, { width: cols[1].w - 12, align: 'right' }); cx += cols[1].w;
        doc.text(money(p.gasto), cx + 8, y + 5, { width: cols[2].w - 12, align: 'right' }); cx += cols[2].w;
        doc.fillColor(p.ganancia >= 0 ? GREEN : RED)
          .text(money(p.ganancia), cx + 8, y + 5, { width: cols[3].w - 12, align: 'right' });
        totEmitido += p.emitida; totGasto += p.gasto; totGanancia += p.ganancia;
        y += 18;
      });
      doc.moveTo(marginX, y).lineTo(marginX + contentW, y).strokeColor(BLUE).lineWidth(1.3).stroke();
      y += 6;
      let cx = marginX;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY);
      doc.text('TOTAL', cx + 8, y, { width: cols[0].w - 12 }); cx += cols[0].w;
      doc.text(money(totEmitido), cx + 8, y, { width: cols[1].w - 12, align: 'right' }); cx += cols[1].w;
      doc.text(money(totGasto), cx + 8, y, { width: cols[2].w - 12, align: 'right' }); cx += cols[2].w;
      doc.fillColor(totGanancia >= 0 ? GREEN : RED).text(money(totGanancia), cx + 8, y, { width: cols[3].w - 12, align: 'right' });
      y += 24;

      const chartH = 160;
      if (y + chartH > pageBottom) { doc.addPage(); y = 40; }
      const datosProyectos = proyectos.map((p) => ({
        label: p.proyecto.length > 14 ? p.proyecto.slice(0, 13) + '…' : p.proyecto,
        value: p.ganancia,
      }));
      drawBarChart(doc, { x: marginX, y, width: contentW, height: chartH, data: datosProyectos, color: BLUE });
      y += chartH + 30;
    }

    // ===== Tabla + gráfica: gastos generales por mes =====
    if (y + 230 > pageBottom) { doc.addPage(); y = 40; }
    y = sectionTitle(doc, {
      x: marginX, y, width: contentW, title: 'Gastos generales por mes',
      subtitle: 'Gastos operativos que no se asociaron a ningún proyecto puntual (arriendo, planilla, servicios, etc.) — útil para ver la carga de gasto fijo mes a mes, aparte de lo que cuesta cada proyecto.',
    });

    const porMes = {};
    (resumen.gastos_generales_por_mes || []).forEach((r) => { porMes[r.mes] = r.total; });
    const datosMeses = MESES.map((label, idx) => {
      const mesKey = `${resumen.anio}-${String(idx + 1).padStart(2, '0')}`;
      return { label, value: porMes[mesKey] || 0 };
    });

    const chartHMeses = 160;
    drawBarChart(doc, { x: marginX, y, width: contentW, height: chartHMeses, data: datosMeses, color: RED });
    y += chartHMeses + 22;

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY)
      .text(`Total gastos generales del año: ${money(resumen.total_gastos_generales)}`, marginX, y);

    // ===== Footer en cada página =====
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 30;
      doc.moveTo(marginX, footerY - 8).lineTo(pageW - marginX, footerY - 8).strokeColor(BORDER).lineWidth(0.75).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
        .text(`${COMPANY.nombre} — Reporte anual ${resumen.anio}`, marginX, footerY, { width: contentW - 60 });
      doc.text(`Página ${i - rango.start + 1} de ${rango.count}`, pageW - marginX - 60, footerY, { width: 60, align: 'right' });
    }

    doc.end();
  });
}

module.exports = { generateAnnualReportPdf };

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { COMPANY } = require('./generateQuoteExcel');

const NAVY = '#0a0a1a';
const BLUE = '#1616e6';
const GRAY = '#565873';
const LIGHT = '#f5f6fb';
const GREEN = '#1fa971';
const RED = '#c0392b';

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function money(n) {
  return 'B/. ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Barras verticales genéricas -- una barra por dato, positiva hacia arriba
// desde una línea base, negativa hacia abajo (ganancia por proyecto puede
// dar negativo si un proyecto costó más de lo que se facturó). Se usa tanto
// para "ganancia por proyecto" como para "gastos generales por mes".
function drawBarChart(doc, { x, y, width, height, data, color }) {
  const n = data.length;
  if (!n) {
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sin datos para graficar.', x, y + height / 2 - 5, { width, align: 'center' });
    return;
  }
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const hayNegativos = data.some((d) => d.value < 0);
  // Con negativos, la linea base va a la mitad (mitad para positivos, mitad
  // para negativos); sin negativos, la base va abajo del todo y toda la
  // altura es para valores positivos.
  const baseY = hayNegativos ? y + height / 2 : y + height;
  const maxBarH = hayNegativos ? height / 2 - 14 : height - 14;

  const gap = 8;
  const barW = (width - gap * (n - 1)) / n;

  doc.moveTo(x, baseY).lineTo(x + width, baseY).strokeColor('#dfe1ee').lineWidth(1).stroke();

  data.forEach((d, i) => {
    const bx = x + i * (barW + gap);
    const barH = Math.max(1, (Math.abs(d.value) / maxAbs) * maxBarH);
    const barY = d.value >= 0 ? baseY - barH : baseY;
    const barColor = d.value >= 0 ? color : RED;
    doc.rect(bx, barY, barW, barH).fill(barColor);

    doc.font('Helvetica').fontSize(6.5).fillColor(GRAY)
      .text(d.label, bx - 2, baseY + (hayNegativos ? maxBarH + 4 : 4), { width: barW + 4, align: 'center' });

    const valorY = d.value >= 0 ? barY - 9 : baseY + barH + 2;
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(NAVY)
      .text(money(d.value).replace('B/. ', ''), bx - 6, valorY, { width: barW + 12, align: 'center' });
  });
}

function generateAnnualReportPdf(resumen) {
  return new Promise((resolve, reject) => {
    // bufferPages:true es obligatorio para poder numerar paginas al final
    // (doc.switchToPage + doc.bufferedPageRange) -- sin esto, PDFKit escribe
    // cada pagina de una vez y bufferedPageRange().count siempre da 1,
    // aunque el documento tenga varias paginas.
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const marginX = 42;
    const contentW = pageW - marginX * 2;

    // ===== Header =====
    const headerH = 110;
    doc.rect(0, 0, pageW, headerH).fill('#ffffff');
    doc.rect(0, headerH - 4, pageW, 4).fill(BLUE);
    if (fs.existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, marginX, 14, { height: 82 }); } catch (e) { /* logo opcional */ }
    }
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22)
      .text(`REPORTE ANUAL ${resumen.anio}`, 0, 36, { align: 'right', width: pageW - marginX });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(COMPANY.nombre, 0, 62, { align: 'right', width: pageW - marginX });
    doc.text(`Generado el ${new Date().toLocaleDateString('es-PA')}`, 0, 76, { align: 'right', width: pageW - marginX });

let y = headerH + 20;

    // ===== Estado de Resultados resumido (3 cajas) =====
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Estado de Resultados — Resumen del año', marginX, y);
    y += 18;

    const boxW = (contentW - 20) / 3;
    function resumenBox(x, label, valor, color) {
      doc.roundedRect(x, y, boxW, 52, 6).fill(LIGHT);
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(label.toUpperCase(), x + 12, y + 10);
      doc.font('Helvetica-Bold').fontSize(15).fillColor(color).text(money(valor), x + 12, y + 24);
    }
    resumenBox(marginX, 'Ingresos totales', resumen.total_emitido, GREEN);
    resumenBox(marginX + boxW + 10, 'Gastos totales', resumen.total_gastos, RED);
    resumenBox(marginX + (boxW + 10) * 2, 'Utilidad neta', resumen.ganancia, resumen.ganancia >= 0 ? BLUE : RED);
    y += 66;

    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
      `Ingresos totales: suma de todas las facturas emitidas en el año. Gastos totales: ${money(resumen.total_gastos - resumen.total_gastos_generales)} en proyectos identificados más ${money(resumen.total_gastos_generales)} en gastos generales de operación (no asociados a un proyecto puntual). Utilidad neta = Ingresos totales menos Gastos totales.`,
      marginX, y, { width: contentW }
    );
    y += 30;

    // ===== Panorama anual: Ingresos vs Gastos vs Utilidad =====
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Panorama anual', marginX, y);
    y += 6;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
      'Vista rápida de las tres cifras clave del año, para comparar de un vistazo sin tener que leer el detalle.',
      marginX, y + 12, { width: contentW }
    );
    y += 28;
    const panoramaH = 130;
    drawBarChart(doc, {
      x: marginX, y, width: contentW, height: panoramaH,
      data: [
        { label: 'Ingresos', value: resumen.total_emitido },
        { label: 'Gastos', value: -resumen.total_gastos },
        { label: 'Utilidad neta', value: resumen.ganancia },
      ],
      color: BLUE,
    });
    y += panoramaH + 26;

    // ===== Tabla + gráfica: ganancia por proyecto =====
    if (y + 60 > doc.page.height - 60) { doc.addPage(); y = 40; }
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Utilidad por proyecto', marginX, y);
    y += 6;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
      'Ingresos y gastos identificados a un proyecto específico, y la utilidad que dejó cada uno. Un proyecto en rojo costó más de lo que facturó.',
      marginX, y + 12, { width: contentW }
    );
    y += 28;

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
      doc.rect(marginX, y, contentW, 20).fill(NAVY);
      let x = marginX;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      cols.forEach((c) => { doc.text(c.label, x + 6, y + 6, { width: c.w - 10, align: c.align }); x += c.w; });
      y += 20;

      let totEmitido = 0, totGasto = 0, totGanancia = 0;
      proyectos.forEach((p, idx) => {
        if (idx % 2 === 1) doc.rect(marginX, y, contentW, 18).fill(LIGHT);
        let cx = marginX;
        doc.font('Helvetica').fontSize(8.5).fillColor('#10101f');
        doc.text(p.proyecto, cx + 6, y + 5, { width: cols[0].w - 10, align: 'left' }); cx += cols[0].w;
        doc.text(money(p.emitida), cx + 6, y + 5, { width: cols[1].w - 10, align: 'right' }); cx += cols[1].w;
        doc.text(money(p.gasto), cx + 6, y + 5, { width: cols[2].w - 10, align: 'right' }); cx += cols[2].w;
        doc.fillColor(p.ganancia >= 0 ? GREEN : RED)
          .text(money(p.ganancia), cx + 6, y + 5, { width: cols[3].w - 10, align: 'right' });
        totEmitido += p.emitida; totGasto += p.gasto; totGanancia += p.ganancia;
        y += 18;
      });
      doc.moveTo(marginX, y).lineTo(marginX + contentW, y).strokeColor(BLUE).lineWidth(1.2).stroke();
      y += 4;
      let cx = marginX;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY);
      doc.text('TOTAL', cx + 6, y + 3, { width: cols[0].w - 10 }); cx += cols[0].w;
      doc.text(money(totEmitido), cx + 6, y + 3, { width: cols[1].w - 10, align: 'right' }); cx += cols[1].w;
      doc.text(money(totGasto), cx + 6, y + 3, { width: cols[2].w - 10, align: 'right' }); cx += cols[2].w;
      doc.fillColor(totGanancia >= 0 ? GREEN : RED).text(money(totGanancia), cx + 6, y + 3, { width: cols[3].w - 10, align: 'right' });
      y += 24;

      // Gráfica: si hay muchos proyectos, salta de página para que la
      // gráfica no se corte a la mitad.
      const chartH = 150;
      if (y + chartH > doc.page.height - 60) { doc.addPage(); y = 40; }
      const datosProyectos = proyectos.map((p) => ({
        label: p.proyecto.length > 14 ? p.proyecto.slice(0, 13) + '…' : p.proyecto,
        value: p.ganancia,
      }));
      drawBarChart(doc, { x: marginX, y, width: contentW, height: chartH, data: datosProyectos, color: BLUE });
      y += chartH + 30;
    }

    // ===== Tabla + gráfica: gastos generales por mes =====
    if (y + 220 > doc.page.height - 60) { doc.addPage(); y = 40; }
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text('Gastos generales por mes', marginX, y);
    y += 6;
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
      'Gastos operativos que no se asociaron a ningún proyecto puntual (arriendo, planilla, servicios, etc.) — útil para ver la carga de gasto fijo mes a mes, aparte de lo que cuesta cada proyecto.',
      marginX, y + 12, { width: contentW }
    );
    y += 30;

    const porMes = {};
    (resumen.gastos_generales_por_mes || []).forEach((r) => { porMes[r.mes] = r.total; });
    const datosMeses = MESES.map((label, idx) => {
      const mesKey = `${resumen.anio}-${String(idx + 1).padStart(2, '0')}`;
      return { label, value: porMes[mesKey] || 0 };
    });

    const chartHMeses = 150;
    drawBarChart(doc, { x: marginX, y, width: contentW, height: chartHMeses, data: datosMeses, color: RED });
    y += chartHMeses + 20;

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY)
      .text(`Total gastos generales del año: ${money(resumen.total_gastos_generales)}`, marginX, y);

    // ===== Footer en cada página =====
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 30;
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
        .text(`${COMPANY.nombre} — Reporte anual ${resumen.anio}`, marginX, footerY, { width: contentW - 60 });
      doc.text(`Página ${i - rango.start + 1} de ${rango.count}`, pageW - marginX - 60, footerY, { width: 60, align: 'right' });
    }

    doc.end();
  });
}

module.exports = { generateAnnualReportPdf };

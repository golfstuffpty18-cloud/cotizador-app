const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const NAVY = '#0a0a1a';
const BLUE = '#1616e6';
const GRAY = '#565873';
const LIGHT = '#f5f6fb';

const COMPANY = {
  nombre: 'GS TECHNOLOGIES INVESTMENTS, S.A.',
  direccion: 'Llano Bonito, Calle Francisco Rodríguez, Casa 5285',
  telefono: '6948-1130',
  ruc: '155667603-2-2018 DV 95',
  correo: 'd.sanchezv@gstechnologiespty.com',
};

const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

function money(n) {
  return 'B/. ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function generateQuotePdf({ quote, opportunity }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const marginX = 42;

    // ===== Header =====
    const headerH = 136;
    doc.rect(0, 0, pageW, headerH).fill('#ffffff');
    doc.rect(0, headerH - 4, pageW, 4).fill(BLUE);
    if (fs.existsSync(LOGO_PATH)) {
      try { doc.image(LOGO_PATH, marginX, 14, { height: 106 }); } catch (e) {}
    }
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22)
      .text('COTIZACIÓN', 0, 43, { align: 'right', width: pageW - marginX });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(`Fecha: ${new Date().toLocaleDateString('es-PA')}`, 0, 71, { align: 'right', width: pageW - marginX });
    if (opportunity && opportunity.act_number) {
      doc.text(`Proceso PanamaCompra: ${opportunity.act_number}`, 0, 85, { align: 'right', width: pageW - marginX });
    }

    // ===== Company block =====
    let y = headerH + 16;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text(COMPANY.nombre, marginX, y);
    y += 15;
    doc.fillColor(GRAY).font('Helvetica').fontSize(8.5);
    doc.text(`${COMPANY.direccion}  |  Tel: ${COMPANY.telefono}`, marginX, y); y += 12;
    doc.text(`RUC: ${COMPANY.ruc}  |  ${COMPANY.correo}`, marginX, y); y += 20;

    // ===== Client box =====
    doc.roundedRect(marginX, y, pageW - marginX * 2, 62, 6).fill(LIGHT);
    const boxY = y + 10;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('CLIENTE', marginX + 14, boxY);
    doc.font('Helvetica').fontSize(9).fillColor('#10101f');
    doc.text(quote.cliente_nombre || '-', marginX + 14, boxY + 13, { width: pageW - marginX * 2 - 28 });
    doc.fontSize(8.5).fillColor(GRAY);
    const clienteLinea2 = [quote.cliente_direccion, quote.cliente_ciudad].filter(Boolean).join(', ');
    doc.text(clienteLinea2 || '-', marginX + 14, boxY + 28, { width: pageW - marginX * 2 - 28 });
    if (quote.cliente_ruc) doc.text(`RUC: ${quote.cliente_ruc}`, marginX + 14, boxY + 41);
    doc.text(`Forma de pago: ${quote.forma_pago || 'Crédito'}`, marginX + 300, boxY + 41);
    y += 78;

    // ===== Items table =====
    const items = Array.isArray(quote.items) ? quote.items : [];
    const cols = [
      { key: 'renglon', label: '#', w: 24, align: 'center' },
      { key: 'descripcion', label: 'Descripción', w: 232, align: 'left' },
      { key: 'cantidad', label: 'Cant.', w: 40, align: 'center' },
      { key: 'unidad', label: 'Unidad', w: 60, align: 'center' },
      { key: 'precioUnitario', label: 'Precio Un.', w: 65, align: 'right' },
      { key: 'subtotal', label: 'Subtotal', w: 65, align: 'right' },
    ];
    const tableW = cols.reduce((s, c) => s + c.w, 0);

    function tableHeader() {
      doc.rect(marginX, y, tableW, 22).fill(NAVY);
      let x = marginX;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
      for (const c of cols) {
        doc.text(c.label, x + 4, y + 7, { width: c.w - 8, align: c.align });
        x += c.w;
      }
      y += 22;
    }

    tableHeader();

    doc.font('Helvetica').fontSize(8.5);
    items.forEach((item, idx) => {
      const cantidad = Number(item.cantidad) || 0;
      const precioUnitario = Number(item.precioUnitario) || 0;
      const subtotal = cantidad * precioUnitario;

      const rowLines = doc.heightOfString(item.descripcion || '', { width: cols[1].w - 8 });
      const rowH = Math.max(20, rowLines + 8);

      if (y + rowH > doc.page.height - 130) {
        doc.addPage();
        y = 40;
        tableHeader();
      }

      if (idx % 2 === 1) doc.rect(marginX, y, tableW, rowH).fill(LIGHT);

      let x = marginX;
      doc.fillColor('#10101f');
      doc.text(String(item.numRenglon ?? idx + 1), x + 4, y + 6, { width: cols[0].w - 8, align: 'center' }); x += cols[0].w;
      doc.text(item.descripcion || '', x + 4, y + 6, { width: cols[1].w - 8, align: 'left' }); x += cols[1].w;
      doc.text(String(cantidad), x + 4, y + 6, { width: cols[2].w - 8, align: 'center' }); x += cols[2].w;
      doc.text(item.unidad || '-', x + 4, y + 6, { width: cols[3].w - 8, align: 'center' }); x += cols[3].w;
      doc.text(money(precioUnitario), x + 4, y + 6, { width: cols[4].w - 8, align: 'right' }); x += cols[4].w;
      doc.text(money(subtotal), x + 4, y + 6, { width: cols[5].w - 8, align: 'right' });

      y += rowH;
    });

    doc.moveTo(marginX, y).lineTo(marginX + tableW, y).strokeColor('#e9eaf5').stroke();
    y += 14;

    // ===== Totals =====
    const totalsX = marginX + tableW - 190;
    function totalLine(label, value, bold) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5)
        .fillColor(bold ? NAVY : GRAY);
      doc.text(label, totalsX, y, { width: 110, align: 'left' });
      doc.text(money(value), totalsX + 110, y, { width: 80, align: 'right' });
      y += bold ? 18 : 15;
    }
    totalLine('Subtotal', quote.subtotal);
    totalLine('ITBM (7%)', quote.itbm);
    doc.moveTo(totalsX, y).lineTo(totalsX + 190, y).strokeColor(BLUE).lineWidth(1.5).stroke();
    y += 6;
    totalLine('TOTAL', quote.total, true);
    y += 14;

    // ===== Comentarios =====
    if (quote.comentarios) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Comentarios', marginX, y);
      y += 13;
      doc.font('Helvetica').fontSize(9).fillColor(GRAY)
        .text(quote.comentarios, marginX, y, { width: tableW });
      y += doc.heightOfString(quote.comentarios, { width: tableW }) + 16;
    }

    // ===== Signature =====
    y = Math.max(y, doc.page.height - 150);
    doc.moveTo(marginX, y).lineTo(marginX + 220, y).strokeColor('#cccccc').stroke();
    y += 6;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text('Ing. Dionisio Sánchez', marginX, y);
    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text('Representante Legal', marginX, y + 12);

    // ===== Footer =====
    const footerY = doc.page.height - 46;
    doc.rect(0, footerY, pageW, 46).fill(NAVY);
    doc.font('Helvetica').fontSize(8).fillColor('#cfd0f5').text(
      'Gracias por contactar los servicios de nuestra empresa. Recuerda: no vendemos equipos de seguridad, te asesoramos y realizamos tus proyectos para proteger tu hogar o negocio.',
      marginX, footerY + 14, { width: pageW - marginX * 2, align: 'center' }
    );

    doc.end();
  });
}

module.exports = { generateQuotePdf };

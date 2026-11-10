// Excel del resumen de rentabilidad (mensual o anual) -- mismos números que
// la pantalla de Finanzas (ver shared/rentabilidad.js). Tres hojas: Resumen
// (y mes a mes si es anual), Ingresos y Gastos con cada factura.
const ExcelJS = require('exceljs');
const { COMPANY } = require('./generateQuoteExcel');

const NAVY = 'FF0A0A1A';
const MONEY_FMT = '"B/. "#,##0.00;[Red]-"B/. "#,##0.00';
const PCT_FMT = '0.0"%";[Red]-0.0"%"';

function headerRow(ws, values) {
  const row = ws.addRow(values);
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle' };
  });
  return row;
}

function titulo(ws, texto, subtitulo) {
  ws.addRow([COMPANY.nombre]).font = { bold: true, size: 14 };
  ws.addRow([texto]).font = { bold: true, size: 12 };
  if (subtitulo) ws.addRow([subtitulo]).font = { italic: true, color: { argb: 'FF565873' } };
  ws.addRow([]);
}

function hojaFacturas(wb, nombre, facturas, etiquetaContraparte) {
  const ws = wb.addWorksheet(nombre);
  ws.columns = [
    { width: 12 }, { width: 38 }, { width: 16 }, { width: 28 }, { width: 18 }, { width: 14 }, { width: 18 },
  ];
  titulo(ws, nombre, 'Montos sin ITBM: la rentabilidad se calcula sobre el subtotal.');
  headerRow(ws, ['Fecha', etiquetaContraparte, '# Factura', 'Proyecto', 'Subtotal (sin ITBM)', 'ITBM', 'Total con ITBM']);
  for (const f of facturas) {
    const row = ws.addRow([f.fecha, f.contraparte, f.numero_factura, (f.proyecto || (f.tipo === 'emitida' ? 'Sin proyecto' : 'Gasto general')), f.monto, f.itbm, f.total]);
    [5, 6, 7].forEach((i) => { row.getCell(i).numFmt = MONEY_FMT; });
  }
  const tot = ws.addRow(['TOTAL', '', '', '', facturas.reduce((s, f) => s + f.monto, 0)]);
  tot.font = { bold: true };
  tot.getCell(5).numFmt = MONEY_FMT;
  if (!facturas.length) ws.addRow(['No hay facturas en este período.']);
  return ws;
}

async function generateRentabilidadExcel(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.nombre;

  const ws = wb.addWorksheet('Resumen');
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 12 }];
  titulo(ws, `Rentabilidad — ${r.periodo.label}`, 'Montos sin ITBM (subtotal de cada factura).');

  headerRow(ws, ['Concepto', 'Monto']);
  const filas = [
    ['Ingresos (facturas emitidas)', r.ingresos],
    ['Gastos de proyectos', r.gastos_proyectos],
    ['Gastos generales', r.gastos_generales],
    ['Gastos totales', r.gastos],
    [r.ganancia >= 0 ? 'Ganancia' : 'Pérdida', r.ganancia],
  ];
  for (const f of filas) {
    const row = ws.addRow(f);
    row.getCell(2).numFmt = MONEY_FMT;
    if (f[0] === 'Gastos totales' || f[0] === 'Ganancia' || f[0] === 'Pérdida') row.font = { bold: true };
  }
  const m = ws.addRow(['Margen de rentabilidad', r.margen == null ? 'Sin ingresos' : r.margen]);
  m.font = { bold: true };
  if (r.margen != null) m.getCell(2).numFmt = PCT_FMT;

  if (r.por_mes) {
    ws.addRow([]);
    ws.addRow(['Mes a mes']).font = { bold: true, size: 12 };
    headerRow(ws, ['Mes', 'Ingresos', 'Gastos', 'Ganancia', 'Gastos generales', 'Margen']);
    for (const p of r.por_mes) {
      const row = ws.addRow([p.nombre, p.ingresos, p.gastos, p.ganancia, p.gastos_generales, p.margen]);
      [2, 3, 4, 5].forEach((i) => { row.getCell(i).numFmt = MONEY_FMT; });
      row.getCell(6).numFmt = PCT_FMT;
    }
    const tot = ws.addRow(['TOTAL', r.ingresos, r.gastos, r.ganancia, r.gastos_generales, r.margen]);
    tot.font = { bold: true };
    [2, 3, 4, 5].forEach((i) => { tot.getCell(i).numFmt = MONEY_FMT; });
    tot.getCell(6).numFmt = PCT_FMT;
  }

  hojaFacturas(wb, 'Ingresos', r.ingresos_detalle, 'Cliente');
  hojaFacturas(wb, 'Gastos', r.gastos_detalle, 'Proveedor');

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { generateRentabilidadExcel };

const ExcelJS = require('exceljs');
const { MARKER } = require('./generateQuoteExcel');

function cellValueText(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map(t => t.text).join('');
    return '';
  }
  return String(v).trim();
}

function cellValueNumber(cell) {
  const v = cell && cell.value;
  if (v == null) return 0;
  if (typeof v === 'object') {
    if (typeof v.result === 'number') return v.result;
    return 0;
  }
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

const LABELS = {
  'Nombre / Entidad:': 'cliente_nombre',
  'RUC:': 'cliente_ruc',
  'Dirección:': 'cliente_direccion',
  'Ciudad:': 'cliente_ciudad',
  'Forma de pago:': 'forma_pago',
};

async function parseQuoteExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('El archivo no tiene hojas.');

  const isKnownTemplate = cellValueText(sheet.getCell('H1')) === MARKER;

  const result = {
    cliente_nombre: '', cliente_ruc: '', cliente_direccion: '', cliente_ciudad: '', forma_pago: 'Crédito',
    comentarios: '', items: [],
  };

  let headerRow = null;
  let comentariosLabelRow = null;

  sheet.eachRow((row, rowNumber) => {
    const colA = cellValueText(row.getCell(1));
    if (LABELS[colA]) {
      result[LABELS[colA]] = cellValueText(row.getCell(2));
    }
    if (colA === 'COMENTARIOS') comentariosLabelRow = rowNumber;
    if (cellValueText(row.getCell(2)) === 'Descripción' && cellValueText(row.getCell(6)).toUpperCase().includes('PRECIO UNITARIO')) {
      headerRow = rowNumber;
    }
  });

  if (!headerRow) {
    throw new Error('No se encontró la tabla de ítems en el archivo. ¿Es el Excel generado por la app?');
  }

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const descripcion = cellValueText(row.getCell(2));
    if (!descripcion) break; // end of table
    result.items.push({
      numRenglon: cellValueNumber(row.getCell(1)) || (result.items.length + 1),
      descripcion,
      cantidad: cellValueNumber(row.getCell(3)),
      unidad: cellValueText(row.getCell(4)),
      precioUnitario: cellValueNumber(row.getCell(6)),
    });
  }

  if (comentariosLabelRow) {
    result.comentarios = cellValueText(sheet.getCell(comentariosLabelRow + 1, 1));
  }

  return { ...result, isKnownTemplate };
}

module.exports = { parseQuoteExcel };

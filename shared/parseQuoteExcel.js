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

// Columnas: A Renglón | B Descripción | C Modelo | D Unidades |
// E Costo Distribuidor | F Costo+ITBM | G Gasto | H %G | I Precio Un. | J Subtotal | K ITBM | L Suma |
// M Precio de Referencia (PanamaCompra)
async function parseQuoteExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('El archivo no tiene hojas.');

  const isKnownTemplate = cellValueText(sheet.getCell('N1')) === MARKER;

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
    if (cellValueText(row.getCell(2)) === 'Descripción' && cellValueText(row.getCell(9)).toUpperCase().includes('PRECIO UN')) {
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

    const costoDistribuidor = cellValueNumber(row.getCell(5));
    const margenG = cellValueNumber(row.getCell(8));
    // "Precio Un." (columna I) es una fórmula (ROUND(PRODUCT(F,H),2), es
    // decir costoDistribuidor*1.07*margenG redondeado a centavos) — no se
    // lee su resultado cacheado porque si el programa con el que se editó
    // el Excel no recalculó las fórmulas antes de guardar (cálculo manual,
    // o algún visor/editor que no ejecuta fórmulas), esa celda se queda en
    // 0 aunque el usuario sí haya llenado el costo y el %G, y la cotización
    // sale sin precios. Se recalcula siempre desde los dos únicos valores
    // que el usuario realmente escribe, replicando la misma fórmula de
    // generateQuoteExcel.js — incluido el redondeo a 2 decimales, si no el
    // Subtotal (cantidad × este precio) no coincide con lo que calcula la
    // calculadora de PanamaCompra a partir del precio ya redondeado.
    const precioUnitario = Math.round(costoDistribuidor * 1.07 * margenG * 100) / 100;

    result.items.push({
      numRenglon: cellValueNumber(row.getCell(1)) || (result.items.length + 1),
      descripcion,
      modelo: cellValueText(row.getCell(3)),
      cantidad: cellValueNumber(row.getCell(4)),
      costoDistribuidor,
      margenG,
      precioUnitario,
      precioReferencia: cellValueNumber(row.getCell(13)),
    });
  }

  if (comentariosLabelRow) {
    result.comentarios = cellValueText(sheet.getCell(comentariosLabelRow + 1, 1));
  }

  return { ...result, isKnownTemplate };
}

module.exports = { parseQuoteExcel };

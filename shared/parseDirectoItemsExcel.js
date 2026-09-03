const ExcelJS = require('exceljs');

// Lee cualquier Excel simple (no la plantilla completa de cotización, solo
// una lista de ítems) para crear una cotización directa sin escribir cada
// renglón a mano en el formulario — el usuario arma/edita su propia hoja y
// la sube. Busca las columnas por nombre de encabezado (insensible a
// mayúsculas/tildes), en cualquier orden; si no encuentra encabezados
// reconocibles, asume A=Descripción, B=Cantidad como formato mínimo.
function normalizar(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

function cellText(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(v).trim();
}

function cellNumber(cell) {
  const v = cell && cell.value;
  if (v == null) return 0;
  if (typeof v === 'object') return typeof v.result === 'number' ? v.result : 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

const ENCABEZADOS_DESCRIPCION = ['descripcion', 'descripción', 'item', 'ítem', 'producto', 'articulo', 'artículo'];
const ENCABEZADOS_MODELO = ['modelo'];
const ENCABEZADOS_CANTIDAD = ['cantidad', 'cant', 'cant.', 'unidades'];

async function parseDirectoItemsExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('El archivo no tiene hojas.');

  // Busca en las primeras 5 filas una que tenga un encabezado de
  // "descripción" reconocible -- así no importa si el usuario dejó una
  // fila de título arriba.
  let headerRow = null;
  let colDescripcion = null;
  let colModelo = null;
  let colCantidad = null;

  for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    let encontrado = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const texto = normalizar(cellText(cell));
      if (ENCABEZADOS_DESCRIPCION.includes(texto)) { colDescripcion = colNumber; encontrado = true; }
      else if (ENCABEZADOS_MODELO.includes(texto)) { colModelo = colNumber; }
      else if (ENCABEZADOS_CANTIDAD.includes(texto)) { colCantidad = colNumber; }
    });
    if (encontrado) { headerRow = r; break; }
  }

  // Formato mínimo sin encabezados reconocibles: A=Descripción, B=Cantidad,
  // empezando en la fila 1.
  if (!headerRow) {
    headerRow = 0;
    colDescripcion = 1;
    colCantidad = 2;
  }

  const items = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const descripcion = cellText(row.getCell(colDescripcion));
    if (!descripcion) continue; // fila vacía en medio de la hoja -- se ignora, no corta la lectura
    items.push({
      descripcion,
      modelo: colModelo ? cellText(row.getCell(colModelo)) : '',
      cantidad: colCantidad ? (cellNumber(row.getCell(colCantidad)) || 1) : 1,
    });
  }

  if (!items.length) {
    throw new Error('No se encontró ningún ítem con descripción en el archivo.');
  }

  return { items };
}

module.exports = { parseDirectoItemsExcel };

const ExcelJS = require('exceljs');
const { normalize } = require('./catalog');

// Alias por campo -> se busca por nombre de columna (normalizado, sin
// acentos/mayúsculas), no por posición fija, porque estos son los propios
// archivos de precios del usuario (de distintos proveedores), no la
// plantilla de cotización generada por la app.
const FIELD_ALIASES = {
  descripcion: ['descripcion', 'articulo', 'producto', 'item', 'nombre', 'detalle'],
  categoria: ['categoria', 'rubro', 'tipo', 'familia'],
  subcategoria: ['subcategoria', 'tecnologia', 'sub categoria', 'sub rubro'],
  marca: ['marca', 'brand', 'fabricante'],
  modelo: ['modelo', 'model', 'referencia', 'sku'],
  costoDistribuidor: [
    'costo', 'precio', 'costo distribuidor', 'precio distribuidor',
    'costo unitario', 'precio unitario', 'precio proveedor', 'costo proveedor', 'costo unit',
  ],
  proveedor: ['proveedor', 'distribuidor', 'supplier'],
  notas: ['notas', 'observaciones', 'nota', 'comentarios'],
};

function cellText(cell) {
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

function cellNumber(cell) {
  const raw = cellText(cell);
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Encuentra, entre las primeras filas, cuál es la fila de encabezados y a
// qué campo corresponde cada columna, comparando cada celda contra los
// alias conocidos.
function detectHeaderRow(sheet) {
  let best = null;
  const maxScan = Math.min(sheet.rowCount, 15);
  for (let r = 1; r <= maxScan; r++) {
    const row = sheet.getRow(r);
    const colMap = {};
    let score = 0;
    let hasDescripcion = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const norm = normalize(cellText(cell));
      if (!norm) return;
      // "contains" en vez de igualdad exacta: encabezados reales varían
      // ("COSTO DE DISTRIBUIDOR", "Precio Unitario (USD)", etc.) y una
      // coincidencia exacta se queda corta casi siempre.
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (aliases.some(alias => norm.includes(alias))) {
          colMap[field] = colNumber;
          score++;
          if (field === 'descripcion') hasDescripcion = true;
          break;
        }
      }
    });
    if (hasDescripcion && score >= 2 && (!best || score > best.score)) {
      best = { rowNumber: r, colMap, score };
    }
  }
  return best;
}

// Lee un Excel de precios "libre" (no la plantilla de cotización) y devuelve
// filas { descripcion, categoria, marca, modelo, costoDistribuidor, proveedor, notas }.
async function parseCatalogExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('El archivo no tiene hojas.');

  const header = detectHeaderRow(sheet);
  if (!header) {
    throw new Error('No pude reconocer las columnas del archivo (necesito al menos una columna de descripción y otra más, ej. costo o categoría).');
  }

  const rows = [];
  for (let r = header.rowNumber + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const descripcion = header.colMap.descripcion ? cellText(row.getCell(header.colMap.descripcion)) : '';
    if (!descripcion) continue;

    rows.push({
      descripcion,
      categoria: header.colMap.categoria ? cellText(row.getCell(header.colMap.categoria)) : '',
      subcategoria: header.colMap.subcategoria ? cellText(row.getCell(header.colMap.subcategoria)) : '',
      marca: header.colMap.marca ? cellText(row.getCell(header.colMap.marca)) : '',
      modelo: header.colMap.modelo ? cellText(row.getCell(header.colMap.modelo)) : '',
      costoDistribuidor: header.colMap.costoDistribuidor ? cellNumber(row.getCell(header.colMap.costoDistribuidor)) : null,
      proveedor: header.colMap.proveedor ? cellText(row.getCell(header.colMap.proveedor)) : '',
      notas: header.colMap.notas ? cellText(row.getCell(header.colMap.notas)) : '',
    });
  }

  return { rows, detectedColumns: header.colMap };
}

module.exports = { parseCatalogExcel };

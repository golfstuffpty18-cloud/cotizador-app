const stringSimilarity = require('string-similarity');
const { pool } = require('./db');

const MATCH_THRESHOLD_SUGGEST = 0.45; // usado al precargar precios en un Excel nuevo
const MATCH_THRESHOLD_UPSERT = 0.85;  // usado para decidir "es el mismo ítem" al guardar/importar

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Busca la mejor coincidencia por descripción. Si se da una categoría,
// busca primero SOLO dentro de esa categoría (más preciso: "control de
// acceso" no compite contra cámaras o materiales de tubería); si no hay
// nada suficientemente parecido ahí, cae a buscar en todo el catálogo en
// vez de no sugerir nada.
async function findBestMatch(descripcion, categoria) {
  const target = normalize(descripcion);
  if (!target) return null;

  if (categoria) {
    const { rows } = await pool.query('SELECT * FROM catalog_items WHERE categoria = $1', [categoria]);
    if (rows.length) {
      const candidates = rows.map(r => normalize(r.descripcion));
      const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(target, candidates);
      if (bestMatch.rating >= MATCH_THRESHOLD_SUGGEST) {
        return { item: rows[bestMatchIndex], score: bestMatch.rating };
      }
    }
  }

  const { rows } = await pool.query('SELECT * FROM catalog_items');
  if (!rows.length) return null;

  const candidates = rows.map(r => normalize(r.descripcion));
  const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(target, candidates);

  if (bestMatch.rating >= MATCH_THRESHOLD_SUGGEST) {
    return { item: rows[bestMatchIndex], score: bestMatch.rating };
  }
  return null;
}

// Precarga costo/modelo/%G en una lista de ítems del pliego, usando el
// catálogo. `categoria` es la del proceso completo (de evaluate()) — prioriza
// coincidencias dentro de esa categoría antes de buscar en todo el catálogo.
async function suggestPricesForItems(items, categoria) {
  const out = [];
  for (const item of items) {
    const match = await findBestMatch(item.descripcion, categoria);
    out.push({
      ...item,
      modelo: item.modelo || (match ? match.item.modelo : '') || '',
      costoDistribuidor: item.costoDistribuidor || (match ? Number(match.item.costo_distribuidor) : null),
      margenG: item.margenG || (match ? Number(match.item.margen_g) : null),
      catalogMatch: match ? { descripcion: match.item.descripcion, score: match.score } : null,
    });
  }
  return out;
}

// Guarda/actualiza el catálogo con los ítems de una cotización ya aprobada.
async function upsertFromQuoteItems(items, { proveedor } = {}) {
  for (const item of items) {
    if (!item.descripcion || !item.costoDistribuidor) continue;

    const { rows } = await pool.query('SELECT id, descripcion FROM catalog_items');
    const target = normalize(item.descripcion);
    let matchId = null;
    if (rows.length) {
      const candidates = rows.map(r => normalize(r.descripcion));
      const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(target, candidates);
      if (bestMatch.rating >= MATCH_THRESHOLD_UPSERT) matchId = rows[bestMatchIndex].id;
    }

    if (matchId) {
      await pool.query(
        `UPDATE catalog_items SET
           descripcion = $1, modelo = COALESCE(NULLIF($2,''), modelo),
           costo_distribuidor = $3, margen_g = $4,
           proveedor = COALESCE(NULLIF($5,''), proveedor),
           fecha_cotizacion = now(), updated_at = now()
         WHERE id = $6`,
        [item.descripcion, item.modelo || '', item.costoDistribuidor, item.margenG || null, proveedor || '', matchId]
      );
    } else {
      await pool.query(
        `INSERT INTO catalog_items (descripcion, modelo, costo_distribuidor, margen_g, proveedor, fecha_cotizacion)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [item.descripcion, item.modelo || '', item.costoDistribuidor, item.margenG || null, proveedor || '']
      );
    }
  }
}

// Importación masiva desde un Excel de precios (proveedor/lista propia del
// usuario, no la plantilla de cotización). Para cada fila: si ya existe algo
// muy parecido en el catálogo lo actualiza (conserva el id, actualiza
// precio/categoría/etc.), si no, inserta un ítem nuevo. Devuelve un resumen
// para poder confirmarle al usuario qué se cargó.
async function importCatalogRows(rows, { defaultCategoria } = {}) {
  let creados = 0;
  let actualizados = 0;
  let omitidos = 0;

  for (const row of rows) {
    const descripcion = (row.descripcion || '').trim();
    if (!descripcion) { omitidos++; continue; }

    const categoria = row.categoria || defaultCategoria || null;
    const marca = row.marca || '';
    const modelo = row.modelo || '';
    const costo = row.costoDistribuidor != null ? row.costoDistribuidor : null;
    const proveedor = row.proveedor || '';
    const notas = row.notas || '';

    const { rows: existentes } = await pool.query('SELECT id, descripcion FROM catalog_items');
    let matchId = null;
    if (existentes.length) {
      const target = normalize(descripcion);
      const candidates = existentes.map(r => normalize(r.descripcion));
      const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(target, candidates);
      if (bestMatch.rating >= MATCH_THRESHOLD_UPSERT) matchId = existentes[bestMatchIndex].id;
    }

    if (matchId) {
      await pool.query(
        `UPDATE catalog_items SET
           descripcion = $1,
           categoria = COALESCE(NULLIF($2,''), categoria),
           marca = COALESCE(NULLIF($3,''), marca),
           modelo = COALESCE(NULLIF($4,''), modelo),
           costo_distribuidor = COALESCE($5, costo_distribuidor),
           proveedor = COALESCE(NULLIF($6,''), proveedor),
           notas = COALESCE(NULLIF($7,''), notas),
           fecha_cotizacion = now(), updated_at = now()
         WHERE id = $8`,
        [descripcion, categoria || '', marca, modelo, costo, proveedor, notas, matchId]
      );
      actualizados++;
    } else {
      await pool.query(
        `INSERT INTO catalog_items (descripcion, categoria, marca, modelo, costo_distribuidor, proveedor, notas, fecha_cotizacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
        [descripcion, categoria, marca, modelo, costo, proveedor, notas]
      );
      creados++;
    }
  }

  return { total: rows.length, creados, actualizados, omitidos };
}

module.exports = { findBestMatch, suggestPricesForItems, upsertFromQuoteItems, importCatalogRows, normalize };

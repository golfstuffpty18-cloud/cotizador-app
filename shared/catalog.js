const stringSimilarity = require('string-similarity');
const { pool } = require('./db');

const MATCH_THRESHOLD_SUGGEST = 0.45; // usado al precargar precios en un Excel nuevo
const MATCH_THRESHOLD_UPSERT = 0.85;  // usado para decidir "es el mismo ítem" al guardar

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findBestMatch(descripcion) {
  const { rows } = await pool.query('SELECT * FROM catalog_items');
  if (!rows.length) return null;

  const target = normalize(descripcion);
  const candidates = rows.map(r => normalize(r.descripcion));
  const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(target, candidates);

  if (bestMatch.rating >= MATCH_THRESHOLD_SUGGEST) {
    return { item: rows[bestMatchIndex], score: bestMatch.rating };
  }
  return null;
}

// Precarga costo/modelo/%G en una lista de ítems del pliego, usando el catálogo.
async function suggestPricesForItems(items) {
  const out = [];
  for (const item of items) {
    const match = await findBestMatch(item.descripcion);
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

module.exports = { findBestMatch, suggestPricesForItems, upsertFromQuoteItems, normalize };

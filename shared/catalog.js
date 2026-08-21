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

// Detecta la tecnología de un equipo de incendio a partir de su propio
// texto. "Direccionable" y "Convencional" son arquitecturas incompatibles
// entre sí (un dispositivo direccionable no funciona en un panel
// convencional y viceversa) — mezclarlas al sugerir precios es el bug que
// causó que se sugiriera un panel convencional con una estación direccionable
// en una misma cotización. Muchas fichas técnicas no dicen "convencional" o
// "direccionable" directamente, pero sí delatan la tecnología: un panel
// convencional siempre habla de "zonas", uno direccionable/inteligente
// siempre habla de "lazo" (loop). Si no se menciona ninguna señal, se asume
// "Universal" (baterías, cable, herramientas: sirven para cualquier
// tecnología).
function classifyTecnologia(text) {
  const t = normalize(text);
  if (!t) return null;
  if (/\bdireccion|\blazo|\bloop|\bintelig/.test(t)) return 'Direccionable';
  if (/\bconvencional|\bzona/.test(t)) return 'Convencional';
  return 'Universal';
}

// Busca la mejor coincidencia por descripción. Si se da una categoría,
// busca primero SOLO dentro de esa categoría (más preciso: "control de
// acceso" no compite contra cámaras o materiales de tubería). Dentro de la
// categoría, prioriza candidatos de la tecnología indicada (o "Universal")
// antes que los de la tecnología contraria — `tecnologiaHint` (ej. la
// respuesta del usuario a "¿convencional o direccionable?") manda sobre lo
// que se pueda adivinar por texto, porque el texto del pliego casi nunca lo
// aclara. Si nada alcanza el umbral en ningún paso, cae a buscar en todo el
// catálogo.
async function findBestMatch(descripcion, categoria, tecnologiaHint, companyId) {
  const target = normalize(descripcion);
  if (!target) return null;
  const tecnologia = tecnologiaHint || classifyTecnologia(descripcion);

  const tryMatch = (rows) => {
    if (!rows.length) return null;
    const candidates = rows.map(r => normalize(r.descripcion));
    const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(target, candidates);
    if (bestMatch.rating >= MATCH_THRESHOLD_SUGGEST) {
      return { item: rows[bestMatchIndex], score: bestMatch.rating };
    }
    return null;
  };

  if (categoria) {
    const { rows } = await pool.query('SELECT * FROM catalog_items WHERE categoria = $1 AND company_id = $2', [categoria, companyId]);

    if (tecnologia && tecnologia !== 'Universal') {
      const compatibles = rows.filter(r => !r.subcategoria || r.subcategoria === tecnologia || r.subcategoria === 'Universal');
      const hit = tryMatch(compatibles);
      if (hit) return hit;
    }

    const hit = tryMatch(rows);
    if (hit) return hit;
  }

  const { rows } = await pool.query('SELECT * FROM catalog_items WHERE company_id = $1', [companyId]);
  return tryMatch(rows);
}

// Precarga costo/modelo/%G en una lista de ítems del pliego, usando el
// catálogo. `categoria` es la del proceso completo (de evaluate()) —
// prioriza coincidencias dentro de esa categoría antes de buscar en todo el
// catálogo. `tecnologiaHint` (Convencional/Direccionable) aplica a TODOS los
// ítems de la cotización por igual, no por ítem — es una sola respuesta del
// usuario para toda la cotización de incendio.
async function suggestPricesForItems(items, categoria, tecnologiaHint, companyId) {
  const out = [];
  for (const item of items) {
    const match = await findBestMatch(item.descripcion, categoria, tecnologiaHint, companyId);
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
// Trae el catálogo UNA sola vez (antes hacía un SELECT del catálogo entero
// por cada ítem de la cotización — con cotizaciones de varios ítems eso eran
// varias vueltas redundantes a la base de datos, justo el tipo de demora que
// hace que "aprobar y generar el PDF" se sienta colgado).
async function upsertFromQuoteItems(items, { proveedor } = {}, companyId) {
  const { rows } = await pool.query('SELECT id, descripcion FROM catalog_items WHERE company_id = $1', [companyId]);

  for (const item of items) {
    if (!item.descripcion || !item.costoDistribuidor) continue;

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
      const { rows: inserted } = await pool.query(
        `INSERT INTO catalog_items (descripcion, modelo, costo_distribuidor, margen_g, proveedor, fecha_cotizacion, company_id)
         VALUES ($1,$2,$3,$4,$5, now(), $6) RETURNING id, descripcion`,
        [item.descripcion, item.modelo || '', item.costoDistribuidor, item.margenG || null, proveedor || '', companyId]
      );
      rows.push(inserted[0]); // para que otros ítems de esta misma cotización puedan matchear contra este
    }
  }
}

// Importación masiva desde un Excel de precios (proveedor/lista propia del
// usuario, no la plantilla de cotización). Para cada fila: si ya existe algo
// muy parecido en el catálogo lo actualiza (conserva el id, actualiza
// precio/categoría/etc.), si no, inserta un ítem nuevo. Devuelve un resumen
// para poder confirmarle al usuario qué se cargó.
async function importCatalogRows(rows, { defaultCategoria } = {}, companyId) {
  let creados = 0;
  let actualizados = 0;
  let omitidos = 0;

  // Traer el catálogo UNA sola vez (antes era un SELECT del catálogo entero
  // por cada fila del Excel importado — con archivos grandes eso eran
  // decenas de vueltas redundantes a la base de datos).
  const { rows: existentes } = await pool.query('SELECT id, descripcion FROM catalog_items WHERE company_id = $1', [companyId]);

  for (const row of rows) {
    const descripcion = (row.descripcion || '').trim();
    if (!descripcion) { omitidos++; continue; }

    const categoria = row.categoria || defaultCategoria || null;
    const subcategoria = row.subcategoria || classifyTecnologia(descripcion);
    const marca = row.marca || '';
    const modelo = row.modelo || '';
    const costo = row.costoDistribuidor != null ? row.costoDistribuidor : null;
    const proveedor = row.proveedor || '';
    const notas = row.notas || '';

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
           subcategoria = COALESCE($3, subcategoria),
           marca = COALESCE(NULLIF($4,''), marca),
           modelo = COALESCE(NULLIF($5,''), modelo),
           costo_distribuidor = COALESCE($6, costo_distribuidor),
           proveedor = COALESCE(NULLIF($7,''), proveedor),
           notas = COALESCE(NULLIF($8,''), notas),
           fecha_cotizacion = now(), updated_at = now()
         WHERE id = $9`,
        [descripcion, categoria || '', subcategoria, marca, modelo, costo, proveedor, notas, matchId]
      );
      actualizados++;
    } else {
      const { rows: inserted } = await pool.query(
        `INSERT INTO catalog_items (descripcion, categoria, subcategoria, marca, modelo, costo_distribuidor, proveedor, notas, fecha_cotizacion, company_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9) RETURNING id, descripcion`,
        [descripcion, categoria, subcategoria, marca, modelo, costo, proveedor, notas, companyId]
      );
      existentes.push(inserted[0]); // para que otras filas del mismo archivo puedan matchear contra esta
      creados++;
    }
  }

  return { total: rows.length, creados, actualizados, omitidos };
}

module.exports = { findBestMatch, suggestPricesForItems, upsertFromQuoteItems, importCatalogRows, normalize, classifyTecnologia };

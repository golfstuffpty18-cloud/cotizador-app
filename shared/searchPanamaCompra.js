const pc = require('./panamacompra');
const { evaluate } = require('./evaluate');
const { parseDeadline } = require('./parseWindow');
const { isActProcessed, markActProcessed } = require('./db');
const { upsertOpportunity } = require('./opportunities');

// Tope de detalles (verPliego) a consultar POR ESTADO, para no tardar
// demasiado ni golpear la API de PanamaCompra si un día hay muchas
// coincidencias de rubro. Cada estado tiene su propio cupo — si se
// consultaran juntas (un solo cupo total para Abiertas+Programadas), las
// Abiertas -que casi siempre son muchas más- agotarían el cupo antes de que
// se revisara ninguna Programada.
const MAX_DETALLES = 30;

// Busca, dentro de UN estado (Abierta o Programada), las cotizaciones que
// coinciden con el rubro de la empresa, y las guarda en el mismo listado que
// usan las detectadas por correo. `precioMin`/`precioMax` son opcionales
// (ej. para la búsqueda por rango de $10,000-$50,000) — si se dan, un acto
// fuera de rango NO se guarda ni se marca como procesado, para que otra
// búsqueda sin ese filtro (o con un rango distinto) lo pueda seguir
// encontrando después.
async function searchOneEstado(cookie, idEstado, label, { precioMin, precioMax } = {}) {
  const registros = await pc.buscarPorEstados(cookie, [idEstado]);
  const candidatas = registros.filter(r => evaluate({ title: r.titulo }).categoryMatch);

  const nuevas = [];
  let revisadas = 0;
  for (const r of candidatas) {
    if (revisadas >= MAX_DETALLES) break;
    const actNumber = r.numProceso;
    if (await isActProcessed(actNumber)) continue; // ya lo teníamos, por correo o por una búsqueda anterior
    revisadas++;

    const { campos, items } = await pc.verPliego(cookie, r.idProcesosContratacionFlujos);
    const referencePrice = pc.extraerPrecio(campos['Precio estimado']);

    const fueraDeRango = (precioMin != null && (referencePrice == null || referencePrice < precioMin))
      || (precioMax != null && (referencePrice == null || referencePrice > precioMax));
    if (fueraDeRango) continue;

    const title = campos['Título'] || r.titulo;
    const entity = campos['Entidad'] || '';
    const entityAddress = campos['Dirección de la unidad de compra'] || '';
    const entityProvince = campos['Provincia'] || '';
    const windowInfo = campos['Fecha y hora presentación de cotizaciones'] || '';
    const deadline = parseDeadline(windowInfo);
    const ev = evaluate({ title, referencePrice });

    const op = {
      actNumber,
      convocatoria: String(r.numeroConvocatoria),
      title, entity, entityAddress, entityProvince, referencePrice, windowInfo, deadline, items,
      categoryMatch: ev.categoryMatch,
      category: ev.category,
      recommendation: ev.recommendation,
      reasoning: ev.reasoning,
    };

    const row = await upsertOpportunity(op);
    if (row) {
      await markActProcessed(actNumber);
      nuevas.push(row);
    }
  }

  return {
    estado: label,
    totalConsultadas: registros.length,
    candidatas: candidatas.length,
    revisadas,
    nuevas: nuevas.length,
    oportunidades: nuevas,
  };
}

// Busca por separado entre las cotizaciones en línea "Abiertas" y las
// "Programadas" — son dos renglones de búsqueda distintos en PanamaCompra y
// se reportan por separado (no se mezclan en un solo resultado), aunque
// ambas terminen guardándose en el mismo listado de oportunidades.
// Complementa al chequeo de correo — no lo reemplaza.
async function searchOpenByCategory() {
  const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
  const abiertas = await searchOneEstado(cookie, pc.ESTADO.ABIERTA, 'Abiertas');
  const programadas = await searchOneEstado(cookie, pc.ESTADO.PROGRAMADA, 'Programadas');
  return { abiertas, programadas };
}

// Misma búsqueda por rubro, pero solo entre $10,000 y $50,000 de precio de
// referencia — el rango que cubre "Cotización en línea" para procesos por
// encima de "Compra menor" (confirmado con el campo "Proceso posterior" del
// pliego de un acto real).
async function searchByPriceRange(precioMin = 10000, precioMax = 50000) {
  const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
  const abiertas = await searchOneEstado(cookie, pc.ESTADO.ABIERTA, 'Abiertas', { precioMin, precioMax });
  const programadas = await searchOneEstado(cookie, pc.ESTADO.PROGRAMADA, 'Programadas', { precioMin, precioMax });
  return { abiertas, programadas };
}

module.exports = { searchOpenByCategory, searchByPriceRange };

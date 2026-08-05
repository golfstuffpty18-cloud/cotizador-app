const pc = require('./panamacompra');
const { evaluate } = require('./evaluate');
const { parseDeadline } = require('./parseWindow');
const { isActProcessed, markActProcessed } = require('./db');
const { upsertOpportunity } = require('./opportunities');

// Tope de detalles (verPliego) a consultar por búsqueda, para no tardar
// demasiado ni golpear la API de PanamaCompra si un día hay muchas
// coincidencias de rubro entre las abiertas.
const MAX_DETALLES = 30;

// Busca, entre TODAS las cotizaciones "Abierta" o "Programada" en
// PanamaCompra (no solo las que avisaron por correo), las que coinciden con
// el rubro de la empresa, y las guarda en el mismo listado que usan las
// detectadas por correo. Complementa al chequeo de correo — no lo reemplaza.
async function searchOpenByCategory() {
  const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
  const registros = await pc.buscarPorEstados(cookie, [pc.ESTADO.ABIERTA, pc.ESTADO.PROGRAMADA]);

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
      recommendation: ev.recommendation,
      reasoning: ev.reasoning,
    };

    const row = await upsertOpportunity(op);
    await markActProcessed(actNumber);
    if (row) nuevas.push(row);
  }

  return {
    totalConsultadas: registros.length,
    candidatas: candidatas.length,
    revisadas,
    nuevas: nuevas.length,
    oportunidades: nuevas,
  };
}

module.exports = { searchOpenByCategory };

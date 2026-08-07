const pc = require('./panamacompra');

async function listarEnviadas() {
  const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
  const registros = await pc.buscarEnviadas(cookie);
  return registros
    .map(r => ({
      numProceso: r.numProceso,
      idProcesosContratacion: r.idProcesosContratacion,
      idProcesosContratacionFlujos: r.idProcesosContratacionFlujos,
      titulo: r.titulo,
      idEstado: r.idEstado,
      estado: r.nombreRealizado || '',
      fechaCierre: r.fechaCierre || null,
      tieneActaApertura: !!r.tieneActaApertura,
      totalEnviada: r.totalEnviada || 0,
    }))
    .sort((a, b) => new Date(b.fechaCierre || 0) - new Date(a.fechaCierre || 0));
}

// ÚNICA función que traduce un registro de "enviadas" a los parámetros
// p/d del endpoint cuadroPropuesta. CONFIRMADO en vivo (2026-08-07) con un
// link real que el usuario copió desde el portal-interno de PanamaCompra
// para un proceso ya cerrado: "p" NO es un identificador del proceso —
// es literalmente el nombre fijo de la vista ("procesoVistaCuadroPropuesta"),
// igual para cualquier proceso. El identificador real del proceso es "d",
// y corresponde a idProcesosContratacionFlujos (no idProcesosContratacion).
function mapearParametrosCuadro(registro) {
  return {
    tipoProceso: pc.TIPO_PROCESO_COTIZACION,
    p: 'procesoVistaCuadroPropuesta',
    d: registro.idProcesosContratacionFlujos,
  };
}

// Forma real confirmada (result.ofertasGlobal[]): cada oferta trae
// empresa.nombreComercial y un precioTotal ya sumado (todos los renglones +
// ITBMS). El usuario pidió mostrar SOLO el precio final por proponente,
// omitiendo el resto (desglose por ítem, fechas, códigos internos, etc.).
function normalizarCuadro(raw) {
  if (!raw || !Array.isArray(raw.ofertasGlobal)) {
    return { reconocido: false, proveedores: [] };
  }

  const proveedores = raw.ofertasGlobal
    .map(o => ({
      nombre: (o.empresa && o.empresa.nombreComercial) || 'Proveedor sin nombre',
      precioTotal: o.precioTotal != null ? Number(o.precioTotal) : null,
    }))
    .sort((a, b) => (b.precioTotal ?? -Infinity) - (a.precioTotal ?? -Infinity)); // mayor a menor

  return { reconocido: true, proveedores };
}

async function obtenerCuadroComparativo(registro) {
  const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
  const { tipoProceso, p, d } = mapearParametrosCuadro(registro);
  const { result } = await pc.cuadroPropuesta(cookie, tipoProceso, p, d);
  return normalizarCuadro(result);
}

module.exports = { listarEnviadas, obtenerCuadroComparativo };

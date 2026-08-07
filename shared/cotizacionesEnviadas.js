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
// p/d del endpoint cuadroPropuesta. HIPÓTESIS aún no confirmada con un caso
// real (PanamaCompra no llena el cuadro hasta que cierra el acto, y al
// momento de escribir esto ningún proceso de la cuenta había llegado a esa
// etapa). p = numProceso (string) y d = idProcesosContratacion (numérico)
// son los dos identificadores del mismo registro más consistentes con la
// forma de la URL del portal (`cuadroPropuesta/{tipoProceso}/{p}/{d}`).
// Si el día que un acto real muestre el cuadro esto no calza, es el ÚNICO
// lugar a corregir.
function mapearParametrosCuadro(registro) {
  return {
    tipoProceso: pc.TIPO_PROCESO_COTIZACION,
    p: registro.numProceso,
    d: registro.idProcesosContratacion,
  };
}

function extraerPrecioProveedor(item) {
  const candidatos = [item.montoTotal, item.total, item.precioTotal, item.monto, item.precio, item.montoOferta];
  for (const c of candidatos) {
    const n = Number(c);
    if (c != null && !Number.isNaN(n)) return n;
  }
  return null;
}

// La forma real de una respuesta con datos todavía no se ha visto (solo
// result:[] hasta ahora) — se normaliza de forma tolerante a un par de
// formas razonables, y si no calza con ninguna, se marca reconocido:false
// con el crudo adjunto para poder diagnosticar sin necesidad de redeploy.
function normalizarCuadro(raw) {
  let listaProveedor = null;
  if (Array.isArray(raw) && raw.length) listaProveedor = raw;
  else if (raw && Array.isArray(raw.listaProveedor)) listaProveedor = raw.listaProveedor;

  if (!listaProveedor) {
    return { reconocido: raw != null, proveedores: [], raw };
  }

  const proveedores = listaProveedor
    .map(p => ({
      nombre: p.nombreProveedor || p.proveedor || p.nombre || 'Proveedor sin nombre',
      precioTotal: extraerPrecioProveedor(p),
    }))
    .sort((a, b) => (a.precioTotal ?? Infinity) - (b.precioTotal ?? Infinity)); // menor a mayor

  return { reconocido: true, proveedores, raw };
}

async function obtenerCuadroComparativo(registro) {
  const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
  const { tipoProceso, p, d } = mapearParametrosCuadro(registro);
  const { result } = await pc.cuadroPropuesta(cookie, tipoProceso, p, d);
  return normalizarCuadro(result);
}

module.exports = { listarEnviadas, obtenerCuadroComparativo };

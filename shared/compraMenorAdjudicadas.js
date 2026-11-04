// "Compra menor hasta 10,000 - Adjudicado" donde la empresa envió
// propuesta: listado + detalle completo (datos del acto, entidad, contacto,
// ítems, la propuesta enviada con sus precios, motivo de adjudicación y
// todos los documentos: los de la propuesta y los adjuntos del pliego).
// Estructura confirmada en vivo 2026-11-03 contra la cuenta real de la
// empresa (16 actos, todos adjudicados a GS Technologies).
const pc = require('./panamacompra');

const TIPO = pc.TIPO_PROCESO_COMPRA_MENOR_10K;


// Solo se permite descargar rutas de archivos de procesos — el endpoint de
// descarga del cotizador recibe la ruta desde el navegador, y sin este
// filtro serviría de proxy autenticado a cualquier endpoint de la API de
// PanamaCompra con la sesión de la empresa.
const RUTA_ARCHIVO_RE = /^\/procesos-contratacion-archivos\/[A-Za-z0-9/_.-]+$/;

async function sesion() {
  return pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
}

async function listarAdjudicadas() {
  const cookie = await sesion();
  const registros = await pc.buscarEnviadasPorTipo(cookie, TIPO, pc.ESTADO_CM10K.ADJUDICADO);
  return registros
    .map(r => ({
      numProceso: r.numProceso,
      idProcesosContratacionFlujos: r.idProcesosContratacionFlujos,
      titulo: r.titulo,
      estado: r.nombreRealizado || '',
      objeto: r.nombreObjectoContractual || '',
      fechaEstado: r.fechaEstado || null,
    }))
    .sort((a, b) => new Date(b.fechaEstado || 0) - new Date(a.fechaEstado || 0));
}

// Secciones tipo lista de {nombre, value} -> objeto plano. Las etiquetas de
// PanamaCompra a veces traen espacio al final ("Modalidad de adjudicación ").
function camposDe(sec) {
  const out = {};
  for (const v of sec.value || []) {
    if (v && v.nombre) out[String(v.nombre).trim()] = v.value;
  }
  return out;
}

function archivo(f) {
  return {
    tipoArchivo: f.tipoArchivo || '',
    descripcion: f.descripcion || '',
    nombreOriginal: f.nombreOriginal || 'documento',
    rutaCompleta: f.rutaCompleta,
    fecha: f.fechaCreacion || '',
  };
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function detalleAdjudicada(idProcesosContratacionFlujos) {
  const cookie = await sesion();
  const [pliego, motivoSecs] = await Promise.all([
    pc.paginaComponentes(cookie, TIPO, 'procesoVistaPliego', idProcesosContratacionFlujos),
    // El motivo es opcional: si PanamaCompra falla en esta vista, el resto
    // del detalle (documentos, propuesta) igual sirve.
    pc.paginaComponentes(cookie, TIPO, 'procesoVistaMotivoAdjudicacion', idProcesosContratacionFlujos).catch(() => []),
  ]);

  const det = {
    proceso: {}, entidad: {}, contacto: {}, general: {}, condiciones: {}, proponente: {},
    items: [], propuestas: [], documentosPropuesta: [], documentosPliego: [], actas: [],
    motivo: [], procesoOriginal: null,
  };

  for (const sec of pliego) {
    const titulo = (sec.titulo || '').trim();
    const val = Array.isArray(sec.value) ? sec.value : [];
    switch (sec.tipo) {
      case 'componentInfoProcesos':
        if (titulo === 'Información de la entidad') det.entidad = camposDe(sec);
        else if (/condiciones/i.test(titulo)) det.condiciones = camposDe(sec);
        else if (/proponente/i.test(titulo)) det.proponente = camposDe(sec);
        else Object.assign(det.proceso, camposDe(sec));
        break;
      case 'componentInfoUsuario':
        det.contacto = camposDe(sec);
        break;
      case 'componentInfoGeneral':
        det.general = camposDe(sec);
        break;
      case 'componentItems':
        det.items = val.filter(i => i && typeof i.descripcion === 'string').map(i => ({
          numRenglon: i.numRenglon,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          unidad: i.unidad,
          precioReferencia: i.precioReferencia,
          precio: i.precio,
          itbms: i.itbms,
        }));
        break;
      case 'componentOfertasAdjudicadasProponentes':
        det.propuestas = val.map(o => {
          const items = (o.procesosOfertasItems || []).map(i => ({
            descripcion: i.descripcionProponente || (i.procesosContratacionItems && i.procesosContratacionItems.descripcion) || '',
            precio: i.precio,
            itbms: i.itbms,
            precioTotal: i.precioTotal,
          }));
          return {
            empresa: (o.empresa && o.empresa.nombreComercial) || '',
            fechaEnvio: o.fechaEnvio || null,
            codigoPropuesta: o.codigoPropuesta || '',
            items,
            total: round2(items.reduce((a, i) => a + Number(i.precioTotal || 0), 0)),
          };
        });
        break;
      case 'componentFilesOfertas':
        det.documentosPropuesta.push(...val.filter(f => f && f.rutaCompleta).map(archivo));
        break;
      case 'componentFiles':
        det.documentosPliego.push(...val.filter(f => f && f.rutaCompleta).map(archivo));
        break;
      case 'componentProcesosActasPliego':
        det.actas.push(...val.filter(a => a && a.nombre).map(a => ({ nombre: a.nombre, fecha: a.fecha || '' })));
        break;
      case 'componentInfoGeneracion': {
        const orig = val.find(g => g && g.titulo === 'Proceso Original');
        const p = orig && (orig.generacionProcesos || [])[0];
        if (p) det.procesoOriginal = { numProceso: p.numProceso, tipo: p.nombreProceso };
        break;
      }
      default:
        break;
    }
  }

  const motivoSec = motivoSecs.find(s => s.tipo === 'componentMotivoAdjudicacion');
  for (const o of (motivoSec && motivoSec.value) || []) {
    for (const i of o.procesosOfertasItems || []) {
      det.motivo.push({
        empresa: (o.empresa && o.empresa.nombreComercial) || '',
        adjudicado: i.esAdjudicado === 1,
        cumple: i.cumple === 1,
        observacion: i.observacion || '',
        precioTotal: i.precioTotal,
      });
    }
  }

  return det;
}

async function descargarDocumento(rutaCompleta) {
  if (!RUTA_ARCHIVO_RE.test(String(rutaCompleta || ''))) {
    const err = new Error('Ruta de documento no válida');
    err.status = 400;
    throw err;
  }
  const cookie = await sesion();
  return pc.descargarArchivo(cookie, rutaCompleta);
}

module.exports = { listarAdjudicadas, detalleAdjudicada, descargarDocumento };

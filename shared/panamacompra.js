const BASE = 'https://apisv3.panamacompra.gob.pa';
const COMMON_HEADERS = {
  'Content-Type': 'application/json;charset=utf-8',
  'Accept': 'application/json;charset=utf-8',
  'Origin': 'https://www.panamacompra.gob.pa',
  'Referer': 'https://www.panamacompra.gob.pa/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

const ESTADO = { ABIERTA: 8, CERRADA: 9, CANCELADO: 4 };
const TIPO_PROCESO_COTIZACION = 2;

function parseSetCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

async function login(usuario, contrasena) {
  const res = await fetch(`${BASE}/autenticacion/ingresar`, {
    method: 'POST',
    headers: COMMON_HEADERS,
    body: JSON.stringify({ usuario, contrasena }),
  });
  if (!res.ok) throw new Error(`Login falló: HTTP ${res.status}`);
  const cookie = parseSetCookies(res);
  if (!cookie) throw new Error('Login no devolvió cookies de sesión');
  return cookie;
}

async function buscarProceso(cookie, numProceso, idEstado) {
  const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, Cookie: cookie },
    body: JSON.stringify({
      registrosPorPagina: 10,
      valorSiguiente: '',
      filtro: { idTipoProceso: TIPO_PROCESO_COTIZACION, idEstado, numProceso },
    }),
  });
  if (!res.ok) throw new Error(`Búsqueda falló: HTTP ${res.status}`);
  const json = await res.json();
  return json.result.registros || [];
}

async function buscarProcesoCualquierEstado(cookie, numProceso) {
  for (const idEstado of [ESTADO.ABIERTA, ESTADO.CERRADA, ESTADO.CANCELADO]) {
    const registros = await buscarProceso(cookie, numProceso, idEstado);
    if (registros.length) return registros;
  }
  return [];
}

// Trae en una sola llamada todos los procesos de cotización actualmente
// "Abierta" (no filtrados por número de proceso), para poder buscar
// manualmente por rubro entre todo lo que hay publicado ahora mismo en
// PanamaCompra, sin depender de que llegue el correo de aviso.
async function buscarAbiertas(cookie, registrosPorPagina = 500) {
  const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, Cookie: cookie },
    body: JSON.stringify({
      registrosPorPagina,
      valorSiguiente: '',
      filtro: { idTipoProceso: TIPO_PROCESO_COTIZACION, idEstado: ESTADO.ABIERTA, numProceso: '' },
    }),
  });
  if (!res.ok) throw new Error(`Búsqueda de abiertas falló: HTTP ${res.status}`);
  const json = await res.json();
  return json.result.registros || [];
}

async function verPliego(cookie, idProcesosContratacionFlujos) {
  const res = await fetch(
    `${BASE}/procesos-configuracion/pagina-componentes/2/procesoVistaPliego/${idProcesosContratacionFlujos}`,
    { headers: { ...COMMON_HEADERS, Cookie: cookie } }
  );
  if (!res.ok) throw new Error(`Ver pliego falló: HTTP ${res.status}`);
  const json = await res.json();
  const secciones = json.result.pageComponentes;

  const campos = {};
  let items = [];
  for (const sec of secciones) {
    if (!Array.isArray(sec.value)) continue;
    if (sec.titulo === 'Ítems de la cotización') {
      items = sec.value
        .filter(i => i && typeof i.descripcion === 'string')
        .map(i => ({
          numRenglon: i.numRenglon,
          descripcion: i.descripcion,
          clasificacion: i.clasificacion,
          codigo: i.codigo,
          cantidad: i.cantidad,
          unidad: i.unidad,
          precioReferencia: i.precioReferencia,
        }))
        .sort((a, b) => (a.numRenglon || 0) - (b.numRenglon || 0));
      continue;
    }
    for (const item of sec.value) {
      if (item && item.nombre) campos[item.nombre.trim()] = item.value;
    }
  }
  return { campos, items };
}

function extraerPrecio(texto) {
  if (!texto) return null;
  const m = String(texto).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

module.exports = { login, buscarProceso, buscarProcesoCualquierEstado, buscarAbiertas, verPliego, extraerPrecio, ESTADO };

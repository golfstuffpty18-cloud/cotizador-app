const BASE = 'https://apisv3.panamacompra.gob.pa';
const COMMON_HEADERS = {
  'Content-Type': 'application/json;charset=utf-8',
  'Accept': 'application/json;charset=utf-8',
  'Origin': 'https://www.panamacompra.gob.pa',
  'Referer': 'https://www.panamacompra.gob.pa/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

const ESTADO = { ABIERTA: 8, CERRADA: 9, CANCELADO: 4, PROGRAMADA: 15 };
const TIPO_PROCESO_COTIZACION = 2;

// Sin esto, una llamada a PanamaCompra que nunca responde deja colgado el
// chequeo de correo para siempre: fetch() de Node no tiene timeout por
// defecto, así que un solo request atascado bloquea (running=true) todos
// los ciclos siguientes de cron-job.org hasta que Render reinicie el server.
const FETCH_TIMEOUT_MS = 20000;

function parseSetCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map(c => c.split(';')[0]).join('; ');
}

async function login(usuario, contrasena) {
  const res = await fetch(`${BASE}/autenticacion/ingresar`, {
    method: 'POST',
    headers: COMMON_HEADERS,
    body: JSON.stringify({ usuario, contrasena }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Búsqueda falló: HTTP ${res.status}`);
  const json = await res.json();
  return json.result.registros || [];
}

// "Programada" primero: cuando un proceso recién se publica, PanamaCompra
// suele mandar el correo de aviso mientras el proceso todavía está en este
// estado (ventana de cotización aún no abierta), y solo más tarde pasa a
// "Abierta". Buscar Programada primero evita el retraso de minutos/horas que
// había antes esperando a que el proceso apareciera como Abierta.
async function buscarProcesoCualquierEstado(cookie, numProceso) {
  for (const idEstado of [ESTADO.PROGRAMADA, ESTADO.ABIERTA, ESTADO.CERRADA, ESTADO.CANCELADO]) {
    const registros = await buscarProceso(cookie, numProceso, idEstado);
    if (registros.length) return registros;
  }
  return [];
}

// Trae en una sola llamada todos los procesos de cotización en los estados
// pedidos (no filtrados por número de proceso), para poder buscar
// manualmente por rubro entre todo lo publicado en PanamaCompra (abierto y
// programado), sin depender de que llegue el correo de aviso.
async function buscarPorEstados(cookie, estados, registrosPorPagina = 500) {
  const todos = [];
  for (const idEstado of estados) {
    const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
      method: 'POST',
      headers: { ...COMMON_HEADERS, Cookie: cookie },
      body: JSON.stringify({
        registrosPorPagina,
        valorSiguiente: '',
        filtro: { idTipoProceso: TIPO_PROCESO_COTIZACION, idEstado, numProceso: '' },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Búsqueda (idEstado=${idEstado}) falló: HTTP ${res.status}`);
    const json = await res.json();
    todos.push(...(json.result.registros || []));
  }
  return todos;
}

async function verPliego(cookie, idProcesosContratacionFlujos) {
  const res = await fetch(
    `${BASE}/procesos-configuracion/pagina-componentes/2/procesoVistaPliego/${idProcesosContratacionFlujos}`,
    { headers: { ...COMMON_HEADERS, Cookie: cookie }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`Ver pliego falló: HTTP ${res.status}`);
  const json = await res.json();
  const secciones = json.result.pageComponentes;

  const campos = {};
  let items = [];
  let archivos = [];
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
    // Sección "Archivos de la cotización" (tipo componentFiles): pliego,
    // especificaciones técnicas, diseños, etc. — antes se descartaba en
    // silencio porque no calzaba con el patrón genérico {nombre, value} de
    // abajo.
    if (sec.tipo === 'componentFiles') {
      archivos = sec.value
        .filter(f => f && f.rutaCompleta)
        .map(f => ({
          tipoArchivo: f.tipoArchivo || '',
          descripcion: f.descripcion || '',
          nombreOriginal: f.nombreOriginal || 'documento',
          rutaCompleta: f.rutaCompleta,
          mimetype: f.mimetype || '',
          extension: f.extension || '',
        }));
      continue;
    }
    for (const item of sec.value) {
      if (item && item.nombre) campos[item.nombre.trim()] = item.value;
    }
  }
  return { campos, items, archivos };
}

// Descarga el binario de un adjunto del pliego (rutaCompleta viene de
// verPliego). Requiere la misma cookie de sesión de PanamaCompra.
async function descargarArchivo(cookie, rutaCompleta) {
  const res = await fetch(`${BASE}${rutaCompleta}`, {
    headers: { ...COMMON_HEADERS, Accept: '*/*', Cookie: cookie },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Descarga de archivo falló: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extraerPrecio(texto) {
  if (!texto) return null;
  const m = String(texto).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

module.exports = { login, buscarProceso, buscarProcesoCualquierEstado, buscarPorEstados, verPliego, descargarArchivo, extraerPrecio, ESTADO };

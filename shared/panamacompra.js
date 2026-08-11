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

// "Compra Menor que exceda B/.10,000 hasta B/.50,000" — un tipo de proceso
// totalmente distinto a "Cotización en línea" (no un simple rango de precio
// sobre el mismo tipo, como se asumió al principio). Confirmado en vivo con
// un acto real: idTipoProceso 6, idEstado 36 = "Vigente" (el estado donde
// todavía se puede presentar propuesta — no tiene un equivalente separado
// de "Programada" como Cotización en línea).
const TIPO_PROCESO_COMPRA_MENOR = 6;
const ESTADO_COMPRA_MENOR = { VIGENTE: 36 };

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

async function buscarProceso(cookie, numProceso, idEstado, idTipoProceso = TIPO_PROCESO_COTIZACION) {
  const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, Cookie: cookie },
    body: JSON.stringify({
      registrosPorPagina: 10,
      valorSiguiente: '',
      filtro: { idTipoProceso, idEstado, numProceso },
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
  // También puede ser un acto de "Compra Menor" (tipo de proceso distinto,
  // con muchos más estados posibles que Cotización en línea — Vigente,
  // Adjudicado, Desierto, Por adjudicar, etc.) — se busca con idEstado:0
  // (cualquier estado) en vez de enumerarlos todos uno por uno.
  const compraMenor = await buscarProceso(cookie, numProceso, 0, TIPO_PROCESO_COMPRA_MENOR);
  if (compraMenor.length) return compraMenor;
  return [];
}

// Trae en una sola llamada todos los procesos de cotización en los estados
// pedidos (no filtrados por número de proceso), para poder buscar
// manualmente por rubro entre todo lo publicado en PanamaCompra (abierto y
// programado), sin depender de que llegue el correo de aviso.
async function buscarPorEstados(cookie, estados, registrosPorPagina = 500, idTipoProceso = TIPO_PROCESO_COTIZACION) {
  const todos = [];
  for (const idEstado of estados) {
    const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
      method: 'POST',
      headers: { ...COMMON_HEADERS, Cookie: cookie },
      body: JSON.stringify({
        registrosPorPagina,
        valorSiguiente: '',
        filtro: { idTipoProceso, idEstado, numProceso: '' },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Búsqueda (idEstado=${idEstado}) falló: HTTP ${res.status}`);
    const json = await res.json();
    todos.push(...(json.result.registros || []));
  }
  return todos;
}

// Procesos donde la empresa YA envió oferta. Mismo endpoint que
// buscarPorEstados, agregando enviada:true al filtro — descubierto leyendo
// el bundle JS del portal-interno de PanamaCompra (así arma la pantalla
// "Cotización en línea > Enviadas") y confirmado en vivo contra la cuenta
// real de la empresa.
async function buscarEnviadas(cookie, registrosPorPagina = 100) {
  const res = await fetch(`${BASE}/busqueda/proceso-lista`, {
    method: 'POST',
    headers: { ...COMMON_HEADERS, Cookie: cookie },
    body: JSON.stringify({
      registrosPorPagina,
      valorSiguiente: '',
      filtro: { idTipoProceso: TIPO_PROCESO_COTIZACION, idEstado: 0, enviada: true, numProceso: '' },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Búsqueda de enviadas falló: HTTP ${res.status}`);
  const json = await res.json();
  return json.result.registros || [];
}

// Cuadro comparativo de precios entre todos los participantes de un
// proceso. Solo lo llena PanamaCompra después de que cierra la ventana de
// recepción de ofertas del acto — antes de eso, responde vacío.
async function cuadroPropuesta(cookie, tipoProceso, p, d) {
  const res = await fetch(`${BASE}/documentos-actos-publico/cuadroPropuesta/${tipoProceso}/${p}/${d}`, {
    headers: { ...COMMON_HEADERS, Cookie: cookie },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Cuadro de propuesta falló: HTTP ${res.status}`);
  return res.json();
}

async function verPliego(cookie, idProcesosContratacionFlujos, idTipoProceso = TIPO_PROCESO_COTIZACION) {
  // El segmento que parecía una constante fija ("2") es en realidad el
  // idTipoProceso — coincidía por casualidad con Cotización en línea, que
  // también es tipo 2. Para otros tipos (ej. Compra Menor = 6) hay que
  // pasar el valor real, si no la API responde "Proceso Denegado".
  const res = await fetch(
    `${BASE}/procesos-configuracion/pagina-componentes/${idTipoProceso}/procesoVistaPliego/${idProcesosContratacionFlujos}`,
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
    // Se identifica por sec.tipo, no por el título — el título cambia según
    // el tipo de proceso ("Ítems de la cotización" en Cotización en línea,
    // "Ítems de compra menor" en Compra Menor), pero el tipo de componente
    // ("componentItems") es el mismo en ambos.
    if (sec.tipo === 'componentItems') {
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
    // Sección de archivos adjuntos (pliego, especificaciones técnicas,
    // diseños, etc.), identificada igual por tipo de componente — antes se
    // descartaba en silencio porque no calzaba con el patrón genérico
    // {nombre, value} de abajo.
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

  // Alias de campos: distintos tipos de proceso usan etiquetas distintas
  // para el mismo dato (ej. Compra Menor dice "Precio de referencia" y
  // "Fecha y hora presentación de propuestas" donde Cotización en línea
  // dice "Precio estimado" y "...de cotizaciones"). Se normalizan a las
  // claves que ya usa el resto del código, para no tener que enseñarle
  // estas variantes a cada consumidor de verPliego.
  if (campos['Precio estimado'] == null && campos['Precio de referencia'] != null) {
    campos['Precio estimado'] = campos['Precio de referencia'];
  }
  if (campos['Fecha y hora presentación de cotizaciones'] == null && campos['Fecha y hora presentación de propuestas'] != null) {
    campos['Fecha y hora presentación de cotizaciones'] = campos['Fecha y hora presentación de propuestas'];
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

module.exports = {
  login, buscarProceso, buscarProcesoCualquierEstado, buscarPorEstados, buscarEnviadas,
  verPliego, descargarArchivo, cuadroPropuesta, extraerPrecio, ESTADO, TIPO_PROCESO_COTIZACION,
  TIPO_PROCESO_COMPRA_MENOR, ESTADO_COMPRA_MENOR,
};

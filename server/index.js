const express = require('express');
// Sin esto, un error inesperado dentro de una ruta async (ej. un fallo de
// Postgres al guardar un borrador) no llega a ningún manejador en Express 4
// — la petición se queda colgada para siempre en el navegador, sin
// respuesta ni error visible. express-async-errors parchea las rutas para
// que cualquier rechazo de promesa caiga en el manejador de errores de abajo.
require('express-async-errors');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { pool, init } = require('../shared/db');
const { generateQuotePdf } = require('../shared/generateQuotePdf');
const { generateQuoteExcel, COMPANY } = require('../shared/generateQuoteExcel');
const { CATEGORY_KEYWORDS, EXCLUDE_KEYWORDS } = require('../shared/evaluate');
const { encryptSecret } = require('../shared/crypto');
const { resolveCompanyId } = require('../shared/tenant');
const { parseQuoteExcel } = require('../shared/parseQuoteExcel');
const { suggestPricesForItems, upsertFromQuoteItems, importCatalogRows } = require('../shared/catalog');
const { parseCatalogExcel } = require('../shared/parseCatalogExcel');
const { runCheckEmailJob } = require('../shared/checkEmailJob');
const { sendPushToAll } = require('../shared/push');
const { searchOpenByCategory, searchCompraMenor, runSearchJob } = require('../shared/searchPanamaCompra');
const { uploadToDropboxSafe, dropboxSubfolderFor } = require('../shared/dropboxUpload');
const { syncOpportunityDocs } = require('../shared/syncOpportunityDocs');
const { listarEnviadas, obtenerCuadroComparativo } = require('../shared/cotizacionesEnviadas');
const { extractInvoiceData } = require('../shared/claudeInvoice');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.APP_ACCESS_CODE || '';
const COOKIE_NAME = 'cotizador_auth';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// Fotos de factura tomadas con la cámara del celular pesan bastante más que
// un Excel — límite aparte para no tener que subir el de las demás rutas.
const uploadFactura = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Estado del respaldo a Dropbox del Excel de cada oportunidad ('uploading'/
// 'done'/'error'), en memoria — el proceso solo corre en una instancia, así
// que no hace falta persistirlo. Sirve para que el frontend avise cuándo ya
// es seguro abrir la copia de Dropbox, en vez de que el usuario adivine y se
// tope con el "no lo hemos encontrado" de Excel por abrirla a medio subir.
const dropboxBackupStatus = new Map();

// Límite por defecto de Express es 100kb — muy chico para el POST de
// confirmación de /api/finanzas, que manda la foto/PDF de la factura
// codificada en base64 dentro del JSON (base64 pesa ~33% más que el
// archivo original; el límite de multer para ese archivo ya es 15MB).
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

function requireAuth(req, res, next) {
  if (req.path.startsWith('/api/cron/')) return next(); // tienen su propia llave secreta
  if (!ACCESS_CODE) return next(); // no code configured -> open (local/dev only)
  if (req.cookies[COOKIE_NAME] === ACCESS_CODE) return next();
  if (req.path === '/login.html' || req.path === '/api/login' || req.path.startsWith('/icons/') || req.path === '/manifest.json' || req.path === '/sw.js') {
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'no autorizado' });
  return res.redirect('/login.html');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/login', (req, res) => {
  const { code } = req.body || {};
  if (!ACCESS_CODE || code !== ACCESS_CODE) return res.status(401).json({ error: 'código incorrecto' });
  res.cookie(COOKIE_NAME, ACCESS_CODE, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 365 });
  res.json({ ok: true });
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

app.post('/api/push/subscribe', async (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ error: 'suscripción inválida' });
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, company_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (company_id, endpoint) DO NOTHING`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, resolveCompanyId(req)]
  );
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'falta endpoint' });
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  res.json({ ok: true });
});

// "Programada" es dinámico, no un estado guardado que haya que mantener
// sincronizado: si window_start (la hora en que PanamaCompra la pasa a
// "Abierta" automáticamente) todavía no llegó, es programada; en cuanto
// pasa, sin que nadie tenga que volver a consultar PanamaCompra, cae sola en
// la pantalla principal. pc_estado='programada' es solo el respaldo para
// las pocas filas donde window_info no se pudo parsear.
//
// COALESCE(...,false) es necesario: sin él, una fila con window_start Y
// pc_estado ambos NULL (ej. Compra Menor, que nunca tiene "programada")
// evalúa la comparación "pc_estado = 'programada'" a NULL en vez de false
// (lógica de 3 valores de SQL) — eso propaga NULL a través del OR, y luego
// NOT NULL también es NULL, así que la fila desaparecía de AMBAS vistas en
// vez de quedarse en "hoy". Bug real, encontrado probando en producción con
// la cotización de Cultura (Compra Menor) justo después del primer deploy.
const ES_PROGRAMADA_SQL = `COALESCE((window_start IS NOT NULL AND window_start > now()) OR (window_start IS NULL AND pc_estado = 'programada'), false)`;

app.get('/api/opportunities', async (req, res) => {
  const source = req.query.source || 'panamacompra';
  const vista = req.query.vista === 'programadas' ? 'programadas' : 'hoy';
  const condicionVista = vista === 'programadas' ? ES_PROGRAMADA_SQL : `NOT ${ES_PROGRAMADA_SQL}`;
  // 'cotizacion_linea'/'compra_menor' separan las pantallas de Cotización en
  // línea y Compra Menor, que antes vivían juntas en la misma lista.
  const params = [source, resolveCompanyId(req)];
  let condicionTipo = '';
  if (req.query.tipo === 'cotizacion_linea' || req.query.tipo === 'compra_menor') {
    params.push(req.query.tipo);
    condicionTipo = `AND tipo_proceso = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM opportunities
     WHERE (deadline IS NULL OR deadline > now())
       AND decision != 'no_participar'
       AND source = $1
       AND company_id = $2
       AND ${condicionVista}
       ${condicionTipo}
     ORDER BY created_at DESC LIMIT 100`,
    params
  );
  res.json(rows);
});

// Cotización para un cliente fuera de PanamaCompra: no hay pliego del que
// sacar los ítems, así que el usuario los escribe él mismo (descripción +
// cantidad). A partir de ahí reutiliza exactamente el mismo flujo de
// quote.html (Excel con sugerencias del catálogo, análisis de rentabilidad,
// PDF) que las oportunidades de PanamaCompra.
app.post('/api/opportunities/directo', async (req, res) => {
  const { titulo, categoria, items } = req.body || {};
  if (!titulo || !categoria) return res.status(400).json({ error: 'faltan título o categoría' });
  const safeItems = Array.isArray(items) ? items.filter(i => i && i.descripcion) : [];
  if (!safeItems.length) return res.status(400).json({ error: 'agrega al menos un ítem con descripción' });

  const normalizedItems = safeItems.map((i, idx) => ({
    numRenglon: idx + 1,
    descripcion: i.descripcion,
    modelo: i.modelo || '',
    cantidad: Number(i.cantidad) || 1,
  }));

  const { rows } = await pool.query(
    `INSERT INTO opportunities
      (act_number, convocatoria, title, entity, items, category, category_match, recommendation, reasoning, decision, source, company_id)
     VALUES ($1,'1',$2,$2,$3,$4,true,'participar','Cotización directa con cliente (fuera de PanamaCompra).','participar','directo',$5)
     RETURNING *`,
    [`DIRECTO-${Date.now()}`, titulo, JSON.stringify(normalizedItems), categoria, resolveCompanyId(req)]
  );
  res.json(rows[0]);
});

// Solo cotizaciones directas: las de PanamaCompra se ocultan con
// decision='no_participar' (se conserva el historial), pero una cotización
// directa sin terminar es solo desorden en pantalla — se puede borrar.
app.delete('/api/opportunities/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT source FROM opportunities WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  if (rows[0].source !== 'directo') {
    return res.status(400).json({ error: 'solo se pueden borrar cotizaciones directas' });
  }
  await pool.query('DELETE FROM opportunities WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/opportunities/:id/decision', async (req, res) => {
  const { decision } = req.body || {};
  if (!['participar', 'no_participar', 'pending'].includes(decision)) {
    return res.status(400).json({ error: 'decisión inválida' });
  }
  const { rows } = await pool.query(
    `UPDATE opportunities SET decision = $1, decided_at = now() WHERE id = $2 RETURNING *`,
    [decision, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  if (decision === 'participar') syncOpportunityDocs(rows[0]); // en segundo plano, no bloquea la respuesta
  res.json(rows[0]);
});

// Re-sincroniza manualmente los documentos adjuntos del acto (carpeta de
// Dropbox del cliente + texto extraído). Sirve para oportunidades que ya
// estaban en 'participar' antes de que existiera esta función, o para volver
// a intentar si algo cambió en el portal. Corre en segundo plano igual que
// el disparador automático — la respuesta no espera a que termine.
app.post('/api/opportunities/:id/sync-documentos', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  const result = await syncOpportunityDocs(rows[0]);
  if (!result.ok) return res.status(502).json({ error: result.error });
  let mensaje = result.count ? `${result.count} documento(s) sincronizado(s).` : 'El acto no trae documentos adjuntos en PanamaCompra.';
  if (result.dropboxFailures) {
    mensaje += ` ⚠️ ${result.dropboxFailures} no se pudo(eron) respaldar en Dropbox — vuelve a intentar antes de salir sin conexión a tus archivos locales.`;
  }
  res.json({ ok: true, count: result.count, dropboxFailures: result.dropboxFailures, mensaje });
});

app.get('/api/opportunities/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(rows[0]);
});

// Solo aplica a Detección de Incendio: convencional y direccionable son
// arquitecturas incompatibles entre sí, y el texto del pliego casi nunca
// aclara cuál es. Se pregunta una sola vez por oportunidad y esa respuesta
// dirige la búsqueda de precios de TODA la cotización (no por ítem).
app.post('/api/opportunities/:id/tecnologia', async (req, res) => {
  const { tecnologia } = req.body || {};
  if (!['Convencional', 'Direccionable'].includes(tecnologia)) {
    return res.status(400).json({ error: 'tecnologia debe ser Convencional o Direccionable' });
  }
  const { rows } = await pool.query(
    `UPDATE opportunities SET tecnologia_incendio = $1 WHERE id = $2 RETURNING *`,
    [tecnologia, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(rows[0]);
});

app.get('/api/opportunities/:id/quote', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM quotes WHERE opportunity_id = $1', [req.params.id]);
  if (!rows.length) return res.json(null);
  const { pdf, ...rest } = rows[0];
  res.json(rest);
});

function computeTotals(items) {
  const rawSubtotal = items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precioUnitario) || 0), 0);
  // Redondeado a centavos en cada paso (igual que en el Excel,
  // generateQuoteExcel.js) — si no, además del desfase de 1 centavo contra
  // PanamaCompra, sumar varios renglones/ITBM en punto flotante deja
  // residuos binarios (ej. 374.96000000000004) que se ven bien en pantalla
  // por el formato, pero quedan guardados sucios en la base de datos.
  const subtotal = Math.round(rawSubtotal * 100) / 100;
  const itbm = Math.round(subtotal * 0.07 * 100) / 100;
  const total = Math.round((subtotal + itbm) * 100) / 100;
  return { subtotal, itbm, total };
}

async function saveDraft(oppId, data) {
  const { cliente_nombre, cliente_ruc, cliente_direccion, cliente_ciudad, forma_pago, comentarios, items } = data;
  const safeItems = Array.isArray(items) ? items : [];
  const { subtotal, itbm, total } = computeTotals(safeItems);

  // company_id se deriva de la propia oportunidad (subquery), no se recibe
  // por parámetro — así es imposible que quotes.company_id quede
  // desalineado del de opportunities.company_id.
  const { rows } = await pool.query(
    `INSERT INTO quotes (opportunity_id, cliente_nombre, cliente_ruc, cliente_direccion, cliente_ciudad, forma_pago, comentarios, items, subtotal, itbm, total, updated_at, company_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), (SELECT company_id FROM opportunities WHERE id = $1))
     ON CONFLICT (opportunity_id) DO UPDATE SET
       cliente_nombre = EXCLUDED.cliente_nombre,
       cliente_ruc = EXCLUDED.cliente_ruc,
       cliente_direccion = EXCLUDED.cliente_direccion,
       cliente_ciudad = EXCLUDED.cliente_ciudad,
       forma_pago = EXCLUDED.forma_pago,
       comentarios = EXCLUDED.comentarios,
       items = EXCLUDED.items,
       subtotal = EXCLUDED.subtotal,
       itbm = EXCLUDED.itbm,
       total = EXCLUDED.total,
       updated_at = now()
     WHERE quotes.estado = 'borrador'
     RETURNING *`,
    [oppId, cliente_nombre, cliente_ruc, cliente_direccion, cliente_ciudad, forma_pago || 'Crédito', comentarios,
     JSON.stringify(safeItems), subtotal, itbm, total]
  );
  return rows[0] || null;
}

app.post('/api/opportunities/:id/quote', async (req, res) => {
  const row = await saveDraft(req.params.id, req.body || {});
  if (!row) return res.status(409).json({ error: 'la cotización ya fue aprobada y no se puede editar' });
  const { pdf, ...rest } = row;
  res.json(rest);
});

app.get('/api/opportunities/:id/quote/excel', async (req, res) => {
  const oppId = req.params.id;
  const { rows: oppRows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
  if (!oppRows.length) return res.status(404).send('Oportunidad no encontrada');
  const { rows: quoteRows } = await pool.query('SELECT * FROM quotes WHERE opportunity_id = $1', [oppId]);
  const quote = quoteRows[0] || null;

  const opportunity = oppRows[0];
  const baseItems = (quote && quote.items && quote.items.length) ? quote.items : (opportunity.items || []);
  const suggestedItems = await suggestPricesForItems(baseItems, opportunity.category, opportunity.tecnologia_incendio, opportunity.company_id);
  const effectiveQuote = quote ? { ...quote, items: suggestedItems } : { items: suggestedItems };

  const buffer = await generateQuoteExcel({ opportunity, quote: effectiveQuote });
  const dropboxSubfolder = dropboxSubfolderFor(opportunity);
  // Respaldo best-effort, no bloquea la descarga real (el usuario la necesita
  // ya) — pero se trackea en dropboxBackupStatus para que el frontend pueda
  // avisar cuándo es seguro abrir la copia de Dropbox en vez de adivinar.
  dropboxBackupStatus.set(oppId, { status: 'uploading' });
  uploadToDropboxSafe(`${opportunity.title} - ${opportunity.act_number}.xlsx`, buffer, dropboxSubfolder)
    .then(result => dropboxBackupStatus.set(oppId, result.ok ? { status: 'done' } : { status: 'error', error: result.error }));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cotizacion-${oppId}.xlsx"`);
  res.send(buffer);
});

app.get('/api/opportunities/:id/dropbox-backup-status', (req, res) => {
  res.json(dropboxBackupStatus.get(req.params.id) || { status: 'idle' });
});

app.post('/api/opportunities/:id/quote/upload', upload.single('file'), async (req, res) => {
  const oppId = req.params.id;
  if (!req.file) return res.status(400).json({ error: 'no se recibió ningún archivo' });

  let parsed;
  try {
    parsed = await parseQuoteExcel(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const row = await saveDraft(oppId, parsed);
  if (!row) return res.status(409).json({ error: 'la cotización ya fue aprobada y no se puede editar' });
  const { pdf, ...rest } = row;
  res.json({ ...rest, isKnownTemplate: parsed.isKnownTemplate });
});

// Reabre una cotización ya aprobada para poder modificarla (ej. el cliente
// pidió un cambio después de recibir el PDF). Vuelve el estado a 'borrador'
// para que Paso 1/Paso 2 se puedan usar de nuevo con los últimos datos
// guardados; el PDF anterior sigue disponible hasta que se apruebe de
// nuevo, momento en el que se reemplaza (mismo comportamiento que ya tenía
// el respaldo en Dropbox, que sube en modo "overwrite").
app.post('/api/opportunities/:id/quote/unlock', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE quotes SET estado = 'borrador', updated_at = now() WHERE opportunity_id = $1 AND estado = 'aprobada' RETURNING *`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'no hay una cotización aprobada para modificar' });
  const { pdf, ...rest } = rows[0];
  res.json(rest);
});

app.post('/api/opportunities/:id/quote/approve', async (req, res) => {
  const oppId = req.params.id;
  const { rows } = await pool.query('SELECT * FROM quotes WHERE opportunity_id = $1', [oppId]);
  if (!rows.length) return res.status(404).json({ error: 'primero guarda un borrador de cotización' });
  const quote = rows[0];

  const { rows: oppRows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
  const opportunity = oppRows[0];

  const pdfBuffer = await generateQuotePdf({ quote, opportunity });
  const dropboxSubfolder = dropboxSubfolderFor(opportunity);
  uploadToDropboxSafe(`${opportunity.title} - ${opportunity.act_number}.pdf`, pdfBuffer, dropboxSubfolder); // respaldo best-effort, no bloquea la aprobación

  await pool.query(
    `UPDATE quotes SET estado = 'aprobada', pdf = $1, approved_at = now(), updated_at = now() WHERE opportunity_id = $2`,
    [pdfBuffer, oppId]
  );

  try {
    await upsertFromQuoteItems(quote.items || [], {}, opportunity.company_id);
  } catch (err) {
    console.error('No se pudo actualizar el catálogo:', err.message);
  }

  res.json({ ok: true, estado: 'aprobada' });
});

app.get('/api/opportunities/:id/quote/pdf', async (req, res) => {
  const { rows } = await pool.query('SELECT pdf, opportunity_id FROM quotes WHERE opportunity_id = $1', [req.params.id]);
  if (!rows.length || !rows[0].pdf) return res.status(404).send('PDF no disponible. Aprueba la cotización primero.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="cotizacion-${req.params.id}.pdf"`);
  res.send(rows[0].pdf);
});

app.all('/api/cron/check-email', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  try {
    const result = await runCheckEmailJob(resolveCompanyId(req));
    res.json(result);
  } catch (err) {
    console.error('Error en /api/cron/check-email:', err);
    res.status(500).json({ error: err.message });
  }
});

// Camino principal para detectar oportunidades: busca directo en
// PanamaCompra por rubro (Cotización en línea + Compra Menor), sin depender
// del correo/IMAP. Pensado para dispararse solo con un cron externo
// (cron-job.org), igual que /api/cron/check-email, para que las pantallas ya
// tengan lo del día sin tener que presionar los íconos de buscar a mano.
app.all('/api/cron/search-panamacompra', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  try {
    const result = await runSearchJob(resolveCompanyId(req));
    res.json(result);
  } catch (err) {
    console.error('Error en /api/cron/search-panamacompra:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/enviadas', async (req, res) => {
  res.json(await listarEnviadas());
});

app.get('/api/enviadas/:idProcesosContratacionFlujos/cuadro', async (req, res) => {
  const cuadro = await obtenerCuadroComparativo({ idProcesosContratacionFlujos: req.params.idProcesosContratacionFlujos });
  res.json(cuadro);
});

app.post('/api/search/panamacompra', async (req, res) => {
  try {
    const result = await searchOpenByCategory(resolveCompanyId(req));
    res.json(result);
  } catch (err) {
    console.error('Error en búsqueda manual de PanamaCompra:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/search/rango-precio', async (req, res) => {
  res.json(await searchCompraMenor(resolveCompanyId(req)));
});

app.all('/api/cron/test-push', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  try {
    const { rows: subs } = await pool.query('SELECT id, created_at FROM push_subscriptions');
    const payload = JSON.stringify({
      title: '🔔 Prueba manual',
      body: `Notificación de prueba — ${new Date().toLocaleString('es-PA')}`,
      url: '/',
    });
    const results = await sendPushToAll(payload);
    res.json({ ok: true, subscriberCount: subs.length, subscriptions: subs, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const CATEGORIAS = ['CCTV', 'Alarma de Intrusión', 'Control de Acceso', 'Control de Asistencia', 'Detección de Incendio', 'Automatización', 'Voz y Datos', 'Materiales', 'Otro'];

app.get('/api/catalog/categorias', (req, res) => res.json(CATEGORIAS));

// Importación masiva desde un Excel de precios "libre" (lista propia del
// usuario o de un proveedor, no la plantilla de cotización). `categoria` en
// el body es opcional: se usa para las filas que no traigan su propia
// columna de categoría — útil cuando el archivo entero es de un solo rubro
// (ej. "materiales.xlsx" con tuberías, cajas, tapas, conectores...).
app.post('/api/catalog/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no se recibió ningún archivo' });

  let parsed;
  try {
    parsed = await parseCatalogExcel(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const defaultCategoria = (req.body && req.body.categoria) || (req.query && req.query.categoria) || null;
  const resumen = await importCatalogRows(parsed.rows, { defaultCategoria }, resolveCompanyId(req));
  res.json({ ok: true, ...resumen });
});

app.get('/api/catalog', async (req, res) => {
  const { categoria, search } = req.query;
  const clauses = [];
  const params = [resolveCompanyId(req)];
  if (categoria) { params.push(categoria); clauses.push(`categoria = $${params.length}`); }
  if (search) { params.push(`%${search}%`); clauses.push(`descripcion ILIKE $${params.length}`); }
  const where = ['company_id = $1', ...clauses].join(' AND ');
  const { rows } = await pool.query(`SELECT * FROM catalog_items WHERE ${where} ORDER BY updated_at DESC LIMIT 300`, params);
  res.json(rows);
});

app.post('/api/catalog', async (req, res) => {
  const { descripcion, categoria, subcategoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas } = req.body || {};
  if (!descripcion) return res.status(400).json({ error: 'falta descripción' });
  const { rows } = await pool.query(
    `INSERT INTO catalog_items (descripcion, categoria, subcategoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas, fecha_cotizacion, company_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10) RETURNING *`,
    [descripcion, categoria || null, subcategoria || null, marca || null, modelo || null, costo_distribuidor || null, margen_g || null, proveedor || null, notas || null, resolveCompanyId(req)]
  );
  res.json(rows[0]);
});

app.put('/api/catalog/:id', async (req, res) => {
  const { descripcion, categoria, subcategoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE catalog_items SET
       descripcion = COALESCE($1, descripcion), categoria = $2, subcategoria = $3, marca = $4, modelo = $5,
       costo_distribuidor = $6, margen_g = $7, proveedor = $8, notas = $9, updated_at = now()
     WHERE id = $10 AND company_id = $11 RETURNING *`,
    [descripcion, categoria || null, subcategoria || null, marca || null, modelo || null, costo_distribuidor || null, margen_g || null, proveedor || null, notas || null, req.params.id, resolveCompanyId(req)]
  );
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(rows[0]);
});

app.delete('/api/catalog/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog_items WHERE id = $1 AND company_id = $2', [req.params.id, resolveCompanyId(req)]);
  res.json({ ok: true });
});

// ---- Finanzas: facturas de gasto (compras/proveedores) y emitidas (a clientes) ----

// Solo extrae y devuelve la propuesta — no guarda nada todavía. El archivo
// vuelve al cliente en base64 para que lo reenvíe tal cual en el POST de
// confirmación; así no hace falta guardar estado temporal en el servidor
// entre "extraer" y "guardar".
app.post('/api/finanzas/extraer', uploadFactura.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no se recibió ningún archivo' });
  let extraido;
  try {
    extraido = await extractInvoiceData(req.file.buffer, req.file.mimetype);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({
    extraido,
    archivo_nombre: req.file.originalname,
    archivo_tipo: req.file.mimetype,
    archivo_base64: req.file.buffer.toString('base64'),
  });
});

app.get('/api/finanzas', async (req, res) => {
  const { tipo, anio, mes, proyecto } = req.query;
  const clauses = [];
  const params = [resolveCompanyId(req)];
  if (tipo) { params.push(tipo); clauses.push(`tipo = $${params.length}`); }
  if (proyecto) { params.push(proyecto); clauses.push(`proyecto = $${params.length}`); }
  if (anio) { params.push(anio); clauses.push(`EXTRACT(YEAR FROM fecha) = $${params.length}`); }
  if (mes) { params.push(mes); clauses.push(`EXTRACT(MONTH FROM fecha) = $${params.length}`); }
  const where = ['company_id = $1', ...clauses].join(' AND ');
  const { rows } = await pool.query(
    `SELECT id, tipo, contraparte, ruc, numero_factura, fecha, subtotal, itbm, total, proyecto, notas, archivo_nombre, archivo_tipo, created_at
     FROM finance_invoices WHERE ${where} ORDER BY fecha DESC NULLS LAST, created_at DESC LIMIT 500`,
    params
  );
  res.json(rows);
});

app.get('/api/finanzas/proyectos', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT proyecto FROM finance_invoices WHERE proyecto IS NOT NULL AND proyecto != '' AND company_id = $1 ORDER BY proyecto`,
    [resolveCompanyId(req)]
  );
  res.json(rows.map((r) => r.proyecto));
});

// Ganancia = total emitido - total de gastos, tanto del año consultado como
// desglosado por proyecto (a partir del texto libre que el usuario escribe
// al guardar cada factura — ver nota en finanzas.html sobre por qué no es
// una FK a opportunities).
app.get('/api/finanzas/resumen', async (req, res) => {
  const anio = req.query.anio || new Date().getFullYear();
  const companyId = resolveCompanyId(req);
  const { rows: porAnio } = await pool.query(
    `SELECT tipo, COALESCE(SUM(total),0) AS total FROM finance_invoices WHERE EXTRACT(YEAR FROM fecha) = $1 AND company_id = $2 GROUP BY tipo`,
    [anio, companyId]
  );
  const { rows: porProyecto } = await pool.query(
    `SELECT proyecto, tipo, COALESCE(SUM(total),0) AS total FROM finance_invoices
     WHERE proyecto IS NOT NULL AND proyecto != '' AND company_id = $1 GROUP BY proyecto, tipo ORDER BY proyecto`,
    [companyId]
  );

  const totales = { emitida: 0, gasto: 0 };
  for (const r of porAnio) totales[r.tipo] = Number(r.total);

  const proyectos = {};
  for (const r of porProyecto) {
    if (!proyectos[r.proyecto]) proyectos[r.proyecto] = { proyecto: r.proyecto, emitida: 0, gasto: 0 };
    proyectos[r.proyecto][r.tipo] = Number(r.total);
  }
  const por_proyecto = Object.values(proyectos).map((p) => ({ ...p, ganancia: p.emitida - p.gasto }));

  res.json({
    anio: Number(anio),
    total_emitido: totales.emitida,
    total_gastos: totales.gasto,
    ganancia: totales.emitida - totales.gasto,
    por_proyecto,
  });
});

app.get('/api/finanzas/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, tipo, contraparte, ruc, direccion, telefono, correo, numero_factura, fecha, subtotal, itbm, total, proyecto, items, notas, archivo_nombre, archivo_tipo, created_at
     FROM finance_invoices WHERE id = $1 AND company_id = $2`,
    [req.params.id, resolveCompanyId(req)]
  );
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(rows[0]);
});

app.get('/api/finanzas/:id/archivo', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT archivo, archivo_tipo, archivo_nombre FROM finance_invoices WHERE id = $1 AND company_id = $2`,
    [req.params.id, resolveCompanyId(req)]
  );
  if (!rows.length || !rows[0].archivo) return res.status(404).send('no encontrado');
  res.set('Content-Type', rows[0].archivo_tipo || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${String(rows[0].archivo_nombre || 'archivo').replace(/"/g, '')}"`);
  res.send(rows[0].archivo);
});

app.post('/api/finanzas', async (req, res) => {
  const {
    tipo, contraparte, ruc, direccion, telefono, correo, numero_factura, fecha, subtotal, itbm, total,
    proyecto, items, notas, archivo_nombre, archivo_tipo, archivo_base64, datos_extraidos,
    confirmar_duplicado,
  } = req.body || {};
  if (!tipo || !['gasto', 'emitida'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser "gasto" o "emitida"' });
  if (total == null || total === '') return res.status(400).json({ error: 'falta el total' });

  // Aviso de posible duplicado (no bloquea): mismo # de factura + mismo
  // proveedor/cliente ya guardado — típico de tocar "Guardar" dos veces o
  // re-subir por error una foto ya procesada. El usuario confirma a
  // propósito con confirmar_duplicado=true si de verdad quiere guardarla
  // igual (ej. una nota de crédito con el mismo número que la original).
  const companyId = resolveCompanyId(req);

  if (numero_factura && contraparte && !confirmar_duplicado) {
    const { rows: existentes } = await pool.query(
      `SELECT id, tipo, contraparte, numero_factura, fecha, total FROM finance_invoices
       WHERE LOWER(numero_factura) = LOWER($1) AND LOWER(contraparte) = LOWER($2) AND company_id = $3`,
      [numero_factura, contraparte, companyId]
    );
    if (existentes.length) return res.status(409).json({ duplicado: true, existentes });
  }

  const archivoBuffer = archivo_base64 ? Buffer.from(archivo_base64, 'base64') : null;

  const { rows } = await pool.query(
    `INSERT INTO finance_invoices
       (tipo, contraparte, ruc, direccion, telefono, correo, numero_factura, fecha, subtotal, itbm, total, proyecto, items, notas, archivo_nombre, archivo_tipo, archivo, datos_extraidos, company_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id, tipo, contraparte, ruc, direccion, telefono, correo, numero_factura, fecha, subtotal, itbm, total, proyecto, notas, archivo_nombre, archivo_tipo, created_at`,
    [
      tipo, contraparte || null, ruc || null, direccion || null, telefono || null, correo || null, numero_factura || null, fecha || null,
      subtotal || null, itbm || null, total, proyecto || null,
      items ? JSON.stringify(items) : null, notas || null,
      archivo_nombre || null, archivo_tipo || null, archivoBuffer,
      datos_extraidos ? JSON.stringify(datos_extraidos) : null,
      companyId,
    ]
  );

  if (archivoBuffer) {
    const subfolder = `Finanzas/${tipo === 'gasto' ? 'Gastos' : 'Emitidas'}`;
    uploadToDropboxSafe(archivo_nombre || `factura-${rows[0].id}`, archivoBuffer, subfolder);
  }

  res.json(rows[0]);
});

app.put('/api/finanzas/:id', async (req, res) => {
  const { tipo, contraparte, ruc, direccion, telefono, correo, numero_factura, fecha, subtotal, itbm, total, proyecto, notas } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE finance_invoices SET
       tipo = COALESCE($1, tipo), contraparte = $2, ruc = $3, direccion = $4, telefono = $5, correo = $6,
       numero_factura = $7, fecha = $8, subtotal = $9, itbm = $10, total = COALESCE($11, total), proyecto = $12, notas = $13, updated_at = now()
     WHERE id = $14 AND company_id = $15
     RETURNING id, tipo, contraparte, ruc, direccion, telefono, correo, numero_factura, fecha, subtotal, itbm, total, proyecto, notas, archivo_nombre, archivo_tipo, created_at`,
    [tipo || null, contraparte || null, ruc || null, direccion || null, telefono || null, correo || null,
      numero_factura || null, fecha || null, subtotal || null, itbm || null, total, proyecto || null, notas || null, req.params.id, resolveCompanyId(req)]
  );
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(rows[0]);
});

app.delete('/api/finanzas/:id', async (req, res) => {
  await pool.query('DELETE FROM finance_invoices WHERE id = $1 AND company_id = $2', [req.params.id, resolveCompanyId(req)]);
  res.json({ ok: true });
});

// Reprocesa con Claude Vision las facturas emitidas que ya se habían subido
// antes de que existieran los campos dirección/teléfono/correo, para
// completárselos. Por defecto solo llena huecos (COALESCE) — nunca pisa un
// dato ya guardado — así que es seguro correrlo más de una vez. Con
// ?force=true SÍ sobreescribe: se usó una sola vez para corregir un lote que
// había quedado con los datos de GS Technologies en vez de los del cliente
// (el prompt de extracción no distinguía bien entre emisor y receptor).
app.all('/api/cron/backfill-cliente-info', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  const force = req.query.force === 'true';

  const { rows } = await pool.query(
    force
      ? `SELECT id, archivo, archivo_tipo FROM finance_invoices WHERE tipo = 'emitida' AND archivo IS NOT NULL`
      : `SELECT id, archivo, archivo_tipo FROM finance_invoices
         WHERE tipo = 'emitida' AND archivo IS NOT NULL
           AND (direccion IS NULL OR telefono IS NULL OR correo IS NULL)`
  );

  let actualizadas = 0;
  const errores = [];
  for (const row of rows) {
    try {
      const extraido = await extractInvoiceData(row.archivo, row.archivo_tipo);
      // contraparte solo se pisa en force, y directo (no COALESCE): si
      // extractInvoiceData la anuló por detectar que era la empresa propia
      // (ver limpiarContraparteSiEsEmpresaPropia en claudeInvoice.js), eso
      // es justo lo que hay que grabar — limpia el dato equivocado que había
      // quedado guardado con el prompt anterior, en vez de conservarlo.
      await pool.query(
        force
          ? `UPDATE finance_invoices SET direccion = $1, telefono = $2, correo = $3, contraparte = $5 WHERE id = $4`
          : `UPDATE finance_invoices SET
               direccion = COALESCE(direccion, $1), telefono = COALESCE(telefono, $2), correo = COALESCE(correo, $3)
             WHERE id = $4`,
        [extraido.direccion || null, extraido.telefono || null, extraido.correo || null, row.id, extraido.contraparte || null]
      );
      actualizadas++;
    } catch (err) {
      errores.push({ id: row.id, error: err.message });
    }
  }

  res.json({ revisadas: rows.length, actualizadas, errores, force });
});

// Paso 2 de la migración multi-empresa: siembra la fila de GS Technologies
// en companies/company_secrets (con los valores que hoy están quemados en
// el código y en las variables de entorno) y rellena company_id en las 7
// tablas existentes donde todavía esté vacío. Idempotente — correrlo de
// nuevo no duplica la empresa ni pisa filas que ya tengan company_id.
app.all('/api/cron/backfill-company-id', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  try {
    const slug = 'gs-technologies';
    const { rows: existing } = await pool.query('SELECT id FROM companies WHERE slug = $1', [slug]);
    let companyId;

    if (existing.length) {
      companyId = existing[0].id;
    } else {
      const branding = {
        nombre: COMPANY.nombre,
        direccion: COMPANY.direccion,
        telefono: COMPANY.telefono,
        ruc: COMPANY.ruc,
        correo: COMPANY.correo,
        signer_name: 'Ing. Dionisio Sánchez',
        signer_title: 'Representante Legal',
        footer_text: 'Gracias por contactar los servicios de nuestra empresa. Recuerda: no vendemos equipos de seguridad, te asesoramos y realizamos tus proyectos para proteger tu hogar o negocio.',
      };
      const categoryKeywords = {
        categories: Object.keys(CATEGORY_KEYWORDS),
        keywords: CATEGORY_KEYWORDS,
        exclude: EXCLUDE_KEYWORDS,
      };
      const ownCompanyNames = ['GS Technologies Investments, S.A.', 'GS Technologies and Security Solutions', 'GS Technologies'];

      const { rows } = await pool.query(
        `INSERT INTO companies (slug, name, branding, category_keywords, own_company_names)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [slug, 'GS Technologies and Security Solutions', JSON.stringify(branding), JSON.stringify(categoryKeywords), JSON.stringify(ownCompanyNames)]
      );
      companyId = rows[0].id;

      await pool.query(
        `INSERT INTO company_secrets
          (company_id, pc_usuario, pc_contrasena_enc, dropbox_app_key, dropbox_app_secret_enc, dropbox_refresh_token_enc, dropbox_folder, imap_host, imap_port, imap_user, imap_password_enc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (company_id) DO NOTHING`,
        [
          companyId,
          process.env.PC_USUARIO || null,
          encryptSecret(process.env.PC_CONTRASENA),
          process.env.DROPBOX_APP_KEY || null,
          encryptSecret(process.env.DROPBOX_APP_SECRET),
          encryptSecret(process.env.DROPBOX_REFRESH_TOKEN),
          process.env.DROPBOX_FOLDER || null,
          process.env.IMAP_HOST || null,
          process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : null,
          process.env.IMAP_USER || null,
          encryptSecret(process.env.IMAP_PASSWORD),
        ]
      );
    }

    const tables = ['opportunities', 'push_subscriptions', 'quotes', 'processed_acts', 'email_alerts', 'catalog_items', 'finance_invoices'];
    const updated = {};
    for (const table of tables) {
      const { rowCount } = await pool.query(`UPDATE ${table} SET company_id = $1 WHERE company_id IS NULL`, [companyId]);
      updated[table] = rowCount;
    }

    res.json({ ok: true, companyId, updated });
  } catch (err) {
    console.error('Error en /api/cron/backfill-company-id:', err);
    res.status(500).json({ error: err.message });
  }
});

// Paso 3 de la migración multi-empresa: una vez que el paso 2 ya dejó
// company_id relleno en todas las filas, esto lo hace NOT NULL y cambia las
// restricciones únicas/PK que hoy son globales (act_number solo) a
// compuestas con company_id — sin esto, dos empresas nunca podrían guardar
// el mismo número de acto de PanamaCompra aunque ninguna tenga nada que ver
// con la otra. Se niega a correr si todavía queda algún company_id vacío.
app.all('/api/cron/close-company-id-constraints', async (req, res) => {
  const key = req.query.key || req.headers['x-cron-key'];
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  try {
    const tables = ['opportunities', 'push_subscriptions', 'quotes', 'processed_acts', 'email_alerts', 'catalog_items', 'finance_invoices'];
    const nullCounts = {};
    for (const table of tables) {
      const { rows } = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE company_id IS NULL`);
      nullCounts[table] = Number(rows[0].count);
    }
    const conNulos = Object.entries(nullCounts).filter(([, c]) => c > 0);
    if (conNulos.length) {
      return res.status(409).json({ error: 'hay filas sin company_id, corre primero /api/cron/backfill-company-id', nullCounts });
    }

    for (const table of tables) {
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN company_id SET NOT NULL`);
    }

    // Nombres estándar que Postgres le pone solo a una UNIQUE/PK declarada
    // sin nombre explícito (<tabla>_<columna(s)>_key / <tabla>_pkey) — así
    // como se declararon originalmente en shared/db.js. Más simple y
    // confiable que buscarlos en pg_constraint (que no siempre se comporta
    // igual entre motores/herramientas).
    // Se tira tanto el nombre viejo (primera corrida) como el nuevo (por si
    // se vuelve a correr) — así queda seguro repetirlo cualquier cantidad de
    // veces, igual que el resto de los ALTER TABLE de esta app.
    await pool.query(`ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_act_number_convocatoria_key`);
    await pool.query(`ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_company_act_convocatoria_key`);
    await pool.query(`ALTER TABLE opportunities ADD CONSTRAINT opportunities_company_act_convocatoria_key UNIQUE (company_id, act_number, convocatoria)`);

    await pool.query(`ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key`);
    await pool.query(`ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_company_endpoint_key`);
    await pool.query(`ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_company_endpoint_key UNIQUE (company_id, endpoint)`);

    await pool.query(`ALTER TABLE processed_acts DROP CONSTRAINT IF EXISTS processed_acts_pkey`);
    await pool.query(`ALTER TABLE processed_acts ADD CONSTRAINT processed_acts_pkey PRIMARY KEY (company_id, act_number)`);

    await pool.query(`ALTER TABLE email_alerts DROP CONSTRAINT IF EXISTS email_alerts_pkey`);
    await pool.query(`ALTER TABLE email_alerts ADD CONSTRAINT email_alerts_pkey PRIMARY KEY (company_id, act_number)`);

    for (const table of tables) {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table}_company_id ON ${table}(company_id)`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /api/cron/close-company-id-constraints:', err);
    res.status(500).json({ error: err.message });
  }
});

// Manejador de errores global: sin esto, un error atrapado por
// express-async-errors se queda sin respuesta igual (Express solo lo saca
// del limbo, todavía hace falta algo que le conteste al cliente).
app.use((err, req, res, next) => {
  console.error('Error no manejado en', req.method, req.path, ':', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

init()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
  })
  .catch(err => {
    console.error('Error inicializando la base de datos:', err);
    process.exit(1);
  });

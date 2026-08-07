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
const { generateQuoteExcel } = require('../shared/generateQuoteExcel');
const { parseQuoteExcel } = require('../shared/parseQuoteExcel');
const { suggestPricesForItems, upsertFromQuoteItems, importCatalogRows } = require('../shared/catalog');
const { parseCatalogExcel } = require('../shared/parseCatalogExcel');
const { runCheckEmailJob, sendPushToAll } = require('../shared/checkEmailJob');
const { searchOpenByCategory } = require('../shared/searchPanamaCompra');
const { uploadToDropboxSafe } = require('../shared/dropboxUpload');
const { syncOpportunityDocs } = require('../shared/syncOpportunityDocs');
const { listarEnviadas, obtenerCuadroComparativo } = require('../shared/cotizacionesEnviadas');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.APP_ACCESS_CODE || '';
const COOKIE_NAME = 'cotizador_auth';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json());
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
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO NOTHING`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  );
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'falta endpoint' });
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  res.json({ ok: true });
});

app.get('/api/opportunities', async (req, res) => {
  const source = req.query.source || 'panamacompra';
  const { rows } = await pool.query(
    `SELECT * FROM opportunities
     WHERE (deadline IS NULL OR deadline > now())
       AND decision != 'no_participar'
       AND source = $1
     ORDER BY created_at DESC LIMIT 100`,
    [source]
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
      (act_number, convocatoria, title, entity, items, category, category_match, recommendation, reasoning, decision, source)
     VALUES ($1,'1',$2,$2,$3,$4,true,'participar','Cotización directa con cliente (fuera de PanamaCompra).','participar','directo')
     RETURNING *`,
    [`DIRECTO-${Date.now()}`, titulo, JSON.stringify(normalizedItems), categoria]
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
  syncOpportunityDocs(rows[0]);
  res.json({ ok: true, mensaje: 'Buscando documentos adjuntos en segundo plano…' });
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
  const subtotal = items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precioUnitario) || 0), 0);
  const itbm = subtotal * 0.07;
  return { subtotal, itbm, total: subtotal + itbm };
}

async function saveDraft(oppId, data) {
  const { cliente_nombre, cliente_ruc, cliente_direccion, cliente_ciudad, forma_pago, comentarios, items } = data;
  const safeItems = Array.isArray(items) ? items : [];
  const { subtotal, itbm, total } = computeTotals(safeItems);

  const { rows } = await pool.query(
    `INSERT INTO quotes (opportunity_id, cliente_nombre, cliente_ruc, cliente_direccion, cliente_ciudad, forma_pago, comentarios, items, subtotal, itbm, total, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
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
  const suggestedItems = await suggestPricesForItems(baseItems, opportunity.category, opportunity.tecnologia_incendio);
  const effectiveQuote = quote ? { ...quote, items: suggestedItems } : { items: suggestedItems };

  const buffer = await generateQuoteExcel({ opportunity, quote: effectiveQuote });
  const dropboxSubfolder = opportunity.decision === 'participar' ? (opportunity.entity || opportunity.title) : undefined;
  uploadToDropboxSafe(`${opportunity.title} - ${opportunity.act_number}.xlsx`, buffer, dropboxSubfolder); // respaldo best-effort, no bloquea la descarga
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cotizacion-${oppId}.xlsx"`);
  res.send(buffer);
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
  const dropboxSubfolder = opportunity.decision === 'participar' ? (opportunity.entity || opportunity.title) : undefined;
  uploadToDropboxSafe(`${opportunity.title} - ${opportunity.act_number}.pdf`, pdfBuffer, dropboxSubfolder); // respaldo best-effort, no bloquea la aprobación

  await pool.query(
    `UPDATE quotes SET estado = 'aprobada', pdf = $1, approved_at = now(), updated_at = now() WHERE opportunity_id = $2`,
    [pdfBuffer, oppId]
  );

  try {
    await upsertFromQuoteItems(quote.items || []);
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
    const result = await runCheckEmailJob();
    res.json(result);
  } catch (err) {
    console.error('Error en /api/cron/check-email:', err);
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
    const result = await searchOpenByCategory();
    res.json(result);
  } catch (err) {
    console.error('Error en búsqueda manual de PanamaCompra:', err.message);
    res.status(500).json({ error: err.message });
  }
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

const CATEGORIAS = ['CCTV', 'Alarma de Intrusión', 'Control de Acceso', 'Detección de Incendio', 'Automatización', 'Voz y Datos', 'Materiales', 'Otro'];

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
  const resumen = await importCatalogRows(parsed.rows, { defaultCategoria });
  res.json({ ok: true, ...resumen });
});

app.get('/api/catalog', async (req, res) => {
  const { categoria, search } = req.query;
  const clauses = [];
  const params = [];
  if (categoria) { params.push(categoria); clauses.push(`categoria = $${params.length}`); }
  if (search) { params.push(`%${search}%`); clauses.push(`descripcion ILIKE $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM catalog_items ${where} ORDER BY updated_at DESC LIMIT 300`, params);
  res.json(rows);
});

app.post('/api/catalog', async (req, res) => {
  const { descripcion, categoria, subcategoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas } = req.body || {};
  if (!descripcion) return res.status(400).json({ error: 'falta descripción' });
  const { rows } = await pool.query(
    `INSERT INTO catalog_items (descripcion, categoria, subcategoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas, fecha_cotizacion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now()) RETURNING *`,
    [descripcion, categoria || null, subcategoria || null, marca || null, modelo || null, costo_distribuidor || null, margen_g || null, proveedor || null, notas || null]
  );
  res.json(rows[0]);
});

app.put('/api/catalog/:id', async (req, res) => {
  const { descripcion, categoria, subcategoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE catalog_items SET
       descripcion = COALESCE($1, descripcion), categoria = $2, subcategoria = $3, marca = $4, modelo = $5,
       costo_distribuidor = $6, margen_g = $7, proveedor = $8, notas = $9, updated_at = now()
     WHERE id = $10 RETURNING *`,
    [descripcion, categoria || null, subcategoria || null, marca || null, modelo || null, costo_distribuidor || null, margen_g || null, proveedor || null, notas || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(rows[0]);
});

app.delete('/api/catalog/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog_items WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
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

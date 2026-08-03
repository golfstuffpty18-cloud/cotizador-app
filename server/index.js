const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { pool, init } = require('../shared/db');
const { generateQuotePdf } = require('../shared/generateQuotePdf');
const { generateQuoteExcel } = require('../shared/generateQuoteExcel');
const { parseQuoteExcel } = require('../shared/parseQuoteExcel');
const { suggestPricesForItems, upsertFromQuoteItems } = require('../shared/catalog');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.APP_ACCESS_CODE || '';
const COOKIE_NAME = 'cotizador_auth';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json());
app.use(cookieParser());

function requireAuth(req, res, next) {
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
  const { rows } = await pool.query(
    `SELECT * FROM opportunities
     WHERE (deadline IS NULL OR deadline > now())
       AND decision != 'no_participar'
     ORDER BY created_at DESC LIMIT 100`
  );
  res.json(rows);
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
  res.json(rows[0]);
});

app.get('/api/opportunities/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
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
  const suggestedItems = await suggestPricesForItems(baseItems);
  const effectiveQuote = quote ? { ...quote, items: suggestedItems } : { items: suggestedItems };

  const buffer = await generateQuoteExcel({ opportunity, quote: effectiveQuote });
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

app.post('/api/opportunities/:id/quote/approve', async (req, res) => {
  const oppId = req.params.id;
  const { rows } = await pool.query('SELECT * FROM quotes WHERE opportunity_id = $1', [oppId]);
  if (!rows.length) return res.status(404).json({ error: 'primero guarda un borrador de cotización' });
  const quote = rows[0];

  const { rows: oppRows } = await pool.query('SELECT * FROM opportunities WHERE id = $1', [oppId]);
  const opportunity = oppRows[0];

  const pdfBuffer = await generateQuotePdf({ quote, opportunity });

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

const CATEGORIAS = ['CCTV', 'Alarma de Intrusión', 'Control de Acceso', 'Detección de Incendio', 'Automatización', 'Voz y Datos', 'Otro'];

app.get('/api/catalog/categorias', (req, res) => res.json(CATEGORIAS));

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
  const { descripcion, categoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas } = req.body || {};
  if (!descripcion) return res.status(400).json({ error: 'falta descripción' });
  const { rows } = await pool.query(
    `INSERT INTO catalog_items (descripcion, categoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas, fecha_cotizacion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING *`,
    [descripcion, categoria || null, marca || null, modelo || null, costo_distribuidor || null, margen_g || null, proveedor || null, notas || null]
  );
  res.json(rows[0]);
});

app.put('/api/catalog/:id', async (req, res) => {
  const { descripcion, categoria, marca, modelo, costo_distribuidor, margen_g, proveedor, notas } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE catalog_items SET
       descripcion = COALESCE($1, descripcion), categoria = $2, marca = $3, modelo = $4,
       costo_distribuidor = $5, margen_g = $6, proveedor = $7, notas = $8, updated_at = now()
     WHERE id = $9 RETURNING *`,
    [descripcion, categoria || null, marca || null, modelo || null, costo_distribuidor || null, margen_g || null, proveedor || null, notas || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'no encontrado' });
  res.json(rows[0]);
});

app.delete('/api/catalog/:id', async (req, res) => {
  await pool.query('DELETE FROM catalog_items WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

init()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
  })
  .catch(err => {
    console.error('Error inicializando la base de datos:', err);
    process.exit(1);
  });

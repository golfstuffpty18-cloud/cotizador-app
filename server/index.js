const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { pool, init } = require('../shared/db');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.APP_ACCESS_CODE || '';
const COOKIE_NAME = 'cotizador_auth';

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
     WHERE deadline IS NULL OR deadline > now()
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

init()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
  })
  .catch(err => {
    console.error('Error inicializando la base de datos:', err);
    process.exit(1);
  });

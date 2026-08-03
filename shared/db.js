const { Pool } = require('pg');
const { parseDeadline } = require('./parseWindow');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS opportunities (
  id SERIAL PRIMARY KEY,
  act_number TEXT NOT NULL,
  convocatoria TEXT,
  title TEXT NOT NULL,
  entity TEXT,
  entity_address TEXT,
  entity_province TEXT,
  reference_price NUMERIC,
  window_info TEXT,
  deadline TIMESTAMPTZ,
  items JSONB,
  category_match BOOLEAN NOT NULL,
  recommendation TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  email_uid INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  UNIQUE(act_number, convocatoria)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  cliente_nombre TEXT,
  cliente_ruc TEXT,
  cliente_direccion TEXT,
  cliente_ciudad TEXT,
  forma_pago TEXT DEFAULT 'Crédito',
  comentarios TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC,
  itbm NUMERIC,
  total NUMERIC,
  estado TEXT NOT NULL DEFAULT 'borrador',
  pdf BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  UNIQUE(opportunity_id)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id SERIAL PRIMARY KEY,
  descripcion TEXT NOT NULL,
  categoria TEXT,
  marca TEXT,
  modelo TEXT,
  costo_distribuidor NUMERIC,
  margen_g NUMERIC,
  proveedor TEXT,
  fecha_cotizacion TIMESTAMPTZ,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS items JSONB;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS entity_address TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS entity_province TEXT;
`;

const CLEANUP = `
DELETE FROM opportunities
WHERE (deadline IS NOT NULL AND deadline < now())
   OR (deadline IS NULL AND created_at < now() - interval '5 days');
`;

async function init() {
  await pool.query(SCHEMA);
  await backfillDeadlines();
}

// Fixes rows created before the `deadline` column existed (or where parsing
// failed at insert time) by re-parsing their stored window_info text.
async function backfillDeadlines() {
  const { rows } = await pool.query(
    `SELECT id, window_info FROM opportunities WHERE deadline IS NULL AND window_info IS NOT NULL`
  );
  for (const row of rows) {
    const deadline = parseDeadline(row.window_info);
    if (deadline) {
      await pool.query('UPDATE opportunities SET deadline = $1 WHERE id = $2', [deadline, row.id]);
    }
  }
  return rows.length;
}

async function cleanupExpired() {
  const { rowCount } = await pool.query(CLEANUP);
  return rowCount;
}

module.exports = { pool, init, cleanupExpired };

const { Pool } = require('pg');
const { parseDeadline, parseWindowStart } = require('./parseWindow');

// Sin estos timeouts, una consulta o conexión atascada (ej. un corte breve
// hacia Render Postgres) deja la petición HTTP colgada para siempre — el
// mismo tipo de bug que causaba que el chequeo de correo se quedara
// pegado (ver shared/checkEmailJob.js). Aquí el síntoma sería "subir el
// Excel/aprobar la cotización se demora y nunca llega el PDF".
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  statement_timeout: 20000,
  query_timeout: 25000,
});

// Sin este manejador, un corte de red en una conexión inactiva del pool
// tumba todo el proceso (y con él, el servidor web completo).
pool.on('error', (err) => {
  console.error('Error inesperado en una conexión inactiva del pool de Postgres:', err.message);
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

CREATE TABLE IF NOT EXISTS processed_acts (
  act_number TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_alerts (
  act_number TEXT PRIMARY KEY,
  subject TEXT,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id SERIAL PRIMARY KEY,
  descripcion TEXT NOT NULL,
  categoria TEXT,
  subcategoria TEXT,
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

CREATE TABLE IF NOT EXISTS finance_invoices (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('gasto','emitida')),
  contraparte TEXT,
  ruc TEXT,
  numero_factura TEXT,
  fecha DATE,
  subtotal NUMERIC,
  itbm NUMERIC,
  total NUMERIC,
  proyecto TEXT,
  items JSONB,
  notas TEXT,
  archivo_nombre TEXT,
  archivo_tipo TEXT,
  archivo BYTEA,
  datos_extraidos JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_fecha ON finance_invoices(fecha);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_tipo ON finance_invoices(tipo);
CREATE INDEX IF NOT EXISTS idx_finance_invoices_proyecto ON finance_invoices(proyecto);
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS correo TEXT;

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS items JSONB;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS entity_address TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS entity_province TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tecnologia_incendio TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'panamacompra';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS documentos_pliego JSONB;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS documentos_synced_at TIMESTAMPTZ;
-- Estado del proceso en PanamaCompra al momento de guardarse ('programada' o
-- 'abierta') — respaldo para cuando window_start no se pudo calcular
-- (formato de texto inesperado). La clasificación real programada/abierta
-- que usa /api/opportunities es dinámica, basada en window_start: en cuanto
-- pasa esa hora, el proceso se ve como "de hoy" solo sin tener que volver a
-- consultar PanamaCompra. Oportunidades guardadas antes de esta columna
-- quedan en NULL y se ven en la pantalla principal.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pc_estado TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ;
-- 'cotizacion_linea' o 'compra_menor' — separa las dos pantallas de
-- oportunidades de PanamaCompra (antes vivían juntas en la pantalla
-- principal). NULL para filas de otro source (ej. 'directo').
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tipo_proceso TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS subcategoria TEXT;
`;

// Las cotizaciones directas (source='directo') no tienen fecha límite de
// PanamaCompra — no deben autoborrarse a los 5 días como las demás.
const CLEANUP = `
DELETE FROM opportunities
WHERE source != 'directo'
  AND ((deadline IS NOT NULL AND deadline < now())
   OR (deadline IS NULL AND created_at < now() - interval '5 days'));
`;

async function init() {
  await pool.query(SCHEMA);
  await backfillDeadlines();
  await backfillWindowStarts();
  await backfillProcessedActs();
  await backfillTipoProceso();
}

// El número de acto de PanamaCompra ya trae el tipo de proceso codificado
// (ej. "...-CL-064285" = Cotización en línea, "...-CM-000572" = Compra
// Menor) — se usa solo para completar filas viejas que se guardaron antes de
// que existiera esta columna; de aquí en adelante cada punto de guardado
// (búsqueda por rubro, chequeo de correo) lo manda explícito según el
// idTipoProceso real con el que encontró el acto en PanamaCompra.
async function backfillTipoProceso() {
  const { rowCount } = await pool.query(`
    UPDATE opportunities
    SET tipo_proceso = CASE WHEN act_number LIKE '%-CM-%' THEN 'compra_menor' ELSE 'cotizacion_linea' END
    WHERE tipo_proceso IS NULL AND source = 'panamacompra'
  `);
  return rowCount;
}

// Registra en processed_acts cualquier act_number que ya exista en
// opportunities pero que aún no tenga marca de "procesado" (por ejemplo,
// filas guardadas antes de que esta tabla existiera).
async function backfillProcessedActs() {
  await pool.query(`
    INSERT INTO processed_acts (act_number, processed_at)
    SELECT DISTINCT act_number, now() FROM opportunities
    ON CONFLICT (act_number) DO NOTHING
  `);
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

// Igual que backfillDeadlines pero para window_start — necesario tanto para
// filas guardadas antes de que esta columna existiera como, sobre todo,
// para las 4 oportunidades ya guardadas antes de que se empezara a calcular
// (quedarían sin poder distinguirse como programada/abierta si no).
async function backfillWindowStarts() {
  const { rows } = await pool.query(
    `SELECT id, window_info FROM opportunities WHERE window_start IS NULL AND window_info IS NOT NULL`
  );
  for (const row of rows) {
    const windowStart = parseWindowStart(row.window_info);
    if (windowStart) {
      await pool.query('UPDATE opportunities SET window_start = $1 WHERE id = $2', [windowStart, row.id]);
    }
  }
  return rows.length;
}

async function cleanupExpired() {
  const { rowCount } = await pool.query(CLEANUP);
  return rowCount;
}

async function isActProcessed(actNumber) {
  const { rows } = await pool.query('SELECT 1 FROM processed_acts WHERE act_number = $1', [actNumber]);
  return rows.length > 0;
}

async function markActProcessed(actNumber) {
  await pool.query(
    'INSERT INTO processed_acts (act_number) VALUES ($1) ON CONFLICT (act_number) DO NOTHING',
    [actNumber]
  );
}

// email_alerts: marca que ya se envió el aviso inmediato al detectar el correo,
// independiente de si el proceso ya está publicado en el portal de PanamaCompra
// (eso lo controla processed_acts). Así evitamos reenviar el aviso inmediato en
// cada ciclo mientras se espera a que el portal publique el acto.
async function hasBeenAlerted(actNumber) {
  const { rows } = await pool.query('SELECT 1 FROM email_alerts WHERE act_number = $1', [actNumber]);
  return rows.length > 0;
}

async function markAlerted(actNumber, subject) {
  await pool.query(
    'INSERT INTO email_alerts (act_number, subject) VALUES ($1,$2) ON CONFLICT (act_number) DO NOTHING',
    [actNumber, subject]
  );
}

module.exports = { pool, init, cleanupExpired, isActProcessed, markActProcessed, hasBeenAlerted, markAlerted };

const { pool } = require('./db');

// Si ya existe un placeholder para este acto (convocatoria NULL, creado por
// la alerta inmediata al detectar un correo), lo completa con los datos
// reales. Si no, inserta una fila nueva (o no hace nada si esa convocatoria
// específica ya existía). Usado tanto por el chequeo de correo como por la
// búsqueda manual en PanamaCompra, para que ambos caminos terminen en el
// mismo listado sin duplicarse entre sí.
async function upsertOpportunity(op) {
  // company_id acá también, no solo act_number: sin esto, dos empresas con
  // el mismo act_number en algún momento (ej. ambas compiten en el mismo
  // acto) podrían "completar" el placeholder de la otra en vez del propio.
  const { rows: placeholder } = await pool.query(
    `SELECT id FROM opportunities WHERE act_number = $1 AND convocatoria IS NULL AND company_id = $2 LIMIT 1`,
    [op.actNumber, op.companyId]
  );
  if (placeholder.length) {
    const { rows } = await pool.query(
      `UPDATE opportunities SET
         convocatoria = $1, title = $2, entity = $3, entity_address = $4, entity_province = $5,
         reference_price = $6, window_info = $7, deadline = $8, items = $9,
         category_match = $10, recommendation = $11, reasoning = $12, email_uid = $13, category = $14, pc_estado = $15, window_start = $16, tipo_proceso = $17, company_id = $18
       WHERE id = $19 RETURNING *`,
      [op.convocatoria, op.title, op.entity, op.entityAddress, op.entityProvince, op.referencePrice,
       op.windowInfo, op.deadline, JSON.stringify(op.items || []), op.categoryMatch, op.recommendation,
       op.reasoning, op.emailUid ?? null, op.category ?? null, op.pcEstado ?? null, op.windowStart ?? null, op.tipoProceso ?? null, op.companyId, placeholder[0].id]
    );
    return rows[0];
  }

  const { rows } = await pool.query(
    `INSERT INTO opportunities
      (act_number, convocatoria, title, entity, entity_address, entity_province, reference_price, window_info, deadline, items, category_match, recommendation, reasoning, decision, email_uid, category, pc_estado, window_start, tipo_proceso, company_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15,$16,$17,$18,$19)
     ON CONFLICT (company_id, act_number, convocatoria) DO NOTHING
     RETURNING *`,
    [op.actNumber, op.convocatoria, op.title, op.entity, op.entityAddress, op.entityProvince, op.referencePrice, op.windowInfo, op.deadline,
     JSON.stringify(op.items || []), op.categoryMatch, op.recommendation, op.reasoning, op.emailUid ?? null, op.category ?? null, op.pcEstado ?? null, op.windowStart ?? null, op.tipoProceso ?? null, op.companyId]
  );
  return rows[0] || null;
}

module.exports = { upsertOpportunity };

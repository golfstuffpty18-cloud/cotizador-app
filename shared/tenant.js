// Único punto que resuelve "a qué empresa pertenece esta petición/job".
// Hoy, antes de que exista login real, devuelve un id fijo desde
// DEFAULT_COMPANY_ID (la fila de GS Technologies sembrada por
// scripts/backfill-company-id.js). Cuando el login (paso 4 de la migración
// multi-empresa) esté listo, este es el único lugar que cambia — pasa a leer
// req.companyId puesto por el middleware de sesión. Todo lo demás que ya
// recibe un companyId por parámetro no se toca.
function resolveCompanyId(req) {
  return Number(process.env.DEFAULT_COMPANY_ID || 1);
}

module.exports = { resolveCompanyId };

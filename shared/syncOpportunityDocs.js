const { PDFParse } = require('pdf-parse');
const pc = require('./panamacompra');
const { uploadToDropboxSafe } = require('./dropboxUpload');
const { pool } = require('./db');

const MAX_TEXTO_CHARS = 20000;

async function extraerTexto(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result.text || '').slice(0, MAX_TEXTO_CHARS);
  } finally {
    await parser.destroy();
  }
}

// Trae los documentos adjuntos reales del acto de PanamaCompra (pliego,
// especificaciones técnicas, términos de referencia, etc.), los sube a la
// subcarpeta de Dropbox del cliente/institución, extrae el texto de los PDF
// y guarda todo en opportunities.documentos_pliego. Nunca lanza: es un
// respaldo/enriquecimiento secundario, igual que uploadToDropboxSafe — un
// fallo acá no debe romper el flujo de decisión de la oportunidad.
async function syncOpportunityDocs(opportunity) {
  if (!opportunity || opportunity.source !== 'panamacompra') return { ok: false, error: 'oportunidad sin acto de PanamaCompra' };

  try {
    const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);
    const { registros } = await pc.buscarProcesoCualquierEstado(cookie, opportunity.act_number);
    if (!registros.length) {
      const msg = `no se encontró el acto ${opportunity.act_number} en PanamaCompra`;
      console.error(`syncOpportunityDocs: ${msg}`);
      return { ok: false, error: msg };
    }
    // idTipoProceso viene del registro encontrado (puede ser Cotización en
    // línea o Compra Menor) — verPliego lo necesita para armar la URL
    // correcta según el tipo de proceso.
    const { archivos } = await pc.verPliego(cookie, registros[0].idProcesosContratacionFlujos, registros[0].idTipoProceso);

    const subfolder = opportunity.entity || opportunity.title;
    const documentos = [];
    for (const archivo of archivos) {
      try {
        const buffer = await pc.descargarArchivo(cookie, archivo.rutaCompleta);
        await uploadToDropboxSafe(archivo.nombreOriginal, buffer, subfolder);

        let textoExtraido = null;
        if (archivo.mimetype === 'application/pdf') {
          try {
            const texto = await extraerTexto(buffer);
            // Muchos PDF de portales de gobierno son escaneos sin capa de
            // texto real — pdf-parse no puede sacar nada de una imagen, y
            // devuelve solo marcadores de página ("-- 1 of 2 --"). Tratar
            // ese resultado casi vacío como "sin texto" evita mostrar en la
            // app un bloque de "texto extraído" vacío y engañoso.
            textoExtraido = texto && texto.trim().length > 30 ? texto : null;
          } catch (err) {
            console.error(`syncOpportunityDocs: no se pudo extraer texto de "${archivo.nombreOriginal}":`, err.message);
          }
        }

        documentos.push({
          tipoArchivo: archivo.tipoArchivo,
          descripcion: archivo.descripcion,
          nombreOriginal: archivo.nombreOriginal,
          mimetype: archivo.mimetype,
          textoExtraido,
        });
      } catch (err) {
        console.error(`syncOpportunityDocs: no se pudo procesar el adjunto "${archivo.nombreOriginal}":`, err.message);
      }
    }

    await pool.query(
      `UPDATE opportunities SET documentos_pliego = $1, documentos_synced_at = now() WHERE id = $2`,
      [JSON.stringify(documentos), opportunity.id]
    );
    return { ok: true, count: documentos.length };
  } catch (err) {
    console.error(`syncOpportunityDocs: falló para la oportunidad ${opportunity.id}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { syncOpportunityDocs };

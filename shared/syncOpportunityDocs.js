const { PDFParse } = require('pdf-parse');
const pc = require('./panamacompra');
const { uploadToDropboxSafe, dropboxSubfolderFor } = require('./dropboxUpload');
const { pool } = require('./db');

const MAX_TEXTO_CHARS = 20000;

// El archivo del pliego solo queda guardado en Dropbox — la app no conserva
// una copia propia del binario, solo el nombre/texto extraído en la base de
// datos. El usuario depende de esa copia de Dropbox para tener el documento
// a mano cotizando desde otro equipo, así que un fallo de subida acá no
// puede quedar en silencio: se reintenta una vez antes de darlo por perdido.
async function subirConReintento(nombreOriginal, buffer, subfolder) {
  let result = await uploadToDropboxSafe(nombreOriginal, buffer, subfolder);
  if (!result.ok) {
    await new Promise(r => setTimeout(r, 2000));
    result = await uploadToDropboxSafe(nombreOriginal, buffer, subfolder);
  }
  return result;
}

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
// misma subcarpeta de Dropbox donde cae el Excel/PDF de la cotización,
// extrae el texto de los PDF y guarda todo en opportunities.documentos_pliego.
// Nunca lanza: es un
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

    // Misma carpeta que el Excel/PDF de la cotización (dropboxSubfolderFor),
    // para que los adjuntos del acto y la cotización generada queden juntos
    // en vez de en dos carpetas separadas para la misma oportunidad.
    const subfolder = dropboxSubfolderFor(opportunity);
    const documentos = [];
    for (const archivo of archivos) {
      try {
        const buffer = await pc.descargarArchivo(cookie, archivo.rutaCompleta);
        const dropboxResult = await subirConReintento(archivo.nombreOriginal, buffer, subfolder);
        if (!dropboxResult.ok) {
          console.error(`syncOpportunityDocs: no se pudo subir "${archivo.nombreOriginal}" a Dropbox tras reintentar:`, dropboxResult.error);
        }

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
          dropboxOk: dropboxResult.ok,
        });
      } catch (err) {
        console.error(`syncOpportunityDocs: no se pudo procesar el adjunto "${archivo.nombreOriginal}":`, err.message);
      }
    }

    await pool.query(
      `UPDATE opportunities SET documentos_pliego = $1, documentos_synced_at = now() WHERE id = $2`,
      [JSON.stringify(documentos), opportunity.id]
    );
    const dropboxFailures = documentos.filter(d => !d.dropboxOk).length;
    return { ok: true, count: documentos.length, dropboxFailures };
  } catch (err) {
    console.error(`syncOpportunityDocs: falló para la oportunidad ${opportunity.id}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { syncOpportunityDocs };

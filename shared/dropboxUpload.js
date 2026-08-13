// Respaldo automático: cada Excel/PDF generado se sube también a la carpeta
// de Dropbox del usuario, además de servirse normalmente por la app. Usa un
// refresh token (no expira) para pedir tokens de acceso de corta duración
// bajo demanda — así no hay que volver a autorizar la app manualmente.
const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const FOLDER = process.env.DROPBOX_FOLDER || '/GS Technologies and Security Solutions/Cotizaciones';

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  if (!APP_KEY || !APP_SECRET || !REFRESH_TOKEN) {
    throw new Error('Faltan credenciales de Dropbox (DROPBOX_APP_KEY/DROPBOX_APP_SECRET/DROPBOX_REFRESH_TOKEN)');
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id: APP_KEY,
      client_secret: APP_SECRET,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`No se pudo renovar el token de Dropbox: HTTP ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // renovar 1 min antes de que expire
  return cachedToken;
}

// Los títulos reales de PanamaCompra son largos (128+ caracteres es normal)
// — recortar a ciegas con .slice(0,120) se come la extensión (".xlsx"/".pdf")
// cuando el nombre pasa ese límite, dejando el archivo sin extensión en
// Dropbox. Se separa la extensión antes de recortar y se vuelve a pegar al
// final para que siempre sobreviva.
function sanitizeFilename(name) {
  const clean = String(name || 'Cotizacion')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = clean.match(/^(.*)(\.[a-zA-Z0-9]{1,5})$/);
  if (!m) return clean.slice(0, 120);
  const [, base, ext] = m;
  return base.slice(0, 120 - ext.length).trim() + ext;
}

// El header Dropbox-API-Arg viaja como header HTTP, que solo admite ASCII.
// JSON.stringify deja pasar tal cual cualquier tilde/ñ/etc. (UTF-8), y
// fetch()/undici rechaza (o corrompe) headers con esos bytes — por eso subir
// un archivo con un título que trae tildes (ej. "COMUNICACIÓN") fallaba en
// silencio: uploadToDropboxSafe nunca lanza, así que no se veía el error en
// ningún lado salvo los logs de Render. Dropbox documenta este requisito:
// hay que escapar todo carácter fuera de ASCII imprimible como \uXXXX antes
// de mandarlo en el header (el path en sí puede tener cualquier Unicode, es
// el HEADER el que debe ser ASCII puro).
function asciiSafeJson(obj) {
  return JSON.stringify(obj).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Nunca lanza: es un respaldo secundario y no debe romper la descarga o
// aprobación real que el usuario está esperando si Dropbox falla o las
// credenciales todavía no están configuradas.
async function uploadToDropboxSafe(filename, buffer, subfolder) {
  try {
    const accessToken = await getAccessToken();
    // subfolder puede traer varios niveles separados por "/" (ej.
    // "Finanzas/Gastos") — se sanitiza cada segmento por separado para no
    // perder la jerarquía de carpetas (sanitizeFilename por sí sola borra
    // las "/" y los aplastaría en un solo nombre de carpeta).
    const subfolderPath = subfolder
      ? subfolder.split('/').filter(Boolean).map(sanitizeFilename).join('/')
      : '';
    const dropboxPath = subfolderPath
      ? `${FOLDER}/${subfolderPath}/${sanitizeFilename(filename)}`
      : `${FOLDER}/${sanitizeFilename(filename)}`;
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': asciiSafeJson({ path: dropboxPath, mode: 'overwrite', mute: true }),
      },
      body: buffer,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Dropbox upload falló:', res.status, text);
    }
  } catch (err) {
    console.error('Dropbox upload falló:', err.message);
  }
}

module.exports = { uploadToDropboxSafe };

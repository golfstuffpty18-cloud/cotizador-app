const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const webpush = require('web-push');
const { pool, init, cleanupExpired, isActProcessed, markActProcessed, hasBeenAlerted, markAlerted } = require('./db');
const { upsertOpportunity } = require('./opportunities');
const pc = require('./panamacompra');
const { evaluate } = require('./evaluate');
const { parseDeadline } = require('./parseWindow');

const SUBJECT_RE = /Solicitud de cotizaci[oó]n en l[ií]nea\s*-\s*([\w-]+)/i;
const ENTITY_RE = /entidad\s+([\s\S]+?)\s*,\s*ha publicado/i;
const WINDOW_RE = /abierta el d[ií]a\s+([\d/]+)\s+en horario de\s+([\d:apmAPM\s]+?)\s+a\s+([\d:apmAPM\s]+?)\.?\s*(?:\r?\n|$)/i;

// Extrae del cuerpo del correo (no del portal) la entidad y la ventana de
// tiempo, si PanamaCompra las incluyó en el mensaje. Esto es lo que permite
// avisar de inmediato al detectar el correo, sin depender de que el proceso
// ya esté publicado en el portal.
function parseEmailBody(text) {
  const entityMatch = (text || '').match(ENTITY_RE);
  const windowMatch = (text || '').match(WINDOW_RE);
  return {
    entityFromEmail: entityMatch ? entityMatch[1].replace(/\s+/g, ' ').trim() : null,
    windowFromEmail: windowMatch ? `${windowMatch[1].trim()} ${windowMatch[2].trim().replace(/\s+/g, ' ')} - ${windowMatch[3].trim().replace(/\s+/g, ' ')}` : null,
  };
}

async function fetchCandidateEmails() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
    // Los valores por defecto de imapflow (90s/16s/5min) son demasiado
    // generosos para un job que corre cada pocos minutos: si el correo de
    // GoDaddy no responde, mejor fallar rápido que dejar el chequeo colgado.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const found = [];
  try {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // last 3 days, DB dedupes
    for await (const msg of client.fetch(
      { since, from: 'panamacompras.gob.pa' },
      { envelope: true, uid: true, source: true }
    )) {
      const subject = msg.envelope.subject || '';
      const m = subject.match(SUBJECT_RE);
      if (!m) continue;

      let entityFromEmail = null;
      let windowFromEmail = null;
      try {
        const parsed = await simpleParser(msg.source);
        ({ entityFromEmail, windowFromEmail } = parseEmailBody(parsed.text));
      } catch (err) {
        // si falla el parseo del cuerpo, seguimos solo con lo que da el asunto
      }

      found.push({ uid: msg.uid, actNumber: m[1], subject, entityFromEmail, windowFromEmail });
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return found;
}

// Devuelve true si hay que notificar (fila nueva o placeholder recién
// completado), false si esta convocatoria ya existía.
async function saveOpportunity(op) {
  const row = await upsertOpportunity(op);
  return !!row;
}

// Fila visible de inmediato en la app apenas se detecta el correo, antes de
// saber si el proceso ya está publicado en el portal de PanamaCompra.
// convocatoria queda NULL a propósito: es la marca de "placeholder" que
// saveOpportunity() busca para completar esta misma fila más tarde.
async function insertPlaceholderOpportunity(e) {
  await pool.query(
    `INSERT INTO opportunities
      (act_number, convocatoria, title, entity, window_info, category_match, recommendation, reasoning, decision, email_uid)
     VALUES ($1, NULL, $2, $3, $4, false, 'revisar', $5, 'pending', $6)`,
    [
      e.actNumber,
      'Nueva solicitud de cotización — detalles del proceso pendientes de PanamaCompra',
      e.entityFromEmail,
      e.windowFromEmail,
      'Detectado por correo; buscando ítems y precio de referencia en el portal de PanamaCompra.',
      e.uid,
    ]
  );
}

// Devuelve el detalle por suscriptor (ok/error) además de enviar el push,
// para poder diagnosticar fallos de entrega sin depender de los logs de Render.
async function sendPushToAll(payload) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:d.sanchezv@gstechnologiespty.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions');
  const results = [];
  for (const sub of subs) {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    try {
      await webpush.sendNotification(subscription, payload, { urgency: 'high', TTL: 3600 });
      results.push({ id: sub.id, ok: true });
    } catch (err) {
      results.push({ id: sub.id, ok: false, statusCode: err.statusCode, error: err.message });
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
      } else {
        console.error('Push error:', err.message);
      }
    }
  }
  return results;
}

async function notifyImmediateAlert(e) {
  const bodyLines = [];
  if (e.entityFromEmail) bodyLines.push(e.entityFromEmail);
  if (e.windowFromEmail) bodyLines.push(`Ventana: ${e.windowFromEmail}`);
  bodyLines.push('Buscando el resto de los detalles en PanamaCompra…');

  const payload = JSON.stringify({
    title: `📩 Nueva solicitud: ${e.actNumber}`,
    body: bodyLines.join('\n'),
    url: '/',
  });
  await sendPushToAll(payload);
}

async function notifySubscribers(op) {
  const icon = op.recommendation === 'participar' ? '✅' : op.recommendation === 'no_participar' ? '⛔' : '🔎';
  const payload = JSON.stringify({
    title: `${icon} ${op.actNumber}`,
    body: `${op.title}\n${op.entity} — B/. ${op.referencePrice ?? '?'}\nRecomendación: ${op.recommendation.replace('_', ' ')}`,
    url: '/',
  });
  await sendPushToAll(payload);
}

// Tope duro para el chequeo completo. Sin esto, si algo se cuelga en algún
// punto (IMAP, PanamaCompra, el envío de push) sin lanzar un error nunca,
// running se queda en true para siempre y ningún ciclo futuro de
// cron-job.org vuelve a correr hasta que Render reinicie el servidor — eso
// fue justamente lo que causó cortes de horas en las notificaciones.
const JOB_TIMEOUT_MS = 90000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tiempo de espera agotado (${ms / 1000}s) en: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let running = false;

async function runCheckEmailJob() {
  if (running) {
    return { skipped: true, reason: 'ya hay una revisión en curso' };
  }
  running = true;
  const log = [];
  const push = (msg) => { log.push(msg); console.log(msg); };

  try {
    const result = await withTimeout(runCheckEmailJobInner(push), JOB_TIMEOUT_MS, 'chequeo de correo completo');
    return { ...result, log };
  } catch (err) {
    push(`Error/tiempo agotado en el chequeo: ${err.message}`);
    return { ok: false, error: err.message, log };
  } finally {
    running = false;
  }
}

async function runCheckEmailJobInner(push) {
  await init();

  const deleted = await cleanupExpired();
  if (deleted > 0) push(`Oportunidades vencidas eliminadas: ${deleted}`);

  const emails = await fetchCandidateEmails();
  push(`Correos candidatos encontrados: ${emails.length}`);

  // Alerta inmediata: avisar apenas se detecta el correo, sin esperar a que
  // PanamaCompra publique el proceso en su portal. Se dispara una sola vez
  // por acto (email_alerts) y no si ese acto ya fue procesado por completo
  // antes (p. ej. un reenvío de PanamaCompra de algo ya resuelto).
  const seenForAlert = new Set();
  let alerted = 0;
  for (const e of emails) {
    if (seenForAlert.has(e.actNumber)) continue;
    seenForAlert.add(e.actNumber);
    if (await hasBeenAlerted(e.actNumber)) continue;
    if (await isActProcessed(e.actNumber)) continue;
    await insertPlaceholderOpportunity(e);
    await notifyImmediateAlert(e);
    await markAlerted(e.actNumber, e.subject);
    alerted++;
    push(`Alerta inmediata enviada: ${e.actNumber}`);
  }

  // Un mismo acto puede llegar en más de un correo (reenvíos/recordatorios
  // de PanamaCompra); nos quedamos con uno solo por acto antes de procesar.
  const seenActNumbers = new Set();
  const newActNumbers = [];
  for (const e of emails) {
    if (seenActNumbers.has(e.actNumber)) continue;
    if (await isActProcessed(e.actNumber)) continue;
    seenActNumbers.add(e.actNumber);
    newActNumbers.push(e);
  }
  push(`Actos nuevos a evaluar: ${newActNumbers.length}`);

  let saved = 0;
  if (newActNumbers.length > 0) {
    const cookie = await pc.login(process.env.PC_USUARIO, process.env.PC_CONTRASENA);

    for (const e of newActNumbers) {
      try {
        const registros = await pc.buscarProcesoCualquierEstado(cookie, e.actNumber);
        if (!registros.length) {
          push(`Sin registros en PanamaCompra para ${e.actNumber} (aún no visible en portal)`);
          continue;
        }

        for (const r of registros) {
          const { campos, items } = await pc.verPliego(cookie, r.idProcesosContratacionFlujos);
          const referencePrice = pc.extraerPrecio(campos['Precio estimado']);
          const title = campos['Título'] || r.titulo;
          const entity = campos['Entidad'] || '';
          const entityAddress = campos['Dirección de la unidad de compra'] || '';
          const entityProvince = campos['Provincia'] || '';
          const windowInfo = campos['Fecha y hora presentación de cotizaciones'] || '';
          const deadline = parseDeadline(windowInfo);

          const ev = evaluate({ title, referencePrice });

          const op = {
            actNumber: e.actNumber,
            convocatoria: String(r.numeroConvocatoria),
            title, entity, entityAddress, entityProvince, referencePrice, windowInfo, deadline, items,
            categoryMatch: ev.categoryMatch,
            recommendation: ev.recommendation,
            reasoning: ev.reasoning,
            emailUid: e.uid,
          };

          const inserted = await saveOpportunity(op);
          if (inserted) {
            await notifySubscribers(op);
            saved++;
            push(`Guardado y notificado: ${op.actNumber} conv.${op.convocatoria} -> ${op.recommendation}`);
          } else {
            push(`Ya existía, no se vuelve a notificar: ${op.actNumber} conv.${op.convocatoria}`);
          }
        }

        // Ya se procesó por completo este acto: no volver a mirarlo aunque
        // luego se borre de "opportunities" por vencido.
        await markActProcessed(e.actNumber);
      } catch (err) {
        push(`Error procesando ${e.actNumber}: ${err.message}`);
      }
    }
  }

  return { ok: true, emailsFound: emails.length, alerted, newActs: newActNumbers.length, saved, deleted };
}

module.exports = { runCheckEmailJob, sendPushToAll };

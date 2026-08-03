const { ImapFlow } = require('imapflow');
const webpush = require('web-push');
const { pool, init, cleanupExpired } = require('./db');
const pc = require('./panamacompra');
const { evaluate } = require('./evaluate');
const { parseDeadline } = require('./parseWindow');

const SUBJECT_RE = /Solicitud de cotizaci[oó]n en l[ií]nea\s*-\s*([\w-]+)/i;

async function fetchCandidateEmails() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const found = [];
  try {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // last 3 days, DB dedupes
    for await (const msg of client.fetch(
      { since, from: 'panamacompras.gob.pa' },
      { envelope: true, uid: true }
    )) {
      const subject = msg.envelope.subject || '';
      const m = subject.match(SUBJECT_RE);
      if (m) found.push({ uid: msg.uid, actNumber: m[1], subject });
    }
  } finally {
    lock.release();
  }
  await client.logout();
  return found;
}

async function alreadyKnown(actNumber) {
  const { rows } = await pool.query(
    'SELECT 1 FROM opportunities WHERE act_number = $1 LIMIT 1',
    [actNumber]
  );
  return rows.length > 0;
}

async function saveOpportunity(op) {
  await pool.query(
    `INSERT INTO opportunities
      (act_number, convocatoria, title, entity, entity_address, entity_province, reference_price, window_info, deadline, items, category_match, recommendation, reasoning, decision, email_uid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)
     ON CONFLICT (act_number, convocatoria) DO NOTHING`,
    [op.actNumber, op.convocatoria, op.title, op.entity, op.entityAddress, op.entityProvince, op.referencePrice, op.windowInfo, op.deadline,
     JSON.stringify(op.items || []), op.categoryMatch, op.recommendation, op.reasoning, op.emailUid]
  );
}

async function notifySubscribers(op) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:d.sanchezv@gstechnologiespty.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const { rows: subs } = await pool.query('SELECT * FROM push_subscriptions');
  const icon = op.recommendation === 'participar' ? '✅' : op.recommendation === 'no_participar' ? '⛔' : '🔎';
  const payload = JSON.stringify({
    title: `${icon} ${op.actNumber}`,
    body: `${op.title}\n${op.entity} — B/. ${op.referencePrice ?? '?'}\nRecomendación: ${op.recommendation.replace('_', ' ')}`,
    url: '/',
  });

  for (const sub of subs) {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
      } else {
        console.error('Push error:', err.message);
      }
    }
  }
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
    await init();

    const deleted = await cleanupExpired();
    if (deleted > 0) push(`Oportunidades vencidas eliminadas: ${deleted}`);

    const emails = await fetchCandidateEmails();
    push(`Correos candidatos encontrados: ${emails.length}`);

    const newActNumbers = [];
    for (const e of emails) {
      if (!(await alreadyKnown(e.actNumber))) newActNumbers.push(e);
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

            await saveOpportunity(op);
            await notifySubscribers(op);
            saved++;
            push(`Guardado y notificado: ${op.actNumber} conv.${op.convocatoria} -> ${op.recommendation}`);
          }
        } catch (err) {
          push(`Error procesando ${e.actNumber}: ${err.message}`);
        }
      }
    }

    return { ok: true, emailsFound: emails.length, newActs: newActNumbers.length, saved, deleted, log };
  } finally {
    running = false;
  }
}

module.exports = { runCheckEmailJob };

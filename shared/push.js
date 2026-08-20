const webpush = require('web-push');
const { pool } = require('./db');

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

// Notifica una oportunidad nueva encontrada — mismo formato sin importar si
// se encontró por el chequeo de correo o por la búsqueda directa en
// PanamaCompra, para que ambos caminos avisen igual.
async function notifySubscribers(op) {
  const icon = op.recommendation === 'participar' ? '✅' : op.recommendation === 'no_participar' ? '⛔' : '🔎';
  const payload = JSON.stringify({
    title: `${icon} ${op.actNumber}`,
    body: `${op.title}\n${op.entity} — B/. ${op.referencePrice ?? '?'}\nRecomendación: ${op.recommendation.replace('_', ' ')}`,
    url: '/',
  });
  await sendPushToAll(payload);
}

module.exports = { sendPushToAll, notifySubscribers };

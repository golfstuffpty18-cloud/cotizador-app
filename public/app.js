function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

const enableBtn = document.getElementById('enableBtn');
const statusEl = document.getElementById('status');

function setButtonState(active) {
  if (active) {
    enableBtn.textContent = 'Desactivar notificaciones';
    enableBtn.classList.add('active');
    statusEl.textContent = 'Notificaciones activadas ✅';
  } else {
    enableBtn.textContent = 'Activar notificaciones';
    enableBtn.classList.remove('active');
    statusEl.textContent = '';
  }
}

async function enableNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    statusEl.textContent = 'Este navegador no soporta notificaciones push.';
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      statusEl.textContent = 'Permiso de notificaciones denegado.';
      return;
    }
    const { publicKey } = await fetch('/api/vapid-public-key').then(r => r.json());
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    setButtonState(true);
  } catch (err) {
    statusEl.textContent = 'Error activando notificaciones: ' + err.message;
  }
}

async function disableNotifications() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setButtonState(false);
  } catch (err) {
    statusEl.textContent = 'Error desactivando notificaciones: ' + err.message;
  }
}

enableBtn.addEventListener('click', () => {
  if (enableBtn.classList.contains('active')) {
    disableNotifications();
  } else {
    enableNotifications();
  }
});

const searchBtn = document.getElementById('searchBtn');
// El ícono de búsqueda vive dentro de un botón con ícono+etiqueta
// (.qa-icon/.qa-label) — el "cargando" solo debe reemplazar el ícono, no
// todo el contenido del botón (si no, se pierde la etiqueta de texto).
const searchIcon = searchBtn ? searchBtn.querySelector('.qa-icon') : null;
if (searchBtn) {
  searchBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (searchBtn.dataset.loading === '1') return;
    searchBtn.dataset.loading = '1';
    const original = searchIcon.textContent;
    searchIcon.textContent = '⏳';
    statusEl.textContent = 'Buscando en PanamaCompra por rubro… puede tardar unos segundos.';
    try {
      const res = await fetch('/api/search/panamacompra', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error en la búsqueda');
      const { abiertas, programadas } = data;
      statusEl.textContent =
        `Abiertas: ${abiertas.nuevas} nueva(s) de ${abiertas.candidatas} candidata(s) (${abiertas.totalConsultadas} revisadas). ` +
        `Programadas: ${programadas.nuevas} nueva(s) de ${programadas.candidatas} candidata(s) (${programadas.totalConsultadas} revisadas).`;
      await loadOpportunities();
    } catch (err) {
      statusEl.textContent = 'Error buscando en PanamaCompra: ' + err.message;
    } finally {
      searchIcon.textContent = original;
      searchBtn.dataset.loading = '';
    }
  });
}

async function checkExistingSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sub = await reg.pushManager.getSubscription();
    setButtonState(!!sub && Notification.permission === 'granted');
  } catch (err) {
    // Silencioso: si falla la verificación, simplemente se deja el botón en estado "Activar".
  }
}

checkExistingSubscription();

function fmtDate(d) {
  return new Date(d).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function decide(id, decision, btnEl) {
  const res = await fetch(`/api/opportunities/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  if (res.ok) loadOpportunities();
}

function card(op) {
  const rec = op.recommendation;
  const isPlaceholder = !op.convocatoria; // detectado por correo, aún sin detalles del portal
  const recLabel = isPlaceholder ? 'Detectado' : rec === 'participar' ? 'Participar' : rec === 'no_participar' ? 'No participar' : 'Revisar';
  const price = op.reference_price != null ? `B/. ${Number(op.reference_price).toLocaleString('es-PA', { minimumFractionDigits: 2 })}` : 'No indicado';

  const div = document.createElement('div');
  div.className = `card ${rec}`;
  div.innerHTML = `
    <span class="badge ${rec}">${recLabel}</span>
    <div class="act">${op.act_number}${op.convocatoria ? ` — Convocatoria ${op.convocatoria}` : ''}</div>
    <div class="title">${op.title}</div>
    <div class="entity">${op.entity || ''}</div>
    <div class="meta">
      <span><b>Precio ref.:</b> ${price}</span>
      <span><b>Ventana:</b> ${op.window_info || 'No indicada'}</span>
    </div>
    <div class="reasoning">${op.reasoning}</div>
    ${isPlaceholder ? '' : `
    <div class="actions">
      <button class="yes ${op.decision === 'participar' ? 'active' : ''}">Sí, participar</button>
      <button class="no ${op.decision === 'no_participar' ? 'active' : ''}">No participar</button>
    </div>
    ${op.decision === 'participar' ? `<a class="quote-link" href="/quote.html?id=${op.id}">Armar cotización →</a>` : ''}`}
  `;
  if (!isPlaceholder) {
    div.querySelector('.yes').addEventListener('click', () => decide(op.id, 'participar'));
    div.querySelector('.no').addEventListener('click', () => decide(op.id, 'no_participar'));
  }
  return div;
}

async function loadOpportunities() {
  const list = document.getElementById('list');
  const res = await fetch('/api/opportunities');
  const items = await res.json();
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty">Aún no hay oportunidades detectadas.<br>Te avisaremos por notificación en cuanto aparezca una.</div>';
    return;
  }
  items.forEach(op => list.appendChild(card(op)));
}

loadOpportunities();

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

const enableBtn = document.getElementById('enableBtn'); // creado por shell.js (campana en la topbar)
const notifActivateBtn = document.getElementById('notifActivateBtn'); // dentro de #emptyState
const statusEl = document.getElementById('status');

function setButtonState(active) {
  enableBtn.classList.toggle('active', active);
  enableBtn.title = active ? 'Desactivar notificaciones' : 'Activar notificaciones';
  if (notifActivateBtn) {
    notifActivateBtn.textContent = active ? 'Notificaciones activadas' : 'Activar notificaciones';
    notifActivateBtn.disabled = active;
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

function toggleNotifications() {
  if (enableBtn.classList.contains('active')) {
    disableNotifications();
  } else {
    enableNotifications();
  }
}

enableBtn.addEventListener('click', toggleNotifications);
if (notifActivateBtn) notifActivateBtn.addEventListener('click', toggleNotifications);

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

// ---------- búsqueda manual en PanamaCompra (la detección automática ya
// corre sola cada 5 min vía cron; esto solo fuerza una pasada inmediata) ----------

async function buscarAhora() {
  if (statusEl.dataset.loading === '1') return;
  statusEl.dataset.loading = '1';
  statusEl.textContent = 'Buscando en PanamaCompra… puede tardar unos segundos.';
  try {
    const res = await fetch('/api/search/panamacompra', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en la búsqueda');
    const { abiertas, programadas } = data;
    statusEl.textContent = `Abiertas: ${abiertas.nuevas} nueva(s) de ${abiertas.candidatas} candidata(s). ` +
      `Programadas: ${programadas.nuevas} nueva(s) de ${programadas.candidatas} candidata(s).`;
    await loadOpportunities();
  } catch (err) {
    statusEl.textContent = 'Error buscando en PanamaCompra: ' + err.message;
  } finally {
    statusEl.dataset.loading = '';
  }
}

// ---------- filtro de texto sobre la lista ya cargada (no llama al servidor) ----------

let currentOpportunities = [];
const searchInput = document.getElementById('globalSearchInput'); // creado por shell.js (topbar)
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = !q ? currentOpportunities : currentOpportunities.filter(op =>
      (op.title || '').toLowerCase().includes(q) ||
      (op.entity || '').toLowerCase().includes(q) ||
      (op.act_number || '').toLowerCase().includes(q)
    );
    renderOpportunityList(filtered, q ? 'Sin resultados para tu búsqueda.' : null);
  });
}

function fmtDate(d) {
  return new Date(d).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function decide(id, decision) {
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

function renderOpportunityList(items, emptyMessage) {
  const list = document.getElementById('list');
  const emptyState = document.getElementById('emptyState');
  const listHeading = document.getElementById('listHeading');

  if (!items.length) {
    list.innerHTML = '';
    if (emptyMessage) {
      // Filtro de búsqueda sin resultados: no es "aún no hay oportunidades",
      // así que no se muestra la ilustración de bienvenida, solo el aviso.
      emptyState.hidden = true;
      listHeading.hidden = false;
      list.innerHTML = `<div class="empty">${emptyMessage}</div>`;
    } else {
      emptyState.hidden = false;
      listHeading.hidden = true;
    }
    return;
  }
  emptyState.hidden = true;
  listHeading.hidden = false;
  list.innerHTML = '';
  items.forEach(op => list.appendChild(card(op)));
}

async function loadOpportunities() {
  const res = await fetch('/api/opportunities?tipo=cotizacion_linea');
  currentOpportunities = await res.json();
  renderOpportunityList(currentOpportunities);
  return currentOpportunities;
}

// ---------- grid de módulos ----------
// Escritorio: imagen de referencia 2 (icono + título + descripción, sin
// contador). Celular: imagen de referencia 3 (icono + título + estado,
// ver .module-status en el media query de styles.css).

const MODULE_DEFS = [
  { key: 'cotizacion_linea', href: '/index.html', icon: 'quote', color: 'mod-blue', title: 'Cotización en línea', desc: 'Solicita cotizaciones para productos o servicios específicos de múltiples proveedores.' },
  { key: 'compra_menor', href: '/compra-menor.html', icon: 'cart', color: 'mod-emerald', title: 'Compra Menor', desc: 'Realiza compras de bajo monto de forma rápida y sencilla.' },
  { key: 'programadas', href: '/programadas.html', icon: 'calendar', color: 'mod-violet', title: 'Programadas', desc: 'Gestiona cotizaciones programadas y recordatorios automáticos.' },
  { key: 'enviadas', href: '/enviadas.html', icon: 'send', color: 'mod-sky', title: 'Enviadas', desc: 'Consulta el historial de cotizaciones enviadas y su estado actual.' },
  { key: null, href: '/directo.html', icon: 'bolt', color: 'mod-orange', title: 'Directas', desc: 'Envía cotizaciones directas a proveedores seleccionados.' },
  { key: 'catalogo', href: '/catalog.html', icon: 'book', color: 'mod-teal', title: 'Catálogo', desc: 'Explora productos y servicios disponibles en el catálogo.' },
  { key: null, href: '/finanzas.html', icon: 'finance', color: 'mod-gold', title: 'Finanzas', desc: 'Consulta reportes financieros y análisis de cotizaciones.' },
  { key: null, href: '/documentos.html', icon: 'sign', color: 'mod-rose', title: 'Autenticar documentos', desc: 'Sube un Word y estampa la firma del representante legal automáticamente.' },
];

function moduleStatusLabel(key, counts) {
  if (!key) return '';
  const n = counts[key];
  if (n == null) return '';
  if (key === 'programadas') return n > 0 ? `${n} próxima(s)` : 'Ninguna por ahora';
  if (key === 'catalogo') return `${n} ítem(s)`;
  if (key === 'enviadas') return `${n} enviada(s)`;
  return n > 0 ? `${n} activa(s)` : 'Sin novedades';
}

function renderModuleGrid(counts) {
  const grid = document.getElementById('moduleGrid');
  if (!grid) return;
  grid.innerHTML = MODULE_DEFS.map(m => {
    const status = moduleStatusLabel(m.key, counts);
    const hasItems = m.key && counts[m.key] > 0;
    return `
      <a class="module-card" href="${m.href}">
        <div class="module-icon ${m.color}">${icon(m.icon, 20)}</div>
        <div class="module-title">${m.title}</div>
        <div class="module-desc">${m.desc}</div>
        ${status ? `<div class="module-status ${hasItems ? 'has-items' : ''}">${status}</div>` : ''}
      </a>
    `;
  }).join('');
}

function renderStats(counts) {
  const row = document.getElementById('statsRow');
  if (!row) return;
  const stats = [
    { label: 'Oportunidades activas', value: counts.cotizacion_linea ?? '—' },
    { label: 'Programadas', value: counts.programadas ?? '—' },
    { label: 'Enviadas', value: counts.enviadas ?? '—' },
    { label: 'Catálogo', value: counts.catalogo ?? '—' },
  ];
  row.innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>
  `).join('');
}

async function safeCount(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data.length : null;
  } catch (err) {
    return null;
  }
}

async function loadDashboardExtras() {
  const [compraMenor, programadas, catalogo, enviadas] = await Promise.all([
    safeCount('/api/opportunities?tipo=compra_menor'),
    safeCount('/api/opportunities?vista=programadas'),
    safeCount('/api/catalog'),
    safeCount('/api/enviadas'), // depende de un login en vivo a PanamaCompra; null si falla
  ]);
  const counts = { compra_menor: compraMenor, programadas, catalogo, enviadas, cotizacion_linea: currentOpportunities.length };
  renderModuleGrid(counts);
  renderStats(counts);
}

const searchNowBtn = document.getElementById('searchNowBtn');
if (searchNowBtn) searchNowBtn.addEventListener('click', buscarAhora);

(async function initDashboard() {
  await loadOpportunities();
  renderModuleGrid({ cotizacion_linea: currentOpportunities.length });
  await loadDashboardExtras();
})();

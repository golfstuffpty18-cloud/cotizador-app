const statusEl = document.getElementById('status');
const searchBtn = document.getElementById('searchBtn');

searchBtn.addEventListener('click', async () => {
  if (searchBtn.dataset.loading === '1') return;
  searchBtn.dataset.loading = '1';
  const original = searchBtn.textContent;
  searchBtn.textContent = '⏳ Buscando…';
  statusEl.textContent = 'Buscando en PanamaCompra… puede tardar unos segundos.';
  try {
    const res = await fetch('/api/search/rango-precio', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en la búsqueda');
    const { vigentes } = data;
    statusEl.textContent = `Vigentes: ${vigentes.nuevas} nueva(s) de ${vigentes.candidatas} candidata(s) (${vigentes.totalConsultadas} revisadas).`;
    await loadOpportunities();
  } catch (err) {
    statusEl.textContent = 'Error buscando en PanamaCompra: ' + err.message;
  } finally {
    searchBtn.textContent = original;
    searchBtn.dataset.loading = '';
  }
});

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
  const recLabel = rec === 'participar' ? 'Participar' : rec === 'no_participar' ? 'No participar' : 'Revisar';
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
    <div class="actions">
      <button class="yes ${op.decision === 'participar' ? 'active' : ''}">Sí, participar</button>
      <button class="no ${op.decision === 'no_participar' ? 'active' : ''}">No participar</button>
    </div>
    ${op.decision === 'participar' ? `<a class="quote-link" href="/quote.html?id=${op.id}">Armar cotización →</a>` : ''}
  `;
  div.querySelector('.yes').addEventListener('click', () => decide(op.id, 'participar'));
  div.querySelector('.no').addEventListener('click', () => decide(op.id, 'no_participar'));
  return div;
}

async function loadOpportunities() {
  const list = document.getElementById('list');
  const res = await fetch('/api/opportunities?tipo=compra_menor');
  const items = await res.json();
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty">Aún no hay oportunidades de Compra Menor detectadas.<br>Usa el botón de arriba para buscar por rubro.</div>';
    return;
  }
  items.forEach(op => list.appendChild(card(op)));
}

loadOpportunities();

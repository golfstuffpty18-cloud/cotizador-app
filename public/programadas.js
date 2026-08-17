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
  const recLabel = rec === 'participar' ? 'Participar' : rec === 'no_participar' ? 'No participar' : 'Revisar';
  const price = op.reference_price != null ? `B/. ${Number(op.reference_price).toLocaleString('es-PA', { minimumFractionDigits: 2 })}` : 'No indicado';

  const div = document.createElement('div');
  div.className = `card ${rec}`;
  div.innerHTML = `
    <span class="badge programada">Programada</span>
    <div class="act">${op.act_number}${op.convocatoria ? ` — Convocatoria ${op.convocatoria}` : ''}</div>
    <div class="title">${op.title}</div>
    <div class="entity">${op.entity || ''}</div>
    <div class="meta">
      <span><b>Precio ref.:</b> ${price}</span>
      <span><b>Recomendación:</b> ${recLabel}</span>
    </div>
    ${op.window_start ? `<div class="opens-at">Se abre: ${fmtDate(op.window_start)}</div>` : ''}
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
  const res = await fetch('/api/opportunities?vista=programadas');
  const items = await res.json();
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="empty">No hay cotizaciones programadas por ahora.<br>Aparecerán aquí en cuanto PanamaCompra publique una y siga sin abrir ventana.</div>';
    return;
  }
  items.forEach(op => list.appendChild(card(op)));
}

loadOpportunities();

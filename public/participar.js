function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) {
  return 'B/. ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// "Cierra en 2 h 15 min" / "Cierra en 3 días" — lo que importa al decidir
// qué cotización armar primero.
function faltan(deadline) {
  const ms = new Date(deadline).getTime() - Date.now();
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} días`;
}

function estadoCotizacion(op) {
  if (op.quote_estado === 'aprobada') return { cls: 'aprobada', txt: `✅ Cotización aprobada · ${money(op.quote_total)}` };
  if (op.quote_estado) return { cls: 'borrador', txt: `✏️ Borrador guardado${op.quote_total != null ? ` · ${money(op.quote_total)}` : ''}` };
  return { cls: 'sin', txt: 'Cotización sin empezar' };
}

function card(op) {
  const div = document.createElement('div');
  div.className = 'card participar';
  const est = estadoCotizacion(op);
  const urgente = op.deadline && new Date(op.deadline).getTime() - Date.now() < 24 * 3600 * 1000;
  const programada = op.window_start && new Date(op.window_start).getTime() > Date.now();
  const tipo = op.tipo_proceso === 'compra_menor' ? 'Compra Menor' : 'Cotización en línea';

  div.innerHTML = `
    <span class="badge participar">Participar</span><span class="p-tipo">${tipo}</span>${programada ? '<span class="p-tipo">Programada</span>' : ''}
    <div class="act">${escapeHtml(op.act_number)}${op.convocatoria ? ` — Convocatoria ${escapeHtml(op.convocatoria)}` : ''}</div>
    <div class="title">${escapeHtml(op.title)}</div>
    <div class="entity">${escapeHtml(op.entity || '')}</div>
    <div class="p-cierre ${urgente ? 'urgente' : ''}">
      ${op.deadline ? `Cierra: <b>${fmtDateTime(op.deadline)}</b> (en ${faltan(op.deadline)})` : `Ventana: <b>${escapeHtml(op.window_info || 'No indicada')}</b>`}
      ${op.reference_price != null ? ` · Precio ref.: ${money(op.reference_price)}` : ''}
    </div>
    <div class="p-estado ${est.cls}">${est.txt}</div>
    <div class="p-acciones">
      <a class="p-btn primario" href="/quote.html?id=${op.id}">${op.quote_estado ? 'Abrir cotización →' : 'Armar cotización →'}</a>
      ${op.quote_estado === 'aprobada' ? `<a class="p-btn" href="/api/opportunities/${op.id}/quote/pdf" target="_blank">📄 PDF</a>` : ''}
    </div>
  `;
  return div;
}

async function load() {
  const listEl = document.getElementById('list');
  try {
    const res = await fetch('/api/participar');
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || 'Error cargando los actos');
    listEl.innerHTML = '';
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">No tienes actos abiertos marcados para participar. Márcalos con "Sí, participar" en Cotización en línea o Compra Menor y aparecerán aquí.</div>';
      return;
    }
    items.forEach(op => listEl.appendChild(card(op)));
  } catch (err) {
    listEl.innerHTML = `<div class="empty">❌ ${escapeHtml(err.message)}</div>`;
  }
}

load();

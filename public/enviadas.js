function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) {
  return 'B/. ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const listEl = document.getElementById('list');

async function loadCuadro(op, wrap) {
  wrap.innerHTML = '<p class="sin-datos">Consultando PanamaCompra…</p>';
  const res = await fetch(`/api/enviadas/${op.idProcesosContratacion}/cuadro?numProceso=${encodeURIComponent(op.numProceso)}`);
  const data = await res.json();
  if (!res.ok) { wrap.innerHTML = `<p class="sin-datos">❌ ${escapeHtml(data.error || 'Error consultando el cuadro')}</p>`; return; }

  if (!data.reconocido || !data.proveedores.length) {
    wrap.innerHTML = '<p class="sin-datos">Aún no hay cuadro comparativo publicado por la entidad para este proceso.</p>';
    return;
  }

  const rows = data.proveedores.map((p, i) => `
    <tr class="${i === 0 ? 'ganador' : ''}">
      <td>${i + 1}</td>
      <td>${escapeHtml(p.nombre)}</td>
      <td>${p.precioTotal != null ? money(p.precioTotal) : '-'}</td>
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table class="cuadro">
      <thead><tr><th>Puesto</th><th>Proveedor</th><th>Precio</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function card(op) {
  const div = document.createElement('div');
  div.className = 'card';

  const cierre = op.fechaCierre ? new Date(op.fechaCierre) : null;
  const yaCerro = cierre ? cierre.getTime() < Date.now() : false;

  div.innerHTML = `
    <span class="badge">${escapeHtml(op.estado || 'Sin estado')}</span>
    <div class="title">${escapeHtml(op.titulo)}</div>
    <div class="meta"><b>${escapeHtml(op.numProceso)}</b><br>Cierre: ${fmtDateTime(op.fechaCierre)}</div>
    ${yaCerro
      ? `<button type="button" class="btn btn-ver">Ver cuadro comparativo ▾</button><div class="cuadro-wrap" style="display:none"></div>`
      : `<div class="pending">Disponible desde ${fmtDateTime(op.fechaCierre)}</div>`}
  `;

  if (yaCerro) {
    const btn = div.querySelector('.btn-ver');
    const wrap = div.querySelector('.cuadro-wrap');
    let loaded = false;
    btn.addEventListener('click', async () => {
      const visible = wrap.style.display !== 'none';
      if (visible) { wrap.style.display = 'none'; return; }
      wrap.style.display = 'block';
      if (!loaded) { loaded = true; await loadCuadro(op, wrap); }
    });
  }

  return div;
}

async function loadList() {
  const res = await fetch('/api/enviadas');
  const items = await res.json();
  listEl.innerHTML = '';
  if (!res.ok) { listEl.innerHTML = `<div class="empty">❌ ${escapeHtml(items.error || 'Error cargando las cotizaciones enviadas')}</div>`; return; }
  if (!items.length) {
    listEl.innerHTML = '<div class="empty">Aún no has enviado ninguna oferta en PanamaCompra.</div>';
    return;
  }
  items.forEach(op => listEl.appendChild(card(op)));
}

loadList();

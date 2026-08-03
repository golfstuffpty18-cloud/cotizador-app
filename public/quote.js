const params = new URLSearchParams(location.search);
const oppId = params.get('id');
const app = document.getElementById('app');

function money(n) {
  return 'B/. ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function computeTotals(items) {
  const subtotal = items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precioUnitario) || 0), 0);
  const itbm = subtotal * 0.07;
  return { subtotal, itbm, total: subtotal + itbm };
}

async function load() {
  if (!oppId) { app.innerHTML = '<p>Falta el ID de la oportunidad.</p>'; return; }

  const [opp, quote] = await Promise.all([
    fetch(`/api/opportunities/${oppId}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/opportunities/${oppId}/quote`).then(r => r.ok ? r.json() : null),
  ]);

  if (!opp) { app.innerHTML = '<p>No se encontró la oportunidad.</p>'; return; }

  const locked = quote && quote.estado === 'aprobada';

  const baseItems = (quote && quote.items && quote.items.length)
    ? quote.items
    : (opp.items || []).map(i => ({
        numRenglon: i.numRenglon, descripcion: i.descripcion, cantidad: i.cantidad,
        unidad: i.unidad, precioReferencia: i.precioReferencia, precioUnitario: '',
      }));

  render(opp, quote, baseItems, locked);
}

function render(opp, quote, items, locked) {
  app.innerHTML = `
    ${locked ? `<div class="locked-banner">✅ Cotización aprobada — ya no se puede editar. Descarga el PDF abajo.</div>` : ''}

    <section>
      <h2>Proceso</h2>
      <p style="margin:0;font-size:.85rem;color:var(--gray-600)">
        <b>${opp.act_number}</b> — ${opp.title}
      </p>
    </section>

    <section>
      <h2>Cliente</h2>
      <label>Nombre / Entidad</label>
      <input id="cliente_nombre" ${locked ? 'disabled' : ''} value="${escapeHtml((quote && quote.cliente_nombre) || opp.entity || '')}">
      <div class="row2">
        <div>
          <label>RUC (opcional)</label>
          <input id="cliente_ruc" ${locked ? 'disabled' : ''} value="${escapeHtml((quote && quote.cliente_ruc) || '')}">
        </div>
        <div>
          <label>Ciudad</label>
          <input id="cliente_ciudad" ${locked ? 'disabled' : ''} value="${escapeHtml((quote && quote.cliente_ciudad) || 'Panamá')}">
        </div>
      </div>
      <label>Dirección</label>
      <input id="cliente_direccion" ${locked ? 'disabled' : ''} value="${escapeHtml((quote && quote.cliente_direccion) || '')}">
      <label>Forma de pago</label>
      <select id="forma_pago" ${locked ? 'disabled' : ''}>
        ${['Crédito', 'Contado'].map(o => `<option ${((quote && quote.forma_pago) || 'Crédito') === o ? 'selected' : ''}>${o}</option>`).join('')}
      </select>
    </section>

    <section>
      <h2>Ítems (define tu precio unitario final)</h2>
      <div id="items"></div>
      <div class="totals">
        <div class="line"><span>Subtotal</span><span id="tSubtotal">B/. 0.00</span></div>
        <div class="line"><span>ITBM (7%)</span><span id="tItbm">B/. 0.00</span></div>
        <div class="line total"><span>TOTAL</span><span id="tTotal">B/. 0.00</span></div>
      </div>
    </section>

    <section>
      <h2>Comentarios</h2>
      <textarea id="comentarios" rows="3" ${locked ? 'disabled' : ''}>${escapeHtml((quote && quote.comentarios) || '')}</textarea>
    </section>

    ${locked ? `
      <div class="actions">
        <a class="btn btn-primary" style="text-align:center;text-decoration:none;line-height:1.6" href="/api/opportunities/${oppId}/quote/pdf" target="_blank">Descargar PDF</a>
      </div>
    ` : `
      <div class="actions">
        <button class="btn btn-ghost" id="btnSave">Guardar borrador</button>
        <button class="btn btn-success" id="btnApprove">Aprobar y generar PDF</button>
      </div>
    `}
    <div id="msg"></div>
  `;

  const itemsDiv = document.getElementById('items');
  items.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="desc">${item.numRenglon ?? idx + 1}. ${escapeHtml(item.descripcion || '')}</div>
      <div class="meta">Cantidad: ${item.cantidad || 0} ${escapeHtml(item.unidad || '')}
        ${item.precioReferencia != null ? ` · Precio de referencia (gobierno): ${money(item.precioReferencia)}` : ''}
      </div>
      <label>Tu precio unitario (B/.)</label>
      <input type="number" step="0.01" min="0" class="precioUnitario" value="${item.precioUnitario ?? ''}" ${locked ? 'disabled' : ''} placeholder="0.00">
      <div class="subtotal">Subtotal: <span class="rowSubtotal">B/. 0.00</span></div>
    `;
    itemsDiv.appendChild(div);

    const input = div.querySelector('.precioUnitario');
    const rowSubtotalEl = div.querySelector('.rowSubtotal');
    const updateRow = () => {
      item.precioUnitario = parseFloat(input.value) || 0;
      rowSubtotalEl.textContent = money((Number(item.cantidad) || 0) * item.precioUnitario);
      updateTotals();
    };
    input.addEventListener('input', updateRow);
    updateRow();
  });

  function updateTotals() {
    const t = computeTotals(items);
    document.getElementById('tSubtotal').textContent = money(t.subtotal);
    document.getElementById('tItbm').textContent = money(t.itbm);
    document.getElementById('tTotal').textContent = money(t.total);
  }
  updateTotals();

  function collectPayload() {
    return {
      cliente_nombre: document.getElementById('cliente_nombre').value,
      cliente_ruc: document.getElementById('cliente_ruc').value,
      cliente_direccion: document.getElementById('cliente_direccion').value,
      cliente_ciudad: document.getElementById('cliente_ciudad').value,
      forma_pago: document.getElementById('forma_pago').value,
      comentarios: document.getElementById('comentarios').value,
      items: items.map((i, idx) => ({
        numRenglon: i.numRenglon ?? idx + 1,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        unidad: i.unidad,
        precioUnitario: i.precioUnitario || 0,
      })),
    };
  }

  const msg = document.getElementById('msg');

  const btnSave = document.getElementById('btnSave');
  if (btnSave) btnSave.addEventListener('click', async () => {
    msg.textContent = 'Guardando…';
    const res = await fetch(`/api/opportunities/${oppId}/quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload()),
    });
    msg.textContent = res.ok ? 'Borrador guardado ✅' : 'Error al guardar';
  });

  const btnApprove = document.getElementById('btnApprove');
  if (btnApprove) btnApprove.addEventListener('click', async () => {
    if (!confirm('Al aprobar, la cotización queda bloqueada para edición y se genera el PDF final. ¿Continuar?')) return;
    msg.textContent = 'Guardando y generando PDF…';
    const saveRes = await fetch(`/api/opportunities/${oppId}/quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectPayload()),
    });
    if (!saveRes.ok) { msg.textContent = 'Error al guardar antes de aprobar'; return; }
    const approveRes = await fetch(`/api/opportunities/${oppId}/quote/approve`, { method: 'POST' });
    if (!approveRes.ok) { msg.textContent = 'Error al aprobar'; return; }
    msg.textContent = 'Cotización aprobada ✅';
    load();
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

load();

const params = new URLSearchParams(location.search);
const oppId = params.get('id');
const app = document.getElementById('app');

function money(n) {
  return 'B/. ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function load() {
  if (!oppId) { app.innerHTML = '<p>Falta el ID de la oportunidad.</p>'; return; }

  const [opp, quote] = await Promise.all([
    fetch(`/api/opportunities/${oppId}`).then(r => r.ok ? r.json() : null),
    fetch(`/api/opportunities/${oppId}/quote`).then(r => r.ok ? r.json() : null),
  ]);

  if (!opp) { app.innerHTML = '<p>No se encontró la oportunidad.</p>'; return; }

  render(opp, quote);
}

function render(opp, quote) {
  const locked = quote && quote.estado === 'aprobada';
  const hasDraft = !!(quote && quote.items && quote.items.length);

  app.innerHTML = `
    ${locked ? `<div class="locked-banner">✅ Cotización aprobada — ya no se puede editar. Descarga el PDF abajo.</div>` : ''}

    <section>
      <h2>Proceso</h2>
      <p style="margin:0;font-size:.85rem;color:var(--gray-600)">
        <b>${opp.act_number}</b> — ${escapeHtml(opp.title)}
      </p>
    </section>

    ${!locked ? `
    <section>
      <h2>Paso 1 · Descarga el Excel</h2>
      <p style="font-size:.82rem;color:var(--gray-600);margin-top:0">
        Trae los ítems del proceso con espacio para que definas tu precio unitario final.
      </p>
      <a class="btn btn-ghost" style="display:block;text-align:center;text-decoration:none;line-height:1.6"
         href="/api/opportunities/${oppId}/quote/excel">⬇ Descargar Excel</a>
    </section>

    <section>
      <h2>Paso 2 · Sube el Excel completado</h2>
      <p style="font-size:.82rem;color:var(--gray-600);margin-top:0">
        Cuando hayas llenado la columna "PRECIO UNITARIO" y guardado el archivo, súbelo aquí.
      </p>
      <input type="file" id="fileInput" accept=".xlsx">
      <button class="btn btn-primary" id="btnUpload" style="width:100%">Subir Excel completado</button>
      <div id="uploadMsg" style="font-size:.82rem;margin-top:8px;color:var(--gray-600)"></div>
    </section>
    ` : ''}

    <section>
      <h2>${locked ? 'Cotización aprobada' : 'Vista previa'}</h2>
      ${hasDraft ? renderPreview(quote) : `<p style="font-size:.85rem;color:var(--gray-400)">Todavía no has subido un Excel con precios.</p>`}
    </section>

    ${locked ? `
      <div class="actions">
        <a class="btn btn-primary" style="text-align:center;text-decoration:none;line-height:1.6" href="/api/opportunities/${oppId}/quote/pdf" target="_blank">Descargar PDF</a>
      </div>
    ` : (hasDraft ? `
      <div class="actions">
        <button class="btn btn-success" id="btnApprove" style="width:100%">Aprobar y generar PDF</button>
      </div>
    ` : '')}
    <div id="msg"></div>
  `;

  const fileInput = document.getElementById('fileInput');
  const btnUpload = document.getElementById('btnUpload');
  const uploadMsg = document.getElementById('uploadMsg');
  if (btnUpload) btnUpload.addEventListener('click', async () => {
    if (!fileInput.files.length) { uploadMsg.textContent = 'Selecciona un archivo primero.'; return; }
    uploadMsg.textContent = 'Subiendo y leyendo el Excel…';
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    const res = await fetch(`/api/opportunities/${oppId}/quote/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { uploadMsg.textContent = '❌ ' + (data.error || 'Error al subir el archivo'); return; }
    uploadMsg.textContent = data.isKnownTemplate ? '✅ Excel leído correctamente.' : '⚠️ Archivo leído, pero no parece ser la plantilla generada por la app — revisa la vista previa.';
    load();
  });

  const btnApprove = document.getElementById('btnApprove');
  if (btnApprove) btnApprove.addEventListener('click', async () => {
    if (!confirm('Al aprobar, la cotización queda bloqueada para edición y se genera el PDF final. ¿Continuar?')) return;
    const msg = document.getElementById('msg');
    msg.textContent = 'Generando PDF…';
    const res = await fetch(`/api/opportunities/${oppId}/quote/approve`, { method: 'POST' });
    if (!res.ok) { msg.textContent = 'Error al aprobar'; return; }
    msg.textContent = 'Cotización aprobada ✅';
    load();
  });
}

function renderPreview(quote) {
  const rows = quote.items.map(i => `
    <div class="item">
      <div class="desc">${i.numRenglon}. ${escapeHtml(i.descripcion)}</div>
      <div class="meta">
        ${i.modelo ? 'Modelo: ' + escapeHtml(i.modelo) + ' · ' : ''}Cantidad: ${i.cantidad} ${escapeHtml(i.unidad || '')}
      </div>
      <div class="subtotal">Precio unitario: ${money(i.precioUnitario)} · Subtotal: <b>${money((i.cantidad || 0) * (i.precioUnitario || 0))}</b></div>
    </div>
  `).join('');

  return `
    <p style="font-size:.85rem;margin:0 0 10px">
      <b>Cliente:</b> ${escapeHtml(quote.cliente_nombre || '-')}<br>
      ${quote.cliente_direccion ? escapeHtml(quote.cliente_direccion) + (quote.cliente_ciudad ? ', ' + escapeHtml(quote.cliente_ciudad) : '') + '<br>' : ''}
      ${quote.cliente_ruc ? 'RUC: ' + escapeHtml(quote.cliente_ruc) + '<br>' : ''}
      Forma de pago: ${escapeHtml(quote.forma_pago || 'Crédito')}
    </p>
    ${rows}
    ${quote.comentarios ? `<p style="font-size:.82rem;color:var(--gray-600);margin-top:10px"><b>Comentarios:</b> ${escapeHtml(quote.comentarios)}</p>` : ''}
    <div class="totals">
      <div class="line"><span>Subtotal</span><span>${money(quote.subtotal)}</span></div>
      <div class="line"><span>ITBM (7%)</span><span>${money(quote.itbm)}</span></div>
      <div class="line total"><span>TOTAL</span><span>${money(quote.total)}</span></div>
    </div>
  `;
}

load();

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
  const esIncendio = opp.category === 'Detección de Incendio';
  const needsTecnologia = esIncendio && !opp.tecnologia_incendio && !locked;

  app.innerHTML = `
    ${locked ? `<div class="locked-banner">✅ Cotización aprobada. Descarga el PDF abajo, o modifícala si necesitas cambiar algo.</div>` : ''}

    <section>
      <h2>${opp.source === 'directo' ? 'Cliente' : 'Proceso'}</h2>
      <p style="margin:0;font-size:.85rem;color:var(--gray-600)">
        ${opp.source === 'directo' ? escapeHtml(opp.title) : `<b>${opp.act_number}</b> — ${escapeHtml(opp.title)}`}
      </p>
      ${esIncendio && opp.tecnologia_incendio ? `<p style="margin:8px 0 0;font-size:.78rem;color:var(--blue);font-weight:700">Tecnología: ${escapeHtml(opp.tecnologia_incendio)}</p>` : ''}
      ${opp.entity || opp.entity_address || opp.entity_province || opp.window_info ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-100);font-size:.8rem;color:var(--gray-600)">
        ${opp.entity ? `<p style="margin:0 0 4px"><b>Entidad:</b> ${escapeHtml(opp.entity)}</p>` : ''}
        ${opp.entity_address ? `<p style="margin:0 0 4px"><b>Dirección:</b> ${escapeHtml(opp.entity_address)}${opp.entity_province ? `, ${escapeHtml(opp.entity_province)}` : ''}</p>` : ''}
        ${opp.window_info ? `<p style="margin:0"><b>Ventana:</b> ${escapeHtml(opp.window_info)}</p>` : ''}
      </div>` : ''}
    </section>

    ${opp.source === 'panamacompra' ? renderDocumentos(opp) : ''}

    ${needsTecnologia ? `
    <section>
      <h2>¿Convencional o direccionable?</h2>
      <p style="font-size:.82rem;color:var(--gray-600);margin-top:0">
        Antes de armar el Excel, dinos qué tecnología es este sistema de incendio — convencional y direccionable
        usan equipo distinto e incompatible entre sí, y así la app te sugiere el precio correcto de una vez.
      </p>
      <div class="actions">
        <button class="btn btn-ghost" id="btnConvencional" style="width:100%">Convencional</button>
        <button class="btn btn-ghost" id="btnDireccionable" style="width:100%">Direccionable</button>
      </div>
    </section>
    ` : ''}

    ${!locked && !needsTecnologia ? `
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

    ${hasDraft ? renderProfitAnalysis(quote) : ''}

    ${locked ? `
      <div class="actions">
        <a class="btn btn-primary" style="text-align:center;text-decoration:none;line-height:1.6" href="/api/opportunities/${oppId}/quote/pdf" target="_blank">Descargar PDF</a>
        <button class="btn btn-ghost" id="btnUnlock" style="width:100%">✏️ Modificar cotización</button>
      </div>
    ` : (hasDraft ? `
      <div class="actions">
        <button class="btn btn-success" id="btnApprove" style="width:100%">Aprobar y generar PDF</button>
      </div>
    ` : '')}
    <div id="msg"></div>
  `;

  const btnConvencional = document.getElementById('btnConvencional');
  const btnDireccionable = document.getElementById('btnDireccionable');
  const setTecnologia = async (tecnologia) => {
    await fetch(`/api/opportunities/${oppId}/tecnologia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tecnologia }),
    });
    load();
  };
  if (btnConvencional) btnConvencional.addEventListener('click', () => setTecnologia('Convencional'));
  if (btnDireccionable) btnDireccionable.addEventListener('click', () => setTecnologia('Direccionable'));

  const btnSyncDocs = document.getElementById('btnSyncDocs');
  const syncDocsMsg = document.getElementById('syncDocsMsg');
  if (btnSyncDocs) btnSyncDocs.addEventListener('click', async () => {
    syncDocsMsg.textContent = 'Buscando documentos en PanamaCompra y subiéndolos a Dropbox… esto corre en segundo plano, puedes volver a pulsar el botón en unos segundos para ver el resultado.';
    await fetch(`/api/opportunities/${oppId}/sync-documentos`, { method: 'POST' });
  });

  const fileInput = document.getElementById('fileInput');
  const btnUpload = document.getElementById('btnUpload');
  const uploadMsg = document.getElementById('uploadMsg');
  if (btnUpload) btnUpload.addEventListener('click', async () => {
    if (!fileInput.files.length) { uploadMsg.textContent = 'Selecciona un archivo primero.'; return; }
    uploadMsg.textContent = 'Subiendo y leyendo el Excel…';
    try {
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      const res = await fetch(`/api/opportunities/${oppId}/quote/upload`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { uploadMsg.textContent = '❌ ' + (data.error || 'Error al subir el archivo'); return; }
      uploadMsg.textContent = data.isKnownTemplate ? '✅ Excel leído correctamente.' : '⚠️ Archivo leído, pero no parece ser la plantilla generada por la app — revisa la vista previa.';
      load();
    } catch (err) {
      uploadMsg.textContent = '❌ Error al subir el archivo: ' + err.message + '. Intenta de nuevo.';
    }
  });

  const btnUnlock = document.getElementById('btnUnlock');
  if (btnUnlock) btnUnlock.addEventListener('click', async () => {
    if (!confirm('¿Modificar esta cotización? El PDF ya generado seguirá disponible para descargar hasta que apruebes de nuevo con los cambios.')) return;
    const msg = document.getElementById('msg');
    msg.textContent = 'Reabriendo cotización…';
    const res = await fetch(`/api/opportunities/${oppId}/quote/unlock`, { method: 'POST' });
    if (!res.ok) { msg.textContent = 'Error al reabrir la cotización'; return; }
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

function renderDocumentos(opp) {
  const documentos = Array.isArray(opp.documentos_pliego) ? opp.documentos_pliego : [];
  const lista = documentos.map(d => `
    <div style="padding:10px 0;border-bottom:1px solid var(--gray-100)">
      <p style="margin:0;font-size:.82rem;font-weight:700;color:var(--navy)">${escapeHtml(d.nombreOriginal)}</p>
      <p style="margin:2px 0 0;font-size:.75rem;color:var(--gray-400)">${escapeHtml(d.tipoArchivo || '')}${d.descripcion ? ' · ' + escapeHtml(d.descripcion) : ''}</p>
      ${d.textoExtraido ? `
        <details style="margin-top:6px">
          <summary style="font-size:.76rem;color:var(--blue);cursor:pointer">Ver texto extraído</summary>
          <pre style="white-space:pre-wrap;font-family:inherit;font-size:.74rem;color:var(--gray-600);background:var(--gray-50);padding:10px;border-radius:8px;margin-top:6px;max-height:280px;overflow-y:auto">${escapeHtml(d.textoExtraido)}</pre>
        </details>` : ''}
    </div>
  `).join('');

  return `
    <section>
      <h2>Documentos adjuntos</h2>
      <button type="button" class="btn btn-ghost" id="btnSyncDocs" style="width:100%;margin-bottom:10px">🔄 Buscar documentos adjuntos</button>
      <div id="syncDocsMsg" style="font-size:.78rem;color:var(--gray-600);margin-bottom:${documentos.length ? '10px' : '0'}"></div>
      ${documentos.length ? lista : (opp.documentos_synced_at ? '<p style="font-size:.8rem;color:var(--gray-400);margin:0">Este acto no trae documentos adjuntos en PanamaCompra.</p>' : '<p style="font-size:.8rem;color:var(--gray-400);margin:0">Aún no se han buscado los documentos adjuntos de este acto.</p>')}
    </section>
  `;
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

// Niveles estipulados de %G que ya se usan en el dropdown del Excel (1.0 a
// 1.5), expresados como porcentaje de ganancia sobre el costo (0% a 50%).
const TIERS_GANANCIA = [0, 10, 20, 30, 40, 50];

// Gasto Total = Costo de Distribuidor + ITBM (7%), por unidad, multiplicado
// por la cantidad — la misma fórmula de la columna "GASTO TOTAL" del Excel
// (F = 1.07*E, G = F*D), sumada para todos los ítems.
function computeProfitAnalysis(quote) {
  const items = quote.items || [];
  let gastoTotal = 0;
  for (const i of items) {
    const costoDistribuidor = Number(i.costoDistribuidor) || 0;
    const cantidad = Number(i.cantidad) || 0;
    gastoTotal += costoDistribuidor * 1.07 * cantidad;
  }
  const precioFinal = Number(quote.total) || 0;
  const ganancia = precioFinal - gastoTotal;
  const gananciaPct = gastoTotal > 0 ? (ganancia / gastoTotal) * 100 : 0;
  return { gastoTotal, precioFinal, ganancia, gananciaPct };
}

function renderProfitAnalysis(quote) {
  const { gastoTotal, precioFinal, ganancia, gananciaPct } = computeProfitAnalysis(quote);
  if (gastoTotal <= 0) return ''; // Excel sin "Costo de Distribuidor" cargado — nada que analizar todavía

  if (ganancia < 0) {
    return `
      <section>
        <h2>Análisis de rentabilidad</h2>
        <p style="font-size:.85rem;color:#c0392b;margin:0">
          ⚠️ El precio final (${money(precioFinal)}) es menor que el gasto total (${money(gastoTotal)}).
          Revisa el %G de cada ítem en el Excel antes de aprobar.
        </p>
      </section>
    `;
  }

  const gastoPctPrecio = precioFinal > 0 ? (gastoTotal / precioFinal) * 100 : 0;
  const gananciaPctPrecio = 100 - gastoPctPrecio;

  const tiers = TIERS_GANANCIA.map(pct => ({ pct, precioFinal: gastoTotal * (1 + pct / 100) }));
  const maxTierPrice = Math.max(...tiers.map(t => t.precioFinal), precioFinal, 1);

  return `
    <section>
      <h2>Análisis de rentabilidad</h2>

      <div class="stat-row">
        <div class="stat-tile">
          <div class="stat-label">Gasto total</div>
          <div class="stat-value">${money(gastoTotal)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Precio final</div>
          <div class="stat-value">${money(precioFinal)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Ganancia</div>
          <div class="stat-value stat-positive">${money(ganancia)}</div>
          <div class="stat-sub">${gananciaPct.toFixed(1)}% sobre el costo</div>
        </div>
      </div>

      <div class="comp-bar-wrap">
        <div class="comp-bar">
          <div class="comp-seg comp-gasto" style="flex:${gastoTotal} 0 0" title="Gasto total: ${money(gastoTotal)}">
            ${gastoPctPrecio >= 20 ? `<span>${gastoPctPrecio.toFixed(0)}%</span>` : ''}
          </div>
          <div class="comp-seg comp-ganancia" style="flex:${ganancia} 0 0" title="Ganancia: ${money(ganancia)}">
            ${gananciaPctPrecio >= 20 ? `<span>${gananciaPctPrecio.toFixed(0)}%</span>` : ''}
          </div>
        </div>
        <div class="comp-legend">
          <span class="legend-item"><i class="legend-dot" style="background:#1616e6"></i>Gasto total — ${money(gastoTotal)} (${gastoPctPrecio.toFixed(0)}%)</span>
          <span class="legend-item"><i class="legend-dot" style="background:#1fa971"></i>Ganancia — ${money(ganancia)} (${gananciaPctPrecio.toFixed(0)}%)</span>
        </div>
      </div>

      <h3 class="tier-title">Precio final por % de ganancia estipulado (sobre el mismo gasto total)</h3>
      <div class="tier-chart">
        ${tiers.map(t => `
          <div class="tier-col">
            <div class="tier-bar" style="height:${Math.max(4, (t.precioFinal / maxTierPrice) * 100)}%" title="${t.pct}% de ganancia → ${money(t.precioFinal)}">
              <span class="tier-value">${money(t.precioFinal)}</span>
            </div>
            <div class="tier-label">${t.pct}%</div>
          </div>
        `).join('')}
        <div class="tier-col tier-col-actual">
          <div class="tier-bar tier-bar-actual" style="height:${Math.max(4, (precioFinal / maxTierPrice) * 100)}%" title="Tu cotización actual: ${gananciaPct.toFixed(1)}% de ganancia → ${money(precioFinal)}">
            <span class="tier-value">${money(precioFinal)}</span>
          </div>
          <div class="tier-label">Actual<br>(${gananciaPct.toFixed(0)}%)</div>
        </div>
      </div>
    </section>
  `;
}

load();

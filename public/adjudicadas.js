function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) {
  if (n == null || n === '') return '-';
  return 'B/. ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Mismo link que shell.js pone en el menú lateral.
document.getElementById('linkPortal').href = PANAMACOMPRA_CM10K_ADJUDICADAS_URL;

const listEl = document.getElementById('list');
const filtroEl = document.getElementById('filtro');
let todas = [];

function dl(obj, claves) {
  const filas = claves
    .filter(([k]) => obj[k] != null && obj[k] !== '')
    .map(([k, label]) => `<dt>${escapeHtml(label || k)}</dt><dd>${escapeHtml(obj[k])}</dd>`)
    .join('');
  return filas ? `<dl>${filas}</dl>` : '<p class="sin-datos">Sin datos.</p>';
}

function docsHtml(docs) {
  if (!docs.length) return '<p class="sin-datos">No hay documentos.</p>';
  return `<ul class="docs">${docs.map(d => {
    const url = `/api/adjudicadas/documento?ruta=${encodeURIComponent(d.rutaCompleta)}&nombre=${encodeURIComponent(d.nombreOriginal)}`;
    return `<li><a href="${url}" target="_blank" rel="noopener">📄 ${escapeHtml(d.descripcion || d.nombreOriginal)}</a>
      <small>${escapeHtml(d.tipoArchivo)}${d.tipoArchivo ? ' · ' : ''}${escapeHtml(d.nombreOriginal)}</small></li>`;
  }).join('')}</ul>`;
}

function detalleHtml(d) {
  const propuestas = d.propuestas.map(p => `
    <p><b>${escapeHtml(p.empresa)}</b> · enviada ${fmtDateTime(p.fechaEnvio)}<br>
    Total ofertado: <span class="total">${money(p.total)}</span></p>
    <table>
      <thead><tr><th>Descripción</th><th>Precio</th><th>ITBMS</th><th>Total</th></tr></thead>
      <tbody>${p.items.map(i => `
        <tr><td><div class="desc">${escapeHtml(i.descripcion)}</div></td>
        <td class="num">${money(i.precio)}</td><td class="num">${money(i.itbms)}</td><td class="num">${money(i.precioTotal)}</td></tr>`).join('')}
      </tbody>
    </table>`).join('') || '<p class="sin-datos">PanamaCompra no devolvió la propuesta.</p>';

  const items = d.items.length ? `
    <table>
      <thead><tr><th>Ítem solicitado</th><th>Precio ref.</th><th>Adjudicado</th><th>ITBMS</th></tr></thead>
      <tbody>${d.items.map(i => `
        <tr><td><div class="desc">${escapeHtml(i.descripcion)}</div>${i.cantidad ? `<small>${escapeHtml(i.cantidad)} ${escapeHtml(i.unidad || '')}</small>` : ''}</td>
        <td class="num">${money(i.precioReferencia)}</td><td class="num">${money(i.precio)}</td><td class="num">${money(i.itbms)}</td></tr>`).join('')}
      </tbody>
    </table>` : '<p class="sin-datos">Sin ítems.</p>';

  const motivo = d.motivo.length
    ? d.motivo.map(m => `<p><b>${escapeHtml(m.empresa)}</b> — ${m.adjudicado ? '✅ Adjudicado' : 'No adjudicado'} · ${m.cumple ? 'Cumple' : 'No cumple'} · ${money(m.precioTotal)}${m.observacion ? `<br><i>${escapeHtml(m.observacion)}</i>` : ''}</p>`).join('')
    : '<p class="sin-datos">Sin motivo publicado.</p>';

  return `
    <h3>Entidad</h3>
    ${dl(d.entidad, [['Entidad'], ['Dependencia'], ['Unidad de Compra'], ['Provincia'], ['Dirección de la unidad de compra', 'Dirección']])}
    <h3>Contacto de la unidad de compra</h3>
    ${dl(d.contacto, [['Nombre'], ['Cargo'], ['Teléfono'], ['Correo electrónico', 'Correo']])}
    <h3>Condiciones</h3>
    ${dl({ ...d.proceso, ...d.condiciones, ...d.general }, [['Fecha de Publicación', 'Publicado'], ['Monto de la contratación', 'Monto'], ['Partida Presupuestaria', 'Partida'], ['Modalidad de adjudicación', 'Modalidad'], ['Objeto de Contratación', 'Objeto'], ['Forma de entrega'], ['Término de entrega'], ['Forma de pago']])}
    ${d.procesoOriginal ? `<p class="sin-datos">Proceso original: ${escapeHtml(d.procesoOriginal.tipo)} ${escapeHtml(d.procesoOriginal.numProceso)}</p>` : ''}
    <h3>Motivo de adjudicación</h3>
    ${motivo}
    <h3>Propuesta enviada</h3>
    ${propuestas}
    <h3>Ítems del acto</h3>
    ${items}
    <h3>Documentos de la propuesta (${d.documentosPropuesta.length})</h3>
    ${docsHtml(d.documentosPropuesta)}
    <h3>Documentos del pliego (${d.documentosPliego.length})</h3>
    ${docsHtml(d.documentosPliego)}
    ${d.actas.length ? `<h3>Actas del acto público</h3><ul class="docs">${d.actas.map(a => `<li>${escapeHtml(a.nombre)}<small>${escapeHtml(a.fecha)}</small></li>`).join('')}</ul>` : ''}
  `;
}

function card(op) {
  const div = document.createElement('div');
  div.className = 'card participar';
  div.innerHTML = `
    <span class="badge info">${escapeHtml(op.estado || 'Adjudicado')}</span>
    <div class="title">${escapeHtml(op.titulo)}</div>
    <div class="meta"><b>${escapeHtml(op.numProceso)}</b><br>${escapeHtml(op.objeto)} · Adjudicado: ${fmtDate(op.fechaEstado)}</div>
    <button type="button" class="btn btn-ver">Ver propuesta y documentos ▾</button>
    <div class="det" style="display:none"></div>
  `;
  const btn = div.querySelector('.btn-ver');
  const wrap = div.querySelector('.det');
  let loaded = false;
  btn.addEventListener('click', async () => {
    if (wrap.style.display !== 'none') { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    if (loaded) return;
    wrap.innerHTML = '<p class="sin-datos">Consultando PanamaCompra…</p>';
    try {
      const res = await fetch(`/api/adjudicadas/${op.idProcesosContratacionFlujos}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error consultando el detalle');
      wrap.innerHTML = detalleHtml(data);
      loaded = true;
    } catch (err) {
      wrap.innerHTML = `<p class="sin-datos">❌ ${escapeHtml(err.message)}</p>`;
    }
  });
  return div;
}

function render() {
  const q = filtroEl.value.trim().toLowerCase();
  const visibles = q ? todas.filter(op => `${op.numProceso} ${op.titulo}`.toLowerCase().includes(q)) : todas;
  listEl.innerHTML = '';
  if (!visibles.length) {
    listEl.innerHTML = `<div class="empty">${q ? 'Ninguna coincide con el filtro.' : 'No hay compras menores adjudicadas donde hayas participado.'}</div>`;
    return;
  }
  visibles.forEach(op => listEl.appendChild(card(op)));
}

async function loadList() {
  try {
    const res = await fetch('/api/adjudicadas');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error cargando las adjudicadas');
    todas = data;
    document.getElementById('resumen').textContent = `${todas.length} compra(s) menor(es) adjudicada(s)`;
    render();
  } catch (err) {
    listEl.innerHTML = `<div class="empty">❌ ${escapeHtml(err.message)}</div>`;
  }
}

filtroEl.addEventListener('input', render);
loadList();

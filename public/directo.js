function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(d) {
  return new Date(d).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const formSection = document.getElementById('formSection');
const btnNueva = document.getElementById('btnNueva');
const categoriaSelect = document.getElementById('categoria');
const itemsWrap = document.getElementById('items');
const btnAddItem = document.getElementById('btnAddItem');
const btnCrear = document.getElementById('btnCrear');
const msg = document.getElementById('msg');
const listEl = document.getElementById('list');

// Sugiere ítems del catálogo mientras se escribe la descripción, para que el
// usuario elija algo que YA tiene precio cargado en vez de escribir texto
// libre que después no encuentra coincidencia al generar el Excel. Solo
// dentro de la categoría que se está cotizando (nunca de otra categoría), y
// sin mostrar el costo de distribuidor — es un dato interno, no el precio
// final, y esta pantalla puede estar a la vista del cliente.
async function fetchSuggestions(q, suggList, descInput) {
  const categoria = categoriaSelect.value;
  const items = await fetch(`/api/catalog?categoria=${encodeURIComponent(categoria)}&search=${encodeURIComponent(q)}`).then(r => r.json());
  if (!items.length) { suggList.innerHTML = ''; suggList.style.display = 'none'; return; }
  suggList.innerHTML = items.slice(0, 6).map(it => `
    <div class="sugg-item" data-desc="${escapeHtml(it.descripcion)}">
      <span class="sugg-desc">${escapeHtml(it.descripcion)}</span>
    </div>
  `).join('');
  suggList.style.display = 'block';
  suggList.querySelectorAll('.sugg-item').forEach(el => {
    // mousedown (no click) para que dispare ANTES del blur del input
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      descInput.value = el.dataset.desc;
      suggList.style.display = 'none';
    });
  });
}

function addItemRow(valoresIniciales) {
  const row = document.createElement('div');
  row.className = 'item-row';
  const descInicial = valoresIniciales ? escapeHtml(valoresIniciales.descripcion || '') : '';
  const cantInicial = valoresIniciales ? (Number(valoresIniciales.cantidad) || 1) : 1;
  row.innerHTML = `
    <div class="desc-wrap">
      <input type="text" class="item-desc" placeholder="Descripción del ítem" autocomplete="off" value="${descInicial}">
      <div class="sugg-list"></div>
    </div>
    <input type="number" class="item-cant" placeholder="Cant." min="1" value="${cantInicial}">
    <button type="button" class="rm">×</button>
  `;
  row.querySelector('.rm').addEventListener('click', () => {
    if (itemsWrap.children.length > 1) row.remove();
  });

  const descInput = row.querySelector('.item-desc');
  const suggList = row.querySelector('.sugg-list');
  let debounceTimer;
  descInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = descInput.value.trim();
    if (q.length < 2) { suggList.innerHTML = ''; suggList.style.display = 'none'; return; }
    debounceTimer = setTimeout(() => fetchSuggestions(q, suggList, descInput), 250);
  });
  descInput.addEventListener('focus', () => {
    if (suggList.innerHTML) suggList.style.display = 'block';
  });
  descInput.addEventListener('blur', () => {
    setTimeout(() => { suggList.style.display = 'none'; }, 150);
  });

  itemsWrap.appendChild(row);
}

btnAddItem.addEventListener('click', () => addItemRow());

const excelItemsInput = document.getElementById('excelItemsInput');
const btnImportarExcel = document.getElementById('btnImportarExcel');
const importMsg = document.getElementById('importMsg');
btnImportarExcel.addEventListener('click', async () => {
  if (!excelItemsInput.files.length) { importMsg.textContent = 'Elige un archivo .xlsx primero.'; return; }
  importMsg.textContent = 'Leyendo el Excel…';
  btnImportarExcel.disabled = true;
  try {
    const fd = new FormData();
    fd.append('file', excelItemsInput.files[0]);
    const res = await fetch('/api/opportunities/directo/importar-excel', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { importMsg.textContent = '❌ ' + (data.error || 'No se pudo leer el archivo.'); return; }
    // Reemplaza los renglones actuales por los del Excel -- el usuario los
    // sigue viendo y puede editarlos/borrarlos/agregar más antes de crear.
    itemsWrap.innerHTML = '';
    data.items.forEach((item) => addItemRow(item));
    importMsg.textContent = `✅ Se cargaron ${data.items.length} ítem(s) — revísalos y ajusta lo que haga falta antes de crear.`;
  } catch (err) {
    importMsg.textContent = '❌ Error al leer el archivo: ' + err.message;
  } finally {
    btnImportarExcel.disabled = false;
  }
});

btnNueva.addEventListener('click', (e) => {
  e.preventDefault();
  const visible = formSection.style.display !== 'none';
  formSection.style.display = visible ? 'none' : 'block';
  if (!visible && !itemsWrap.children.length) addItemRow();
});

btnCrear.addEventListener('click', async () => {
  const titulo = document.getElementById('titulo').value.trim();
  const categoria = categoriaSelect.value;
  const items = [...itemsWrap.querySelectorAll('.item-row')]
    .map(row => ({
      descripcion: row.querySelector('.item-desc').value.trim(),
      cantidad: Number(row.querySelector('.item-cant').value) || 1,
    }))
    .filter(i => i.descripcion);

  if (!titulo) { msg.textContent = 'Escribe el cliente o título del proyecto.'; return; }
  if (!items.length) { msg.textContent = 'Agrega al menos un ítem con descripción.'; return; }

  msg.textContent = 'Creando…';
  const res = await fetch('/api/opportunities/directo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titulo, categoria, items }),
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = '❌ ' + (data.error || 'Error al crear la cotización'); return; }
  location.href = `/quote.html?id=${data.id}`;
});

async function deleteOpportunity(id, div) {
  if (!confirm('¿Borrar esta cotización directa? Esta acción no se puede deshacer.')) return;
  const res = await fetch(`/api/opportunities/${id}`, { method: 'DELETE' });
  if (!res.ok) { alert('No se pudo borrar.'); return; }
  div.remove();
  if (!listEl.children.length) loadList();
}

function card(op) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <span class="badge info">${escapeHtml(op.category || 'Sin categoría')}</span>
      <button type="button" class="rm" title="Borrar" style="width:32px;height:32px;flex:none">🗑</button>
    </div>
    <div class="title">${escapeHtml(op.title)}</div>
    <div class="meta">Creada el ${fmtDate(op.created_at)}</div>
    <a class="quote-link" href="/quote.html?id=${op.id}">Armar cotización →</a>
  `;
  div.querySelector('.rm').addEventListener('click', () => deleteOpportunity(op.id, div));
  return div;
}

async function loadCategorias() {
  const cats = await fetch('/api/catalog/categorias').then(r => r.json());
  categoriaSelect.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

async function loadList() {
  const res = await fetch('/api/opportunities?source=directo');
  const items = await res.json();
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = '<div class="empty">Aún no has creado ninguna cotización directa.<br>Toca "＋" arriba para empezar.</div>';
    return;
  }
  items.forEach(op => listEl.appendChild(card(op)));
}

loadCategorias();
loadList();

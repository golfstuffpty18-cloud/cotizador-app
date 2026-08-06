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
// libre que después no encuentra coincidencia al generar el Excel.
async function fetchSuggestions(q, suggList, descInput) {
  const categoria = categoriaSelect.value;
  let items = await fetch(`/api/catalog?categoria=${encodeURIComponent(categoria)}&search=${encodeURIComponent(q)}`).then(r => r.json());
  let otraCategoria = false;
  if (!items.length) {
    // Nada en esta categoría — buscar en todo el catálogo (ej. un "switch POE"
    // puede estar cargado bajo Control de Acceso y servir igual para CCTV).
    items = await fetch(`/api/catalog?search=${encodeURIComponent(q)}`).then(r => r.json());
    otraCategoria = true;
  }
  if (!items.length) { suggList.innerHTML = ''; suggList.style.display = 'none'; return; }
  suggList.innerHTML = items.slice(0, 6).map(it => `
    <div class="sugg-item" data-desc="${escapeHtml(it.descripcion)}">
      <span class="sugg-desc">${escapeHtml(it.descripcion)}${otraCategoria ? ` <i style="color:var(--gray-400);font-style:normal">(${escapeHtml(it.categoria || 'otra categoría')})</i>` : ''}</span>
      <span class="sugg-price">${it.costo_distribuidor != null ? 'B/. ' + Number(it.costo_distribuidor).toFixed(2) : 'sin costo'}</span>
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

function addItemRow() {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <div class="desc-wrap">
      <input type="text" class="item-desc" placeholder="Descripción del ítem" autocomplete="off">
      <div class="sugg-list"></div>
    </div>
    <input type="number" class="item-cant" placeholder="Cant." min="1" value="1">
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

btnAddItem.addEventListener('click', addItemRow);

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
      <span class="badge">${escapeHtml(op.category || 'Sin categoría')}</span>
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

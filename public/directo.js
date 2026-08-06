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

function addItemRow() {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input type="text" class="item-desc" placeholder="Descripción del ítem">
    <input type="number" class="item-cant" placeholder="Cant." min="1" value="1">
    <button type="button" class="rm">×</button>
  `;
  row.querySelector('.rm').addEventListener('click', () => {
    if (itemsWrap.children.length > 1) row.remove();
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

function card(op) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <span class="badge">${escapeHtml(op.category || 'Sin categoría')}</span>
    <div class="title">${escapeHtml(op.title)}</div>
    <div class="meta">Creada el ${fmtDate(op.created_at)}</div>
    <a class="quote-link" href="/quote.html?id=${op.id}">Armar cotización →</a>
  `;
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

const app = document.getElementById('app');
let categorias = [];
let editingId = null;

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) {
  return n == null ? '-' : 'B/. ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function init() {
  categorias = await fetch('/api/catalog/categorias').then(r => r.json());
  render();
  loadItems();
}

function render() {
  app.innerHTML = `
    <section>
      <h2 id="formTitle">Agregar ítem</h2>
      <form id="form">
        <label>Descripción</label>
        <textarea id="f_descripcion" rows="2" required></textarea>
        <div class="row2">
          <div>
            <label>Categoría</label>
            <select id="f_categoria">
              <option value="">-- Sin categoría --</option>
              ${categorias.map(c => `<option>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Proveedor</label>
            <input id="f_proveedor">
          </div>
        </div>
        <div class="row3">
          <div>
            <label>Marca</label>
            <input id="f_marca">
          </div>
          <div>
            <label>Modelo</label>
            <input id="f_modelo">
          </div>
          <div>
            <label>%G</label>
            <input id="f_margen_g" type="number" step="0.1" min="1" max="1.5">
          </div>
        </div>
        <label>Costo de distribuidor (B/.)</label>
        <input id="f_costo" type="number" step="0.01" min="0">
        <label>Notas (opcional)</label>
        <input id="f_notas">
        <div style="display:flex;gap:10px;margin-top:6px">
          <button type="submit" class="btn btn-primary">Guardar</button>
          <button type="button" class="btn btn-ghost" id="btnCancel" style="display:none">Cancelar</button>
        </div>
      </form>
    </section>

    <section>
      <h2>Buscar en el catálogo</h2>
      <div class="filters">
        <input id="search" placeholder="Buscar por descripción…" style="flex:2">
        <select id="filterCategoria" style="flex:1">
          <option value="">Todas las categorías</option>
          ${categorias.map(c => `<option>${c}</option>`).join('')}
        </select>
      </div>
      <div id="list">Cargando…</div>
    </section>
  `;

  document.getElementById('form').addEventListener('submit', onSubmit);
  document.getElementById('btnCancel').addEventListener('click', resetForm);
  document.getElementById('search').addEventListener('input', debounce(loadItems, 300));
  document.getElementById('filterCategoria').addEventListener('change', loadItems);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function loadItems() {
  const search = document.getElementById('search').value;
  const categoria = document.getElementById('filterCategoria').value;
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (categoria) qs.set('categoria', categoria);

  const items = await fetch('/api/catalog?' + qs.toString()).then(r => r.json());
  const list = document.getElementById('list');
  if (!items.length) { list.innerHTML = '<div class="empty">Sin ítems todavía. Se van agregando solos cada vez que apruebas una cotización, o agrégalos aquí manualmente.</div>'; return; }

  list.innerHTML = items.map(i => `
    <div class="catalog-item">
      ${i.categoria ? `<span class="badge-cat">${escapeHtml(i.categoria)}</span>` : ''}
      <div class="desc">${escapeHtml(i.descripcion)}</div>
      <div class="meta">${[i.marca, i.modelo].filter(Boolean).map(escapeHtml).join(' · ') || 'Sin marca/modelo'} ${i.proveedor ? '· Proveedor: ' + escapeHtml(i.proveedor) : ''}</div>
      <div class="price">${money(i.costo_distribuidor)} ${i.margen_g ? ' · %G: ' + i.margen_g : ''}</div>
      <div class="actions">
        <button class="btn-danger" data-edit="${i.id}" style="background:var(--gray-100);color:var(--navy);margin-right:6px">Editar</button>
        <button class="btn-danger" data-del="${i.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => editItem(items.find(i => i.id == btn.dataset.edit))));
  list.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => deleteItem(btn.dataset.del)));
}

function editItem(item) {
  editingId = item.id;
  document.getElementById('formTitle').textContent = 'Editar ítem';
  document.getElementById('f_descripcion').value = item.descripcion || '';
  document.getElementById('f_categoria').value = item.categoria || '';
  document.getElementById('f_proveedor').value = item.proveedor || '';
  document.getElementById('f_marca').value = item.marca || '';
  document.getElementById('f_modelo').value = item.modelo || '';
  document.getElementById('f_margen_g').value = item.margen_g || '';
  document.getElementById('f_costo').value = item.costo_distribuidor || '';
  document.getElementById('f_notas').value = item.notas || '';
  document.getElementById('btnCancel').style.display = 'inline-block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  editingId = null;
  document.getElementById('formTitle').textContent = 'Agregar ítem';
  document.getElementById('form').reset();
  document.getElementById('btnCancel').style.display = 'none';
}

async function onSubmit(e) {
  e.preventDefault();
  const body = {
    descripcion: document.getElementById('f_descripcion').value,
    categoria: document.getElementById('f_categoria').value,
    proveedor: document.getElementById('f_proveedor').value,
    marca: document.getElementById('f_marca').value,
    modelo: document.getElementById('f_modelo').value,
    margen_g: parseFloat(document.getElementById('f_margen_g').value) || null,
    costo_distribuidor: parseFloat(document.getElementById('f_costo').value) || null,
    notas: document.getElementById('f_notas').value,
  };
  const url = editingId ? `/api/catalog/${editingId}` : '/api/catalog';
  const method = editingId ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  resetForm();
  loadItems();
}

async function deleteItem(id) {
  if (!confirm('¿Eliminar este ítem del catálogo?')) return;
  await fetch(`/api/catalog/${id}`, { method: 'DELETE' });
  loadItems();
}

init();

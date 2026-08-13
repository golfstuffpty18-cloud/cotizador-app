// Estado de la factura recién extraída (o en edición) mientras el usuario
// revisa/corrige el formulario antes de confirmar el guardado.
let pending = null; // { archivo_nombre, archivo_tipo, archivo_base64, datos_extraidos } | null
let editingId = null; // id de la factura en edición, o null si es una nueva

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('es-PA', { style: 'currency', currency: 'USD' });
}

function updateTipoToggleClasses() {
  const gasto = document.querySelector('input[name="tipoNueva"][value="gasto"]');
  $('labelGasto').classList.toggle('active-gasto', gasto.checked);
  $('labelEmitida').classList.toggle('active-emitida', !gasto.checked);
}

document.querySelectorAll('input[name="tipoNueva"]').forEach((r) => r.addEventListener('change', updateTipoToggleClasses));

function resetForm() {
  $('reviewForm').classList.remove('show');
  $('reviewForm').reset();
  $('fileInput').value = '';
  $('extraccionEstado').innerHTML = '';
  pending = null;
  editingId = null;
  $('guardarBtn').textContent = 'Guardar factura';
}

function fillForm(data) {
  $('fContraparte').value = data.contraparte || '';
  $('fRuc').value = data.ruc || '';
  $('fNumero').value = data.numero_factura || '';
  $('fFecha').value = data.fecha || new Date().toISOString().slice(0, 10);
  $('fSubtotal').value = data.subtotal != null ? data.subtotal : '';
  $('fItbm').value = data.itbm != null ? data.itbm : '';
  $('fTotal').value = data.total != null ? data.total : '';
  $('fProyecto').value = data.proyecto || '';
  $('fNotas').value = data.notas || '';
  $('reviewForm').classList.add('show');
}

$('fileInput').addEventListener('change', async () => {
  const file = $('fileInput').files[0];
  if (!file) return;

  $('extraccionEstado').innerHTML = '<div class="spinner">🔎 Leyendo la factura con Claude Vision…</div>';
  $('reviewForm').classList.remove('show');

  const fd = new FormData();
  fd.append('file', file);

  let data;
  try {
    const res = await fetch('/api/finanzas/extraer', { method: 'POST', body: fd });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'no se pudo leer la factura');
  } catch (err) {
    $('extraccionEstado').innerHTML = `<div class="error-msg">⚠️ ${err.message}. Puedes llenar los datos manualmente.</div>`;
    pending = { archivo_nombre: file.name, archivo_tipo: file.type, archivo_base64: null, datos_extraidos: null };
    editingId = null;
    fillForm({});
    return;
  }

  $('extraccionEstado').innerHTML = '<div class="aviso-baja">✅ Datos extraídos — revisa y corrige antes de guardar.</div>';
  pending = {
    archivo_nombre: data.archivo_nombre,
    archivo_tipo: data.archivo_tipo,
    archivo_base64: data.archivo_base64,
    datos_extraidos: data.extraido,
  };
  editingId = null;
  fillForm(data.extraido);
});

$('cancelarBtn').addEventListener('click', resetForm);

$('reviewForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = document.querySelector('input[name="tipoNueva"]:checked').value;
  const payload = {
    tipo,
    contraparte: $('fContraparte').value.trim(),
    ruc: $('fRuc').value.trim() || null,
    numero_factura: $('fNumero').value.trim() || null,
    fecha: $('fFecha').value || null,
    subtotal: $('fSubtotal').value !== '' ? Number($('fSubtotal').value) : null,
    itbm: $('fItbm').value !== '' ? Number($('fItbm').value) : null,
    total: Number($('fTotal').value),
    proyecto: $('fProyecto').value.trim() || null,
    notas: $('fNotas').value.trim() || null,
  };

  $('guardarBtn').disabled = true;
  $('guardarBtn').textContent = 'Guardando…';
  try {
    let res;
    if (editingId) {
      res = await fetch(`/api/finanzas/${editingId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    } else {
      Object.assign(payload, {
        archivo_nombre: pending ? pending.archivo_nombre : null,
        archivo_tipo: pending ? pending.archivo_tipo : null,
        archivo_base64: pending ? pending.archivo_base64 : null,
        datos_extraidos: pending ? pending.datos_extraidos : null,
      });
      res = await fetch('/api/finanzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'no se pudo guardar');
    resetForm();
    await Promise.all([loadResumen(), loadFacturas(), loadProyectos()]);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    $('guardarBtn').disabled = false;
    $('guardarBtn').textContent = 'Guardar factura';
  }
});

async function editarFactura(id) {
  const res = await fetch(`/api/finanzas/${id}`);
  const data = await res.json();
  if (!res.ok) return alert('Error: ' + (data.error || 'no encontrado'));

  editingId = id;
  pending = null;
  document.querySelector(`input[name="tipoNueva"][value="${data.tipo}"]`).checked = true;
  updateTipoToggleClasses();
  $('extraccionEstado').innerHTML = '<div class="aviso-baja">✏️ Editando factura existente — el archivo original no cambia.</div>';
  fillForm(data);
  $('guardarBtn').textContent = 'Guardar cambios';
  $('reviewForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function eliminarFactura(id) {
  if (!confirm('¿Eliminar esta factura? Esta acción no se puede deshacer.')) return;
  const res = await fetch(`/api/finanzas/${id}`, { method: 'DELETE' });
  if (!res.ok) return alert('No se pudo eliminar');
  await Promise.all([loadResumen(), loadFacturas(), loadProyectos()]);
}

function toggleProyectosTabla() {
  $('proyectosTabla').classList.toggle('show');
}

async function loadResumen() {
  const anio = $('filtroAnio').value || new Date().getFullYear();
  const res = await fetch(`/api/finanzas/resumen?anio=${encodeURIComponent(anio)}`);
  const data = await res.json();
  if (!res.ok) { $('resumenBody').innerHTML = `<div class="error-msg">${data.error}</div>`; return; }

  const filas = data.por_proyecto.map((p) => `
    <div class="proyecto-row">
      <span class="nombre">${escapeHtml(p.proyecto)}</span>
      <span class="cifras">${money(p.ganancia)} <span style="color:var(--gray-400)">(${money(p.emitida)} - ${money(p.gasto)})</span></span>
    </div>
  `).join('') || '<div class="empty">Sin facturas asociadas a proyectos todavía.</div>';

  $('resumenBody').innerHTML = `
    <div class="resumen-grid">
      <div class="resumen-box emitido"><div class="label">Emitido ${data.anio}</div><div class="valor">${money(data.total_emitido)}</div></div>
      <div class="resumen-box gastos"><div class="label">Gastos ${data.anio}</div><div class="valor">${money(data.total_gastos)}</div></div>
      <div class="resumen-box ganancia"><div class="label">Ganancia</div><div class="valor">${money(data.ganancia)}</div></div>
    </div>
    <div class="proyectos-toggle" onclick="toggleProyectosTabla()">Ver ganancia por proyecto ▾</div>
    <div id="proyectosTabla">${filas}</div>
  `;
}

async function loadProyectos() {
  const res = await fetch('/api/finanzas/proyectos');
  const proyectos = await res.json();
  $('proyectosList').innerHTML = proyectos.map((p) => `<option value="${escapeHtml(p)}">`).join('');
  const sel = $('filtroProyecto');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos los proyectos</option>' + proyectos.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  sel.value = current;
}

function populateAnioFilter() {
  const sel = $('filtroAnio');
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current; y >= current - 4; y--) years.push(y);
  sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  sel.value = current;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function facturaCard(f) {
  const badge = f.tipo === 'gasto' ? '💸 Gasto' : '🧾 Emitida';
  const fecha = f.fecha ? new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-PA') : 'sin fecha';
  return `
    <div class="factura-item ${f.tipo}">
      <div class="top">
        <span class="contraparte">${escapeHtml(f.contraparte) || '(sin nombre)'}</span>
        <span class="total">${money(f.total)}</span>
      </div>
      <div class="meta">${badge} · ${fecha}${f.numero_factura ? ' · #' + escapeHtml(f.numero_factura) : ''}</div>
      ${f.proyecto ? `<span class="proyecto-tag">${escapeHtml(f.proyecto)}</span>` : ''}
      <div class="actions">
        ${f.archivo_nombre ? `<a href="/api/finanzas/${f.id}/archivo" target="_blank">Ver archivo</a>` : ''}
        <button onclick="editarFactura(${f.id})">Editar</button>
        <button onclick="eliminarFactura(${f.id})" style="color:var(--red)">Eliminar</button>
      </div>
    </div>
  `;
}

async function loadFacturas() {
  const params = new URLSearchParams();
  if ($('filtroTipo').value) params.set('tipo', $('filtroTipo').value);
  if ($('filtroProyecto').value) params.set('proyecto', $('filtroProyecto').value);

  $('listaFacturas').innerHTML = '<div class="spinner">Cargando…</div>';
  const res = await fetch(`/api/finanzas?${params.toString()}`);
  const facturas = await res.json();
  if (!res.ok) { $('listaFacturas').innerHTML = `<div class="error-msg">${facturas.error}</div>`; return; }

  if (!facturas.length) {
    $('listaFacturas').innerHTML = '<div class="empty">Todavía no hay facturas guardadas.</div>';
    return;
  }

  const grupos = new Map(); // "2026-08" -> facturas[]  |  "sin-fecha" -> facturas[]
  for (const f of facturas) {
    const key = f.fecha ? f.fecha.slice(0, 7) : 'sin-fecha';
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(f);
  }

  let html = '';
  for (const [key, items] of grupos) {
    const label = key === 'sin-fecha' ? 'Sin fecha' : `${MESES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
    html += `<div class="mes-header">${label}</div>` + items.map(facturaCard).join('');
  }
  $('listaFacturas').innerHTML = html;
}

$('filtroTipo').addEventListener('change', loadFacturas);
$('filtroProyecto').addEventListener('change', loadFacturas);
$('filtroAnio').addEventListener('change', loadResumen);

populateAnioFilter();
updateTipoToggleClasses();
loadResumen();
loadProyectos();
loadFacturas();

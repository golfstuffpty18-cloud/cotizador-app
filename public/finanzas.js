// Estado de la factura recién extraída (o en edición) mientras el usuario
// revisa/corrige el formulario antes de confirmar el guardado.
let pending = null; // { archivo_nombre, archivo_tipo, archivo_base64, datos_extraidos } | null
let editingId = null; // id de la factura en edición, o null si es una nueva

// Carga en grupo: cuando se seleccionan varios archivos a la vez, se
// procesan uno por uno (extracción + revisión + guardado) en vez de todos de
// golpe, reutilizando el mismo formulario — así el usuario sigue revisando
// cada una antes de guardarla, solo que sin tener que tocar "elegir archivo"
// entre cada una.
let fileQueue = [];
let queueTotal = 0;
let queuePosition = 0;

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
  fileQueue = [];
  queueTotal = 0;
  queuePosition = 0;
  $('guardarBtn').textContent = 'Guardar factura';
}

function fillForm(data) {
  $('fContraparte').value = data.contraparte || '';
  $('fContraparte').classList.remove('needs-review');
  $('fRuc').value = data.ruc || '';
  $('fDireccion').value = data.direccion || '';
  $('fTelefono').value = data.telefono || '';
  $('fCorreo').value = data.correo || '';
  $('fNumero').value = data.numero_factura || '';
  // Ojo: NO se rellena con la fecha de hoy cuando Claude no pudo leerla — si
  // se rellenara sola con "hoy" el usuario podría no notarlo y guardar una
  // factura vieja bajo el mes equivocado. Mejor dejarla vacía y avisar (ver
  // el chequeo en el handler de fileInput más abajo) para que quede claro
  // que hay que ponerla a mano.
  $('fFecha').value = data.fecha || '';
  $('fFecha').classList.remove('needs-review');
  $('fSubtotal').value = data.subtotal != null ? data.subtotal : '';
  $('fItbm').value = data.itbm != null ? data.itbm : '';
  $('fTotal').value = data.total != null ? data.total : '';
  $('fProyecto').value = data.proyecto || '';
  $('fNotas').value = data.notas || '';
  $('reviewForm').classList.add('show');
}

function prefijoCola() {
  return queueTotal > 1 ? `Factura ${queuePosition} de ${queueTotal} — ` : '';
}

async function procesarArchivo(file) {
  $('extraccionEstado').innerHTML = `<div class="spinner">🔎 ${prefijoCola()}Leyendo la factura con Claude Vision…</div>`;
  $('reviewForm').classList.remove('show');

  const fd = new FormData();
  fd.append('file', file);

  let data;
  try {
    const res = await fetch('/api/finanzas/extraer', { method: 'POST', body: fd });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'no se pudo leer la factura');
  } catch (err) {
    $('extraccionEstado').innerHTML = `<div class="error-msg">⚠️ ${prefijoCola()}${err.message}. Puedes llenar los datos manualmente.</div>`;
    pending = { archivo_nombre: file.name, archivo_tipo: file.type, archivo_base64: null, datos_extraidos: null };
    editingId = null;
    fillForm({});
    return;
  }

  let mensaje = `<div class="aviso-baja">${prefijoCola()}✅ Datos extraídos — revisa y corrige antes de guardar.</div>`;
  if (!data.extraido.fecha) {
    mensaje += '<div class="error-msg">⚠️ No se pudo leer la fecha en la foto — escríbela tú abajo, si no la factura queda como "Sin fecha" y no se va a agrupar en su mes.</div>';
  }
  if (!data.extraido.contraparte) {
    mensaje += '<div class="error-msg">⚠️ No se pudo identificar con certeza el proveedor/cliente (para evitar confundirlo con GS Technologies) — escríbelo tú abajo.</div>';
  }
  $('extraccionEstado').innerHTML = mensaje;
  pending = {
    archivo_nombre: data.archivo_nombre,
    archivo_tipo: data.archivo_tipo,
    archivo_base64: data.archivo_base64,
    datos_extraidos: data.extraido,
  };
  editingId = null;
  fillForm(data.extraido);
  if (!data.extraido.fecha) $('fFecha').classList.add('needs-review');
  if (!data.extraido.contraparte) $('fContraparte').classList.add('needs-review');
}

// Avanza al siguiente archivo de la cola (tras guardar uno, o al saltarlo
// con "Cancelar"); si ya no queda ninguno, vuelve al estado vacío normal.
function siguienteEnCola() {
  if (fileQueue.length === 0) {
    resetForm();
    return;
  }
  queuePosition++;
  const file = fileQueue.shift();
  procesarArchivo(file);
}

$('fileInput').addEventListener('change', () => {
  const files = Array.from($('fileInput').files || []);
  if (!files.length) return;
  fileQueue = files;
  queueTotal = files.length;
  queuePosition = 0;
  siguienteEnCola();
});

// Gastos sin factura (propina, pago informal, algo que nunca dio recibo...)
// que igual hay que dejar registrado para la declaración de renta a fin de
// año — mismo formulario, pero sin pasar por la extracción de Claude Vision.
$('manualBtn').addEventListener('click', () => {
  document.querySelector('input[name="tipoNueva"][value="gasto"]').checked = true;
  updateTipoToggleClasses();
  pending = null;
  editingId = null;
  fileQueue = []; // un gasto manual interrumpe cualquier lote de fotos en curso
  queueTotal = 0;
  queuePosition = 0;
  $('fileInput').value = '';
  $('extraccionEstado').innerHTML = '<div class="aviso-baja">✏️ Gasto manual sin factura — llena los datos y guarda.</div>';
  fillForm({});
  $('fFecha').value = new Date().toISOString().slice(0, 10); // conveniencia: un gasto manual normalmente se registra el mismo día
  $('reviewForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Si hay más facturas en cola (carga en grupo), "Cancelar" salta la actual y
// sigue con la próxima en vez de cerrar todo el formulario.
$('cancelarBtn').addEventListener('click', () => {
  if (fileQueue.length > 0) siguienteEnCola();
  else resetForm();
});

$('reviewForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = document.querySelector('input[name="tipoNueva"]:checked').value;
  const payload = {
    tipo,
    contraparte: $('fContraparte').value.trim(),
    ruc: $('fRuc').value.trim() || null,
    direccion: $('fDireccion').value.trim() || null,
    telefono: $('fTelefono').value.trim() || null,
    correo: $('fCorreo').value.trim() || null,
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
    if (editingId) {
      await guardarFactura(`/api/finanzas/${editingId}`, 'PUT', payload);
    } else {
      Object.assign(payload, {
        archivo_nombre: pending ? pending.archivo_nombre : null,
        archivo_tipo: pending ? pending.archivo_tipo : null,
        archivo_base64: pending ? pending.archivo_base64 : null,
        datos_extraidos: pending ? pending.datos_extraidos : null,
      });
      await guardarFactura('/api/finanzas', 'POST', payload);
    }
    // Si venía de una carga en grupo, sigue con la próxima de la cola en vez
    // de cerrar el formulario — así se revisan/guardan una por una sin tener
    // que volver a tocar "elegir archivo" entre cada una.
    if (fileQueue.length > 0) siguienteEnCola();
    else resetForm();
    await Promise.all([loadResumen(), loadFacturas(), loadProyectos()]);
  } catch (err) {
    if (err.message !== 'CANCELADO_POR_USUARIO') alert('Error: ' + err.message);
  } finally {
    $('guardarBtn').disabled = false;
    $('guardarBtn').textContent = editingId ? 'Guardar cambios' : 'Guardar factura';
  }
});

// El servidor responde 409 con { duplicado, existentes } cuando ya hay una
// factura guardada con el mismo # y proveedor/cliente (ver POST /api/finanzas
// en server/index.js). No bloquea: le mostramos el aviso al usuario y, si
// confirma que quiere guardarla igual, reintentamos con
// confirmar_duplicado=true para que el servidor no vuelva a preguntar.
async function guardarFactura(url, method, payload) {
  let res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let data = await res.json();

  if (res.status === 409 && data.duplicado) {
    const detalles = data.existentes.map((e) => {
      const f = e.fecha ? new Date(e.fecha).toLocaleDateString('es-PA') : 'sin fecha';
      return `• #${e.numero_factura} — ${e.contraparte} — ${money(e.total)} (${f})`;
    }).join('\n');
    const seguir = confirm(`⚠️ Ya existe una factura guardada con el mismo número y proveedor/cliente:\n\n${detalles}\n\n¿Guardar de todas formas?`);
    if (!seguir) throw new Error('CANCELADO_POR_USUARIO');
    payload.confirmar_duplicado = true;
    res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    data = await res.json();
  }

  if (!res.ok) throw new Error(data.error || 'no se pudo guardar');
  return data;
}

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
    <a class="fin-btn fin-btn-ghost" style="display:block;text-align:center;text-decoration:none;margin-top:14px"
       href="/api/finanzas/reporte-anual/pdf?anio=${data.anio}" target="_blank">📊 Generar reporte anual (PDF)</a>
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

function populateMesFilter() {
  const sel = $('filtroMes');
  sel.innerHTML = '<option value="">Todos los meses</option>' +
    MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
}

async function loadReportes() {
  const res = await fetch('/api/finanzas/reportes');
  const reportes = await res.json();
  if (!reportes.length) {
    $('listaReportes').innerHTML = '<div class="empty">Todavía no has generado ningún reporte.</div>';
    return;
  }
  $('listaReportes').innerHTML = reportes.map((r) => {
    const nombre = r.tipo === 'anual' ? `Reporte anual ${r.nombre}` : `Reporte: ${r.nombre}`;
    const fecha = new Date(r.created_at).toLocaleString('es-PA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="reporte-item">
        <div>
          <div class="nombre">${escapeHtml(nombre)}</div>
          <div class="fecha">Generado el ${fecha}</div>
        </div>
        <div class="acciones">
          <a href="/api/finanzas/reportes/${r.id}/pdf" target="_blank">Descargar</a>
          <button onclick="eliminarReporte(${r.id})" style="color:var(--red)">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');
}

async function eliminarReporte(id) {
  if (!confirm('¿Eliminar este reporte guardado? Esta acción no se puede deshacer.')) return;
  await fetch(`/api/finanzas/reportes/${id}`, { method: 'DELETE' });
  loadReportes();
}

// ---------- asignar facturas ya guardadas a un proyecto ----------

let facturasParaAsignar = [];

async function cargarParaAsignar() {
  const proyecto = $('asignarProyectoInput').value.trim();
  if (!proyecto) { $('asignarEstado').textContent = 'Escribe o elige un proyecto primero.'; return; }

  $('asignarListaFacturas').innerHTML = '<div class="spinner">Cargando facturas…</div>';
  $('asignarEstado').textContent = '';
  const res = await fetch('/api/finanzas');
  facturasParaAsignar = await res.json();

  if (!facturasParaAsignar.length) {
    $('asignarListaFacturas').innerHTML = '<div class="empty">No hay facturas guardadas todavía.</div>';
    $('guardarAsignacionBtn').style.display = 'none';
    return;
  }

  $('asignarListaFacturas').innerHTML = facturasParaAsignar.map((f) => {
    const fecha = f.fecha ? new Date(f.fecha + 'T00:00:00').toLocaleDateString('es-PA') : 'sin fecha';
    const checked = f.proyecto === proyecto ? 'checked' : '';
    return `
      <label class="asignar-item ${f.tipo}">
        <input type="checkbox" data-id="${f.id}" ${checked}>
        <span class="desc">${escapeHtml(f.contraparte) || '(sin nombre)'} — ${fecha}${f.numero_factura ? ' · #' + escapeHtml(f.numero_factura) : ''}${f.proyecto && f.proyecto !== proyecto ? ` <span style="color:var(--gray-400)">(actualmente: ${escapeHtml(f.proyecto)})</span>` : ''}</span>
        <span class="total">${money(f.total)}</span>
      </label>
    `;
  }).join('');
  $('guardarAsignacionBtn').style.display = 'block';
}

$('cargarParaAsignarBtn').addEventListener('click', cargarParaAsignar);

$('guardarAsignacionBtn').addEventListener('click', async () => {
  const proyecto = $('asignarProyectoInput').value.trim();
  if (!proyecto) return;

  const asignar = [];
  const desasignar = [];
  document.querySelectorAll('#asignarListaFacturas input[type="checkbox"]').forEach((chk) => {
    const id = Number(chk.dataset.id);
    const factura = facturasParaAsignar.find((f) => f.id === id);
    if (chk.checked) asignar.push(id);
    else if (factura && factura.proyecto === proyecto) desasignar.push(id);
  });

  $('guardarAsignacionBtn').disabled = true;
  $('asignarEstado').textContent = 'Guardando…';
  try {
    const res = await fetch('/api/finanzas/asignar-proyecto', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proyecto, asignar, desasignar }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'no se pudo guardar');
    $('asignarEstado').textContent = `✅ ${data.asignadas} factura(s) asignada(s), ${data.desasignadas} quitada(s) de "${proyecto}".`;
    await Promise.all([loadResumen(), loadFacturas(), loadProyectos()]);
    cargarParaAsignar();
  } catch (err) {
    $('asignarEstado').textContent = '❌ ' + err.message;
  } finally {
    $('guardarAsignacionBtn').disabled = false;
  }
});

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

function actualizarBotonReporteProyecto() {
  const proyecto = $('filtroProyecto').value;
  const btn = $('reporteProyectoBtn');
  if (proyecto) {
    btn.href = `/api/finanzas/proyecto/${encodeURIComponent(proyecto)}/pdf`;
    btn.style.display = 'block';
  } else {
    btn.style.display = 'none';
  }
}

async function loadFacturas() {
  actualizarBotonReporteProyecto();
  const params = new URLSearchParams();
  if ($('filtroTipo').value) params.set('tipo', $('filtroTipo').value);
  if ($('filtroMes').value) params.set('mes', $('filtroMes').value);
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
$('filtroMes').addEventListener('change', loadFacturas);
$('filtroProyecto').addEventListener('change', loadFacturas);
$('filtroAnio').addEventListener('change', loadResumen);

populateAnioFilter();
populateMesFilter();
updateTipoToggleClasses();
loadResumen();
loadReportes();
loadProyectos();
loadFacturas();

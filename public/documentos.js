const fileDrop = document.getElementById('fileDrop');
const fileInput = document.getElementById('fileInput');
const fileDropLabel = document.getElementById('fileDropLabel');
const statusEl = document.getElementById('status');
const pendientesCard = document.getElementById('pendientesCard');
const pendientesCampos = document.getElementById('pendientesCampos');
const pendientesForm = document.getElementById('pendientesForm');
const resultadoCard = document.getElementById('resultadoCard');
const resultadoTitulo = document.getElementById('resultadoTitulo');
const resultadoAviso = document.getElementById('resultadoAviso');
const descargarDeNuevoBtn = document.getElementById('descargarDeNuevoBtn');

let ultimoResultado = null; // { blobUrl, nombreArchivo }
let archivoActual = null;

function descargar(blobUrl, nombreArchivo) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Habla con /api/documentos/autenticar. Sin `respuestas`, el servidor puede
// responder con JSON { requierePendientes:true, pendientes } en vez del PDF,
// si el formulario pide algún dato que no está en shared/companyProfile.js.
async function enviarDocumento(file, respuestas) {
  const fd = new FormData();
  fd.append('file', file);
  if (respuestas) fd.append('respuestas', JSON.stringify(respuestas));

  const res = await fetch('/api/documentos/autenticar', { method: 'POST', body: fd });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo procesar el documento.');
  }

  const tipo = res.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    return { tipo: 'json', data: await res.json() };
  }
  const nombreEncontrado = res.headers.get('X-Nombre-Encontrado') === 'true';
  const blob = await res.blob();
  return { tipo: 'pdf', blob, nombreEncontrado };
}

function renderPendientesForm(pendientes) {
  pendientesCampos.innerHTML = '';
  pendientes.forEach((p) => {
    const wrap = document.createElement('div');
    wrap.className = 'campo-pendiente';

    const label = document.createElement('label');
    label.setAttribute('for', `campo-${p.indice}`);
    label.textContent = p.etiqueta;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `campo-${p.indice}`;
    input.dataset.indice = p.indice;

    wrap.appendChild(label);
    wrap.appendChild(input);
    pendientesCampos.appendChild(wrap);
  });
  pendientesCard.classList.add('show');
}

function mostrarResultado(resultado, nombreOriginal) {
  const blobUrl = URL.createObjectURL(resultado.blob);
  const nombreArchivo = nombreOriginal.replace(/\.docx$/i, '') + ' - firmado.pdf';

  ultimoResultado = { blobUrl, nombreArchivo };
  descargar(blobUrl, nombreArchivo);

  statusEl.textContent = '';
  resultadoTitulo.textContent = 'Documento firmado';
  resultadoAviso.innerHTML = resultado.nombreEncontrado
    ? '<div class="aviso-ok">✅ Se encontró el nombre del representante legal y la firma quedó justo ahí.</div>'
    : '<div class="aviso-revisar">⚠️ No se encontró el nombre del representante legal en el texto — la firma se colocó al final del documento. Revisa que quede bien ubicada.</div>';
  resultadoCard.classList.add('show');
}

async function procesarArchivo(file) {
  if (!file) return;
  archivoActual = file;
  resultadoCard.classList.remove('show');
  pendientesCard.classList.remove('show');
  statusEl.textContent = `Procesando "${file.name}"… puede tardar unos segundos.`;

  try {
    const resultado = await enviarDocumento(file, null);
    if (resultado.tipo === 'json' && resultado.data.requierePendientes) {
      statusEl.textContent = '';
      renderPendientesForm(resultado.data.pendientes);
      return;
    }
    mostrarResultado(resultado, file.name);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    fileInput.value = '';
  }
}

pendientesForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!archivoActual) return;

  const respuestas = {};
  pendientesCampos.querySelectorAll('input').forEach((input) => {
    if (input.value.trim()) respuestas[input.dataset.indice] = input.value.trim();
  });

  pendientesCard.classList.remove('show');
  statusEl.textContent = 'Firmando documento…';

  try {
    const resultado = await enviarDocumento(archivoActual, respuestas);
    if (resultado.tipo === 'json') {
      throw new Error('No se pudo completar el documento.');
    }
    mostrarResultado(resultado, archivoActual.name);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});

fileInput.addEventListener('change', () => procesarArchivo(fileInput.files[0]));

descargarDeNuevoBtn.addEventListener('click', () => {
  if (ultimoResultado) descargar(ultimoResultado.blobUrl, ultimoResultado.nombreArchivo);
});

['dragover', 'dragenter'].forEach(evt => {
  fileDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    fileDrop.classList.add('dragover');
  });
});
['dragleave', 'dragend'].forEach(evt => {
  fileDrop.addEventListener(evt, () => fileDrop.classList.remove('dragover'));
});
fileDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) procesarArchivo(file);
});

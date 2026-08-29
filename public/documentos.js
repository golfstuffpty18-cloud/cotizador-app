const fileDrop = document.getElementById('fileDrop');
const fileInput = document.getElementById('fileInput');
const fileDropLabel = document.getElementById('fileDropLabel');
const statusEl = document.getElementById('status');
const resultadoCard = document.getElementById('resultadoCard');
const resultadoTitulo = document.getElementById('resultadoTitulo');
const resultadoAviso = document.getElementById('resultadoAviso');
const descargarDeNuevoBtn = document.getElementById('descargarDeNuevoBtn');

let ultimoResultado = null; // { blobUrl, nombreArchivo }

function descargar(blobUrl, nombreArchivo) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function procesarArchivo(file) {
  if (!file) return;
  resultadoCard.classList.remove('show');
  statusEl.textContent = `Procesando "${file.name}"… puede tardar unos segundos.`;

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch('/api/documentos/autenticar', { method: 'POST', body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo procesar el documento.');
    }
    const nombreEncontrado = res.headers.get('X-Nombre-Encontrado') === 'true';
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const nombreArchivo = file.name.replace(/\.docx$/i, '') + ' - firmado.pdf';

    ultimoResultado = { blobUrl, nombreArchivo };
    descargar(blobUrl, nombreArchivo);

    statusEl.textContent = '';
    resultadoTitulo.textContent = 'Documento firmado';
    resultadoAviso.innerHTML = nombreEncontrado
      ? '<div class="aviso-ok">✅ Se encontró el nombre del representante legal y la firma quedó justo ahí.</div>'
      : '<div class="aviso-revisar">⚠️ No se encontró el nombre del representante legal en el texto — la firma se colocó al final del documento. Revisa que quede bien ubicada.</div>';
    resultadoCard.classList.add('show');
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    fileInput.value = '';
  }
}

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

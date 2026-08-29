const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { analyzeFormFields, formatearFechaHoy, aplicarPlantilla } = require('./fillFormFields');

// Mismo archivo que ya usa shared/generateQuotePdf.js para las cotizaciones
// — no se duplica el activo, solo se reutiliza.
const FIRMA_PATH = path.join(__dirname, 'assets', 'firma.png');

// Mismo nombre que ya está impreso en la firma de las cotizaciones
// (generateQuotePdf.js) — se busca dentro del Word, insensible a mayúsculas
// y acentos, para saber dónde estampar la firma.
const NOMBRE_REPRESENTANTE = 'dionisio sanchez';

function normalizar(str) {
  return (str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase();
}

function contieneNombreRepresentante(texto) {
  return normalizar(texto).includes(NOMBRE_REPRESENTANTE);
}

function firmaHtml() {
  const base64 = fs.readFileSync(FIRMA_PATH).toString('base64');
  return `
    <div style="margin-top:18px;">
      <img src="data:image/png;base64,${base64}" style="height:70px; display:block;">
      <div style="border-top:1px solid #cccccc; width:220px; margin-top:2px;"></div>
      <div style="font-family:Helvetica,Arial,sans-serif; font-weight:bold; font-size:11pt; color:#0a0a1a; margin-top:6px;">Ing. Dionisio Sánchez</div>
      <div style="font-family:Helvetica,Arial,sans-serif; font-size:10pt; color:#565873;">Representante Legal</div>
    </div>
  `;
}

// Recibe el buffer de un .docx cualquiera (formato variable, no una
// plantilla fija) y devuelve un PDF con la firma estampada justo después del
// párrafo donde aparece el nombre del representante legal — o al final del
// documento si el nombre no aparece en ningún lado (nombreEncontrado:false,
// para que la pantalla se lo avise al usuario y revise dónde quedó).
//
// Antes de firmar, intenta llenar los campos en blanco del formulario (ver
// shared/fillFormFields.js):
//  - datos conocidos de la empresa/representante -> se llenan directo.
//  - fechas -> se llenan con la fecha real del día en que se sube el
//    documento.
//  - cualquier otro dato que no se pueda saber de antemano (número de acto,
//    etc.) -> si no se le pasó `respuestas`, se detiene ACÁ y devuelve
//    { requierePendientes:true, pendientes } para que la pantalla se lo
//    pregunte al usuario antes de generar el PDF. El caller vuelve a llamar
//    a signDocument con las respuestas para terminar de firmar.
async function signDocument(docxBuffer, respuestas = null) {
  const { value: html } = await mammoth.convertToHtml({ buffer: docxBuffer });
  const $ = cheerio.load(html);
  const body = $('body');

  const parrafos = body.children().toArray().map((el) => $(el).text());
  const { campos, pendientes } = await analyzeFormFields(parrafos);
  const pendientesDato = pendientes.filter((p) => p.tipo === 'dato');
  const pendientesFecha = pendientes.filter((p) => p.tipo === 'fecha');

  if (!respuestas && pendientesDato.length > 0) {
    return {
      requierePendientes: true,
      pendientes: pendientesDato.map(({ indice, etiqueta }) => ({ indice, etiqueta })),
    };
  }

  campos.forEach(({ indice, textoLleno }) => {
    $(body.children().get(indice)).text(textoLleno);
  });

  const fechaHoy = formatearFechaHoy();
  pendientesFecha.forEach((p) => {
    $(body.children().get(p.indice)).text(aplicarPlantilla(p.plantilla, fechaHoy));
  });

  if (respuestas) {
    pendientesDato.forEach((p) => {
      const valor = respuestas[String(p.indice)];
      if (valor && parrafos[p.indice] === p.textoOriginal) {
        $(body.children().get(p.indice)).text(aplicarPlantilla(p.plantilla, valor));
      }
    });
  }

  const firma = firmaHtml();

  // La ÚLTIMA aparición del nombre, no la primera: ahora que se llenan
  // campos en blanco, el nombre del representante puede aparecer también en
  // una frase temprana del documento (ej. "Yo, Ing. Dionisio Sánchez,
  // portador de la cédula..."), antes del bloque de firma real que casi
  // siempre está al final. Si solo aparece una vez (el caso más común),
  // última y primera son la misma.
  let elementoFirma = null;
  for (const el of body.children().toArray()) {
    if (contieneNombreRepresentante($(el).text())) {
      elementoFirma = el;
    }
  }

  const nombreEncontrado = elementoFirma !== null;
  if (elementoFirma) {
    $(elementoFirma).after(firma);
  } else {
    body.append(firma);
  }

  const documentoHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #10101f; padding: 60px 70px; line-height: 1.5; }
  p { margin: 0 0 10px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #999; padding: 4px 8px; }
</style></head>
<body>${body.html()}</body></html>`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(documentoHtml, { waitUntil: 'networkidle0' });
    // page.pdf() en Puppeteer 23.x devuelve un Uint8Array, no un Buffer real
    // de Node — Express.res.send() no lo reconoce como binario (Buffer.
    // isBuffer da false) y lo serializa como JSON byte por byte, inflando el
    // tamaño ~12x. Buffer.from() lo envuelve sin copiar los datos.
    const pdfBytes = await page.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
    });
    const pdfBuffer = Buffer.from(pdfBytes);
    return { pdfBuffer, nombreEncontrado };
  } finally {
    await browser.close();
  }
}

module.exports = { signDocument };

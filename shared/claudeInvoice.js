// Extrae los datos de una factura (foto o PDF) usando Claude Vision. No hace
// OCR de texto plano: Claude interpreta el layout de la imagen igual que lo
// haría una persona, por lo que funciona con formatos de factura distintos
// entre proveedores sin necesitar un parser por cada uno. El resultado es
// siempre una propuesta que el usuario revisa/corrige antes de guardar —
// nunca se guarda directo, ver POST /api/finanzas en server/index.js.
const Anthropic = require('@anthropic-ai/sdk');

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Falta configurar ANTHROPIC_API_KEY en el servidor para poder leer facturas automáticamente.');
    }
    client = new Anthropic();
  }
  return client;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Nombre(s) bajo los que puede aparecer la empresa dueña de esta cuenta en
// una factura — la razón social legal ("GS Technologies Investments, S.A.")
// no siempre coincide con el nombre comercial que usa el resto de la app.
// Nunca se debe extraer contraparte/ruc/dirección/teléfono/correo de esta
// empresa: sea cual sea el nombre impreso, ese lado de la factura se ignora.
const EMPRESA_PROPIA = 'GS Technologies Investments, S.A. (nombre comercial: GS Technologies and Security Solutions / GS Technologies)';

// additionalProperties:false exige que TODAS las propiedades estén en
// "required" — los campos opcionales se marcan con anyOf [tipo, null] en vez
// de omitirse, así Claude puede devolver null cuando no logra leer un dato
// con certeza en vez de inventarlo.
const SCHEMA = {
  type: 'object',
  properties: {
    contraparte: {
      type: 'string',
      description: `Nombre de la OTRA empresa/persona en la transacción — NUNCA ${EMPRESA_PROPIA}, la dueña de esta cuenta. Si es una factura de compra/gasto: el proveedor que la emite. Si es una factura que la empresa propia emitió a un cliente: el cliente que la recibe (sección "Cliente:", "Facturado a:", "Señor(es):", "Razón Social:" o similar — no el encabezado/logo de arriba).`,
    },
    ruc: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'RUC de esa misma contraparte, nunca el de la empresa propia.' },
    direccion: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      description: 'Dirección de esa misma contraparte, nunca de la empresa propia. Si aparece impresa en la factura.',
    },
    telefono: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Teléfono de esa misma contraparte, nunca de la empresa propia.' },
    correo: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Correo de esa misma contraparte, nunca de la empresa propia.' },
    numero_factura: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    fecha: {
      anyOf: [{ type: 'string', description: 'Fecha de la factura en formato YYYY-MM-DD' }, { type: 'null' }],
    },
    subtotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    itbm: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    total: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    items: {
      anyOf: [
        {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              descripcion: { type: 'string' },
              cantidad: { anyOf: [{ type: 'number' }, { type: 'null' }] },
              precio_unitario: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            },
            required: ['descripcion', 'cantidad', 'precio_unitario'],
            additionalProperties: false,
          },
        },
        { type: 'null' },
      ],
    },
  },
  required: ['contraparte', 'ruc', 'direccion', 'telefono', 'correo', 'numero_factura', 'fecha', 'subtotal', 'itbm', 'total', 'items'],
  additionalProperties: false,
};

// Salvaguarda determinística: en la práctica, el modelo a veces devuelve el
// nombre de la empresa propia como "contraparte" a pesar de las
// instrucciones del prompt (el nombre del encabezado "gana" incluso cuando
// dirección/teléfono/correo sí se leen bien del bloque del cliente). En vez
// de confiar solo en el prompt, se anula el campo si coincide — mejor
// dejarlo vacío y pedirle al usuario que lo escriba que guardar un dato
// claramente equivocado.
const NOMBRE_PROPIO_RE = /gs\s*technologies/i;
function limpiarContraparteSiEsEmpresaPropia(data) {
  if (data && typeof data.contraparte === 'string' && NOMBRE_PROPIO_RE.test(data.contraparte)) {
    data.contraparte = null;
  }
  return data;
}

function buildContentBlock(buffer, mimetype) {
  const data = buffer.toString('base64');
  if (mimetype === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  if (IMAGE_TYPES.has(mimetype)) {
    return { type: 'image', source: { type: 'base64', media_type: mimetype, data } };
  }
  return null;
}

async function extractInvoiceData(buffer, mimetype) {
  const contentBlock = buildContentBlock(buffer, mimetype);
  if (!contentBlock) {
    throw new Error('Formato de archivo no soportado. Sube una foto (JPG/PNG/WEBP) o un PDF.');
  }

  const response = await getClient().messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    // effort 'medium' (no 'low'): distinguir el bloque del emisor del bloque
    // del cliente en el layout de una factura requiere algo de razonamiento
    // — con 'low' el nombre (contraparte) salía mal aunque dirección/
    // teléfono/correo del mismo bloque sí salían bien.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        {
          type: 'text',
          text: `Esta imagen o documento es una factura de una empresa panameña propia (${EMPRESA_PROPIA}). Puede ser (a) una factura de COMPRA/GASTO que un proveedor le emitió a la empresa propia, o (b) una factura que la empresa propia EMITIÓ a uno de sus clientes.\n\n` +
            `IMPORTANTE: en ambos casos, todos los datos que extraigas (contraparte, ruc, dirección, teléfono, correo) deben ser de la OTRA empresa/persona en la transacción — NUNCA de la empresa propia (${EMPRESA_PROPIA}), bajo ninguno de sus nombres. Si es una factura emitida a un cliente, los datos de la empresa propia suelen aparecer arriba, en el encabezado o logo del documento — ignóralos; busca en cambio la sección donde se identifica a quien RECIBE la factura (normalmente etiquetada "Cliente:", "Facturado a:", "Señor(es):", "Razón Social:" o similar).\n\n` +
            'PRIMERO localiza ese bloque de texto del cliente/proveedor (normalmente trae junto el nombre, RUC, dirección y a veces teléfono/correo). LUEGO extrae los cinco campos (contraparte, ruc, direccion, telefono, correo) del MISMO bloque — nunca mezcles el nombre de una parte del documento con los datos de contacto de otra parte. Si el nombre que ibas a poner en "contraparte" no es exactamente la misma entidad de la que sacaste "direccion"/"telefono"/"correo", revísalo: es una señal de que tomaste el nombre del lugar equivocado.\n\n' +
            'Extrae los datos exactamente como aparecen en el documento, sin inventar ni redondear. Si un dato no aparece o no se puede leer con certeza, usa null en vez de adivinar. La fecha debe ir en formato YYYY-MM-DD.',
        },
      ],
    }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude no pudo procesar este archivo. Intenta con otra foto/escaneo o ingresa los datos manualmente.');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new Error('No se pudo leer la respuesta de extracción. Ingresa los datos manualmente.');
  }

  try {
    return limpiarContraparteSiEsEmpresaPropia(JSON.parse(textBlock.text));
  } catch (err) {
    throw new Error('La extracción no devolvió un formato válido. Ingresa los datos manualmente.');
  }
}

module.exports = { extractInvoiceData };

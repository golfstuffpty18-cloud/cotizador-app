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

// additionalProperties:false exige que TODAS las propiedades estén en
// "required" — los campos opcionales se marcan con anyOf [tipo, null] en vez
// de omitirse, así Claude puede devolver null cuando no logra leer un dato
// con certeza en vez de inventarlo.
const SCHEMA = {
  type: 'object',
  properties: {
    contraparte: {
      type: 'string',
      description: 'Nombre del proveedor (si es una factura de compra/gasto) o del cliente (si es una factura emitida a un cliente).',
    },
    ruc: { anyOf: [{ type: 'string' }, { type: 'null' }] },
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
  required: ['contraparte', 'ruc', 'numero_factura', 'fecha', 'subtotal', 'itbm', 'total', 'items'],
  additionalProperties: false,
};

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
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        {
          type: 'text',
          text: 'Esta imagen o documento es una factura de una empresa panameña (puede ser una factura de compra/gasto recibida de un proveedor, o una factura emitida a un cliente). Extrae los datos exactamente como aparecen en el documento, sin inventar ni redondear. Si un dato no aparece o no se puede leer con certeza, usa null en vez de adivinar. La fecha debe ir en formato YYYY-MM-DD.',
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
    return JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error('La extracción no devolvió un formato válido. Ingresa los datos manualmente.');
  }
}

module.exports = { extractInvoiceData };

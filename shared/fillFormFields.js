// Llena campos en blanco de un formulario (Word) con los datos conocidos de
// la empresa/representante (shared/companyProfile.js), ANTES de que
// generateSignedDocument.js busque el nombre del representante y estampe la
// firma. Mismo patrón que shared/claudeInvoice.js (extracción de facturas):
// output_config con json_schema, campos opcionales en null en vez de
// inventados, y una verificación determinística después de la respuesta —
// acá la verificación es más estricta todavía, porque un dato mal puesto en
// un documento legal es peor que dejarlo en blanco.
const Anthropic = require('@anthropic-ai/sdk');
const { COMPANY_PROFILE } = require('./companyProfile');

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Falta configurar ANTHROPIC_API_KEY en el servidor para poder llenar formularios automáticamente.');
    }
    client = new Anthropic();
  }
  return client;
}

// Heurística barata antes de gastar una llamada a la API: un documento ya
// lleno (como los que ya procesa "Autenticar documentos" hoy) no debe
// disparar ninguna llamada — solo se intenta si el texto realmente tiene
// pinta de formulario con espacios en blanco por llenar.
function pareceFormularioEnBlanco(parrafos) {
  const texto = parrafos.join('\n');
  return /_{3,}/.test(texto) || /:\s*$/m.test(texto) || /:\s*[_\-]{2,}\s*$/m.test(texto);
}

const SCHEMA = {
  type: 'object',
  properties: {
    campos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          indice: { type: 'integer', description: 'Índice (empezando en 0) del párrafo en la lista que se le dio.' },
          textoOriginal: { type: 'string', description: 'El texto EXACTO de ese párrafo tal como se le dio, sin modificar — se usa para verificar que no se confundió de párrafo.' },
          textoLleno: { type: 'string', description: 'El mismo párrafo, con el espacio en blanco reemplazado por el dato conocido correspondiente.' },
        },
        required: ['indice', 'textoOriginal', 'textoLleno'],
        additionalProperties: false,
      },
    },
  },
  required: ['campos'],
  additionalProperties: false,
};

async function fillFormFields(parrafos) {
  if (!pareceFormularioEnBlanco(parrafos)) return [];

  const listaParrafos = parrafos.map((p, i) => `[${i}] ${p}`).join('\n');

  const response = await getClient().messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Este es el texto de un formulario en Word, dividido en párrafos numerados. Algunos párrafos tienen un espacio en blanco por llenar (líneas terminadas en ":", guiones bajos "___", o similar).\n\n` +
          `Estos son los ÚNICOS datos que puedes usar para llenar campos — nunca ningún otro dato:\n${JSON.stringify(COMPANY_PROFILE, null, 2)}\n\n` +
          `Párrafos del documento:\n${listaParrafos}\n\n` +
          'Para cada párrafo que tenga un espacio en blanco que puedas llenar con ALGUNO de esos datos conocidos (nombre de la empresa, dirección, teléfono, RUC, correo, nombre del representante, su cargo, o su cédula), agrega un ítem con el índice de ese párrafo, el texto original exacto, y el texto ya lleno.\n\n' +
          'MUY IMPORTANTE: si un párrafo pide un dato que NO está en la lista de arriba (una fecha de trámite, un número de acto, una cédula distinta a la del representante, un monto, cualquier cosa que no esté ahí), NO LO INCLUYAS en tu respuesta — omite ese párrafo por completo. Nunca inventes, asumas ni completes con un valor que no venga literal de esos datos conocidos. Si un párrafo ya está lleno (no tiene ningún espacio en blanco), tampoco lo incluyas.',
      }],
    }],
  });

  if (response.stop_reason === 'refusal') {
    return [];
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return [];

  let campos;
  try {
    campos = JSON.parse(textBlock.text).campos || [];
  } catch (err) {
    return [];
  }

  // Verificación determinística: si el texto original que Claude reporta no
  // coincide EXACTO con el párrafo real en ese índice, se descarta ese
  // ítem — mejor no tocar un párrafo que tocar el equivocado.
  return campos.filter((c) => {
    return typeof c.indice === 'number'
      && parrafos[c.indice] === c.textoOriginal
      && typeof c.textoLleno === 'string'
      && c.textoLleno.length > 0;
  });
}

module.exports = { fillFormFields, pareceFormularioEnBlanco };

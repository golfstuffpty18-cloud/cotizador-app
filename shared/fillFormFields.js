// Analiza los párrafos de un formulario en Word y decide, para cada campo en
// blanco, en cuál de tres grupos cae — ANTES de que
// generateSignedDocument.js lo firme:
//   1. campos:     dato conocido (empresa/representante) -> se llena directo.
//   2. pendientes con tipo 'fecha': se llena con la fecha real del día en
//      que se sube el documento (calculada acá, nunca por el modelo).
//   3. pendientes con tipo 'dato': no hay forma de saberlo (número de acto,
//      montos, etc.) -> se le pregunta al usuario antes de firmar.
// Mismo patrón que shared/claudeInvoice.js: output_config con json_schema,
// nunca se inventa un valor que no venga de un dato conocido o de la fecha
// real, y una verificación determinística después de la respuesta.
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

// Cuánto de la fecha hay que escribir depende de si el año ya aparece fijo
// en el documento (ej. "___ de 2026") o si el blanco pide la fecha completa
// — por eso lo decide analyzeFormFields por cada caso, no un formato único.
function formatearFechaHoy(formato) {
  const opciones = formato === 'dia_mes'
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('es-PA', opciones).format(new Date());
}

// Sustitución literal (no String.replace, para que un valor con "$" no se
// interprete como patrón de reemplazo).
function aplicarPlantilla(plantilla, valor) {
  return plantilla.split('{{RESPUESTA}}').join(valor);
}

const CAMPO_ITEM = {
  type: 'object',
  properties: {
    indice: { type: 'integer', description: 'Índice (empezando en 0) del párrafo en la lista que se le dio.' },
    textoOriginal: { type: 'string', description: 'El texto EXACTO de ese párrafo tal como se le dio, sin modificar.' },
    textoLleno: { type: 'string', description: 'El mismo párrafo, con el espacio en blanco reemplazado por el dato conocido correspondiente.' },
  },
  required: ['indice', 'textoOriginal', 'textoLleno'],
  additionalProperties: false,
};

const PENDIENTE_ITEM = {
  type: 'object',
  properties: {
    indice: { type: 'integer', description: 'Índice (empezando en 0) del párrafo en la lista que se le dio.' },
    textoOriginal: { type: 'string', description: 'El texto EXACTO de ese párrafo tal como se le dio, sin modificar.' },
    tipo: { type: 'string', enum: ['fecha', 'dato'], description: '"fecha" si el espacio en blanco pide la fecha del día (fecha del trámite, fecha de solicitud, etc.). "dato" para cualquier otro dato que no se pueda saber de antemano (número de acto, montos, etc.).' },
    formatoFecha: {
      anyOf: [{ type: 'string', enum: ['dia_mes', 'dia_mes_anio'] }, { type: 'null' }],
      description: 'Solo para tipo "fecha": "dia_mes" si el año YA aparece como texto fijo justo después del blanco (ej: "___ de 2026", el blanco solo pide día y mes). "dia_mes_anio" si el blanco pide la fecha completa, año incluido. null si tipo es "dato".',
    },
    etiqueta: { type: 'string', description: 'Nombre corto y claro de qué dato se está pidiendo, para mostrárselo al usuario (ej: "Número de acto"). Para tipo "fecha" puede repetir el texto del campo.' },
    plantilla: { type: 'string', description: 'El mismo párrafo con el espacio en blanco reemplazado EXACTAMENTE por el texto literal {{RESPUESTA}} (una sola vez), manteniendo el resto del texto igual, para poder insertar el valor ahí después.' },
  },
  required: ['indice', 'textoOriginal', 'tipo', 'formatoFecha', 'etiqueta', 'plantilla'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    campos: { type: 'array', items: CAMPO_ITEM },
    pendientes: { type: 'array', items: PENDIENTE_ITEM },
  },
  required: ['campos', 'pendientes'],
  additionalProperties: false,
};

async function analyzeFormFields(parrafos) {
  if (!pareceFormularioEnBlanco(parrafos)) return { campos: [], pendientes: [] };

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
          `Estos son los ÚNICOS datos conocidos de la empresa y su representante:\n${JSON.stringify(COMPANY_PROFILE, null, 2)}\n\n` +
          `Párrafos del documento:\n${listaParrafos}\n\n` +
          'Clasifica cada párrafo con un espacio en blanco por llenar en uno de estos tres grupos:\n\n' +
          '1) "campos": el espacio en blanco pide un dato que SÍ está en la lista de datos conocidos de arriba (nombre de la empresa, dirección, teléfono, RUC, número de aviso de operación, correo, nombre del representante, su cargo, o su cédula). Agrega el índice, el texto original exacto, y el texto ya lleno con ese dato.\n\n' +
          '2) "pendientes" con tipo "fecha": el espacio en blanco pide la fecha en que se llena o se firma el documento (ej. "Fecha:", "Fecha del trámite:", "Fecha de solicitud:", "Panamá, ___ de 2026"). NO escribas ninguna fecha tú mismo — solo marca el párrafo con tipo "fecha" y en "plantilla" pon el mismo texto pero con el espacio en blanco reemplazado exactamente por el texto literal {{RESPUESTA}} una sola vez (el sistema pondrá ahí la fecha real del día). Fíjate bien si el AÑO ya aparece escrito justo después del blanco (ej: "___ de 2026") — en ese caso usa formatoFecha:"dia_mes" para que el sistema no repita el año; si el blanco pide la fecha completa usa formatoFecha:"dia_mes_anio".\n\n' +
          '3) "pendientes" con tipo "dato": el espacio en blanco pide cualquier otro dato que NO está en la lista de datos conocidos (número de acto, montos, fechas de eventos que no son "hoy", cédulas distintas a la del representante, cualquier cosa que no esté literal en la lista). Agrega el índice, el texto original exacto, una "etiqueta" corta describiendo qué se pide (ej: "Número de acto"), formatoFecha:null (no aplica), y una "plantilla" igual que en el caso de fecha (el mismo texto con el espacio en blanco reemplazado exactamente por {{RESPUESTA}} una sola vez).\n\n' +
          'MUY IMPORTANTE: nunca inventes, asumas ni completes un dato con un valor que no venga literal de la lista de datos conocidos. Si un párrafo ya está lleno (no tiene ningún espacio en blanco), no lo incluyas en ninguna lista.',
      }],
    }],
  });

  if (response.stop_reason === 'refusal') {
    return { campos: [], pendientes: [] };
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return { campos: [], pendientes: [] };

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    return { campos: [], pendientes: [] };
  }

  // Verificación determinística: si el texto original que Claude reporta no
  // coincide EXACTO con el párrafo real en ese índice, se descarta ese
  // ítem — mejor no tocar un párrafo que tocar el equivocado.
  const campos = (parsed.campos || []).filter((c) => (
    typeof c.indice === 'number'
    && parrafos[c.indice] === c.textoOriginal
    && typeof c.textoLleno === 'string'
    && c.textoLleno.length > 0
  ));

  const pendientes = (parsed.pendientes || []).filter((p) => (
    typeof p.indice === 'number'
    && parrafos[p.indice] === p.textoOriginal
    && (p.tipo === 'fecha' || p.tipo === 'dato')
    && typeof p.etiqueta === 'string' && p.etiqueta.trim().length > 0
    && typeof p.plantilla === 'string' && p.plantilla.includes('{{RESPUESTA}}')
  ));

  return { campos, pendientes };
}

module.exports = { analyzeFormFields, pareceFormularioEnBlanco, formatearFechaHoy, aplicarPlantilla };

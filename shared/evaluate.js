const MATCH_KEYWORDS = [
  'camara', 'cámara', 'cctv', 'videovigilancia', 'video vigilancia',
  'alarma', 'intrusion', 'intrusión', 'sensor de movimiento',
  'control de acceso', 'biometri', 'torniquete', 'cerradura electr',
  'deteccion de incendio', 'detección de incendio', 'contra incendio',
  'humo', 'panel de alarma contra incendio',
  'automatizacion', 'automatización', 'domotica', 'domótica',
  'cableado estructurado', 'voz y datos', 'red de datos', 'punto de red',
  'seguridad electronica', 'seguridad electrónica',
];

const EXCLUDE_KEYWORDS = [
  'pruebas de penetracion', 'pruebas de penetración', 'pentest', 'hacking etico',
  'medicament', 'insumo medic', 'hospital', 'quirurgic', 'jeringu', 'aguja hipoderm',
  'sutura', 'mascarilla', 'catéter', 'cateter', 'colchon', 'colchón',
  'combustible', 'papeleria', 'papelería', 'alimento', 'vehiculo', 'vehículo',
];

function evaluate({ title, referencePrice }) {
  const t = (title || '').toLowerCase();

  const excluded = EXCLUDE_KEYWORDS.find(k => t.includes(k));
  if (excluded) {
    return {
      categoryMatch: false,
      recommendation: 'no_participar',
      reasoning: `El título no corresponde a sistemas de seguridad electrónica (coincide con "${excluded}", fuera del rubro de la empresa).`,
    };
  }

  const matched = MATCH_KEYWORDS.filter(k => t.includes(k));
  if (matched.length === 0) {
    return {
      categoryMatch: false,
      recommendation: 'revisar',
      reasoning: 'El título no menciona explícitamente palabras del rubro (videovigilancia, alarmas, control de acceso, incendio, automatización, voz y datos). Revisar manualmente antes de descartar.',
    };
  }

  let priceNote = '';
  if (referencePrice != null) {
    if (referencePrice < 200) {
      priceNote = ' El precio de referencia es muy bajo — validar si cubre costos operativos antes de participar.';
    }
  }

  return {
    categoryMatch: true,
    recommendation: 'participar',
    reasoning: `Coincide con el rubro de la empresa (${matched.join(', ')}).${priceNote}`,
  };
}

module.exports = { evaluate };

// "camara"/"cámara" y "humo" sueltos generaban falsos positivos (equipo
// médico: "cámara" endoscópica, "humo" de evacuación quirúrgica), sobre todo
// en la búsqueda manual que revisa TODAS las cotizaciones abiertas del
// gobierno, no solo las que ya llegaron filtradas por correo. Se
// reemplazaron por frases más específicas; el resto de la lista se deja
// igual porque no ha dado falsos positivos.
//
// Agrupadas por categoría (no solo una lista plana) para poder etiquetar
// cada oportunidad con su rubro específico — eso es lo que permite que el
// catálogo de precios busque primero dentro de la misma categoría en vez de
// contra todos los ítems mezclados.
const CATEGORY_KEYWORDS = {
  'CCTV': [
    'camara de seguridad', 'cámara de seguridad', 'camara de vigilancia', 'cámara de vigilancia',
    'camaras de seguridad', 'cámaras de seguridad', 'camaras de vigilancia', 'cámaras de vigilancia',
    'camara ip', 'cámara ip', 'camaras ip', 'cámaras ip', 'camara ptz', 'cámara ptz', 'camara ir', 'cámara ir',
    'sistema de camaras', 'sistema de cámaras', 'circuito cerrado de television', 'circuito cerrado de televisión',
    'cctv', 'videovigilancia', 'video vigilancia',
  ],
  'Alarma de Intrusión': [
    'alarma', 'intrusion', 'intrusión', 'sensor de movimiento',
  ],
  'Control de Acceso': [
    'control de acceso', 'biometri', 'torniquete', 'cerradura electr',
  ],
  'Detección de Incendio': [
    'deteccion de incendio', 'detección de incendio', 'contra incendio',
    'detector de humo', 'deteccion de humo', 'detección de humo', 'sensor de humo', 'alarma de humo',
    'panel de alarma contra incendio',
  ],
  'Automatización': [
    'automatizacion', 'automatización', 'domotica', 'domótica',
  ],
  'Voz y Datos': [
    'cableado estructurado', 'voz y datos', 'red de datos', 'punto de red',
  ],
  'Otro': [
    'seguridad electronica', 'seguridad electrónica',
  ],
};

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
      category: null,
      recommendation: 'no_participar',
      reasoning: `El título no corresponde a sistemas de seguridad electrónica (coincide con "${excluded}", fuera del rubro de la empresa).`,
    };
  }

  let bestCategory = null;
  let bestMatched = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matched = keywords.filter(k => t.includes(k));
    if (matched.length > bestMatched.length) {
      bestCategory = category;
      bestMatched = matched;
    }
  }

  if (!bestCategory) {
    return {
      categoryMatch: false,
      category: null,
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
    category: bestCategory,
    recommendation: 'participar',
    reasoning: `Coincide con el rubro de la empresa (${bestMatched.join(', ')}).${priceNote}`,
  };
}

module.exports = { evaluate };

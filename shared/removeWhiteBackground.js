// Convierte una foto/escaneo de una firma sobre papel (fondo blanco/crema
// opaco) en un PNG con el fondo transparente, dejando solo el trazo de
// tinta — así se puede superponer en el PDF sin que se vea un recuadro
// blanco encima del documento.
//
// Técnica: por cada píxel, entre más claro (más cerca del blanco) más
// transparente se vuelve; los tonos oscuros (la tinta) se quedan opacos. El
// degradado entre los dos umbrales evita bordes dentados por el
// anti-aliasing o la textura del papel — un corte binario (blanco/no blanco)
// se ve mal en los bordes del trazo.
const sharp = require('sharp');

async function removeWhiteBackground(inputBuffer, { umbralOscuro = 180, umbralClaro = 245 } = {}) {
  const image = sharp(inputBuffer).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminancia = 0.299 * r + 0.587 * g + 0.114 * b;

    let alpha;
    if (luminancia <= umbralOscuro) {
      alpha = 255; // tinta: totalmente opaco
    } else if (luminancia >= umbralClaro) {
      alpha = 0; // papel/fondo: totalmente transparente
    } else {
      // degradado lineal entre los dos umbrales
      alpha = 255 - Math.round(((luminancia - umbralOscuro) / (umbralClaro - umbralOscuro)) * 255);
    }

    // combina con el alpha que ya traiga el píxel (por si el original no era 100% opaco)
    data[i + 3] = Math.min(data[i + 3], alpha);
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

module.exports = { removeWhiteBackground };

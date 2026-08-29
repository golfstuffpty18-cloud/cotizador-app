const { join } = require('path');

// "Could not find Chrome" en Render: el cache de Puppeteer por defecto
// depende de $HOME, que puede resolver distinto entre el build y el
// contenedor donde corre la app. Fijar la ruta DENTRO del propio proyecto
// (que sí es idéntico en ambos momentos, es literalmente el código
// desplegado) evita depender de que una variable de entorno se propague
// igual en los dos — es la forma recomendada por Puppeteer para esto.
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};

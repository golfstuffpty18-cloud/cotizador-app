#!/usr/bin/env bash
# En Render, npm install descarga el Chromium de Puppeteer a la caché del
# build, pero esa caché no siempre sobrevive al contenedor de ejecución —
# por eso el módulo de autenticar documentos (shared/generateSignedDocument.js)
# fallaba en producción con "Could not find Chrome" aunque en local funcionaba
# bien. Este script fuerza la instalación de Chrome en la ruta de caché fija
# de Render y la copia al lugar donde el runtime la busca.
set -o errexit

npm install

PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR

npx puppeteer browsers install chrome

if [[ ! -d $PUPPETEER_CACHE_DIR/chrome ]]; then
  cp -R /opt/render/project/src/.cache/puppeteer/chrome/ $PUPPETEER_CACHE_DIR
else
  cp -R $PUPPETEER_CACHE_DIR/chrome/ /opt/render/project/src/.cache/puppeteer/chrome/
fi

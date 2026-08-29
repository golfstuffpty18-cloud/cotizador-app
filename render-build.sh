#!/usr/bin/env bash
# En Render, npm install descarga el Chromium de Puppeteer a la caché del
# build, pero esa caché no siempre sobrevive al contenedor de ejecución —
# por eso el módulo de autenticar documentos (shared/generateSignedDocument.js)
# fallaba en producción con "Could not find Chrome" aunque en local funcionaba
# bien. PUPPETEER_CACHE_DIR (fijo también como variable de entorno del
# servicio en render.yaml) hace que tanto este script como el proceso en
# ejecución busquen/instalen Chrome en la misma ruta persistente — con eso
# alcanza, no hace falta copiar nada a ningún otro lugar.
set -o errexit

npm install

mkdir -p "$PUPPETEER_CACHE_DIR"
npx puppeteer browsers install chrome

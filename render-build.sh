#!/usr/bin/env bash
# "Could not find Chrome" en producción: el .puppeteerrc.cjs del proyecto ya
# fija dónde vive el Chromium de Puppeteer (ver ese archivo) — este script
# solo necesita instalarlo ahí explícitamente durante el build.
set -o errexit

npm install
npx puppeteer browsers install chrome

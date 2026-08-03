# Cotizador GS Technologies

App PWA para GS Technologies and Security Solutions: revisa el correo en busca de nuevas
"Solicitud de cotización en línea" de PanamaCompra, evalúa cada una contra el rubro de la
empresa y el precio de referencia, y notifica por push al celular. La decisión de
participar o no se toma en la app.

## Arquitectura

- **cotizador-web** (Render Web Service, gratis): sirve la PWA y la API REST.
- **cotizador-db** (Render PostgreSQL, gratis): almacena oportunidades y suscripciones push.
- **GitHub Actions** (gratis): workflow programado (`.github/workflows/check-email.yml`)
  que corre cada hora L-V 7am-4pm (hora de Panamá), revisa el correo, consulta
  PanamaCompra y envía las notificaciones push. Se usa GitHub Actions en vez de un Render
  Cron Job porque los Cron Jobs de Render no tienen plan gratuito (mínimo ~$1/mes).

## Variables de entorno requeridas

### Render — cotizador-web
- `DATABASE_URL` — la asigna Render automáticamente al vincular la base de datos.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — generadas con `npm run gen-vapid`.
- `APP_ACCESS_CODE` — PIN numérico para entrar a la app (protege el acceso público).

### GitHub — Secrets del repositorio (Settings → Secrets and variables → Actions)
- `DATABASE_URL` — la **External Database URL** de `cotizador-db` (Render → base de datos → Connections).
- `IMAP_USER`, `IMAP_PASSWORD`, `IMAP_HOST`, `IMAP_PORT` — credenciales del correo (GoDaddy).
- `PC_USUARIO`, `PC_CONTRASENA` — credenciales de proveedor en PanamaCompra.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — las mismas que en Render.
- `VAPID_SUBJECT` — `mailto:tu-correo@dominio.com`

## Despliegue

1. Sube este proyecto a un repositorio de GitHub.
2. En Render: **New > Blueprint**, conecta el repo. Render detecta `render.yaml` y crea
   el web service y la base de datos.
3. Completa las variables de entorno marcadas `sync: false` en el dashboard del web service.
4. Copia la **External Database URL** de `cotizador-db` (pestaña Connections de la base de datos).
5. En GitHub → Settings → Secrets and variables → Actions, agrega todos los secrets listados
   arriba (incluyendo esa External Database URL).
6. El workflow corre automáticamente según el horario. También puedes dispararlo manualmente
   desde la pestaña **Actions** del repo (`workflow_dispatch`) para probarlo de inmediato.
7. Abre la URL del servicio web desde tu celular, ingresa tu PIN y toca
   "Activar notificaciones" (agrega la página a la pantalla de inicio para que se sienta
   como app).

## Desarrollo local

No se recomienda correr esto localmente sin Postgres real. Para pruebas rápidas de UI se
usó una base de datos en memoria (`pg-mem`, no incluida en producción).

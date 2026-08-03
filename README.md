# Cotizador GS Technologies

App PWA para GS Technologies and Security Solutions: revisa el correo en busca de nuevas
"Solicitud de cotización en línea" de PanamaCompra, evalúa cada una contra el rubro de la
empresa y el precio de referencia, y notifica por push al celular. La decisión de
participar o no se toma en la app.

## Arquitectura

- **cotizador-web** (Render Web Service, gratis): sirve la PWA y la API REST.
- **cotizador-check-email** (Render Cron Job, gratis): corre cada hora L-V 7am-4pm
  (hora de Panamá), revisa el correo, consulta PanamaCompra y envía notificaciones push.
- **cotizador-db** (Render PostgreSQL, gratis): almacena oportunidades y suscripciones push.

## Variables de entorno requeridas

### Ambos servicios (web y cron)
- `DATABASE_URL` — la asigna Render automáticamente al vincular la base de datos.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — generadas con `npm run gen-vapid`.

### Solo el cron job
- `IMAP_USER`, `IMAP_PASSWORD`, `IMAP_HOST`, `IMAP_PORT` — credenciales del correo (GoDaddy).
- `PC_USUARIO`, `PC_CONTRASENA` — credenciales de proveedor en PanamaCompra.
- `VAPID_SUBJECT` — `mailto:tu-correo@dominio.com`

### Solo el web service
- `APP_ACCESS_CODE` — PIN numérico para entrar a la app (protege el acceso público).

## Despliegue en Render

1. Sube este proyecto a un repositorio de GitHub.
2. En Render: **New > Blueprint**, conecta el repo. Render detecta `render.yaml` y crea
   los 3 recursos automáticamente.
3. Completa las variables de entorno marcadas `sync: false` en el dashboard de cada servicio.
4. Al terminar el primer deploy, abre la URL del servicio web, ingresa tu PIN y toca
   "Activar notificaciones" desde tu celular (agrega la página a la pantalla de inicio
   para que se sienta como app).

## Desarrollo local

No se recomienda correr esto localmente sin Postgres real. Para pruebas rápidas de UI se
usó una base de datos en memoria (`pg-mem`, no incluida en producción).

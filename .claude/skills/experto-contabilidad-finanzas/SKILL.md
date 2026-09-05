---
name: experto-contabilidad-finanzas
description: Actúa como un experto en contabilidad de pequeñas empresas al trabajar en la sección Finanzas del cotizador (facturas, gastos, ganancia por proyecto, reporte anual). Úsalo cuando el usuario pida cambios al módulo de Finanzas, al reporte anual, a las gráficas de ganancia/gastos, o pida explícitamente comportarte como contador.
---

# Experto en contabilidad — módulo Finanzas del cotizador

Este skill aplica a cualquier trabajo sobre la sección **Finanzas** de `cotizador-app` (GS Technologies): `public/finanzas.html`/`finanzas.js`, `server/index.js` (endpoints `/api/finanzas/*`), y `shared/generateAnnualReportPdf.js`. Al tocar esta sección, razona y comunica como lo haría un contador de pequeñas empresas en Panamá, no solo como quien mueve números en una tabla.

## Terminología y estructura

- Usa terminología contable en español correcta y consistente: **Ingresos** (o "Emitido" si el dato viene de facturas emitidas), **Gastos**, **Utilidad Neta** (no solo "ganancia" a secas en documentos formales — "ganancia" está bien en la UI casual, pero el reporte anual debe leerse como un **Estado de Resultados** simplificado).
- Todo reporte o resumen financiero debe dejar claro, sin que el usuario tenga que inferirlo: de dónde sale cada cifra (¿incluye gastos generales o solo de proyecto? ¿es antes o después de ITBM?).
- Cuando un cálculo mezcla varias fuentes (ej. gastos de proyecto + gastos generales no asociados a ningún proyecto), sepáralas explícitamente en vez de solo mostrar el total combinado — un contador siempre puede explicar de qué se compone una cifra.

## El reporte anual (PDF)

El reporte anual (`generateAnnualReportPdf.js`) debe leerse como un documento financiero entregable, no como una captura de pantalla de la app:

1. **Encabezado con identidad de la empresa** — logo, nombre legal, período que cubre el reporte (año calendario completo). Ya implementado; mantener.
2. **Estado de Resultados resumido** — Ingresos totales, Gastos totales, Utilidad Neta del año, con una nota breve de qué incluye cada cifra.
3. **Detalle por proyecto** — tabla (proyecto, ingresos, gastos, utilidad) CON fila de totales, y una gráfica de barras de utilidad por proyecto (positivo y negativo, con línea base en cero).
4. **Gastos generales por mes** (los no asociados a ningún proyecto puntual — arriendo, planilla, servicios) — tabla de 12 meses y gráfica de barras, para ver estacionalidad y controlar gasto operativo fijo.
5. **Panorama anual** — una gráfica adicional, separada de las de detalle, que compare Ingresos vs. Gastos vs. Utilidad Neta del año en una sola vista (el resumen ejecutivo del documento, para alguien que solo tiene 10 segundos para mirarlo).
6. **Notas explicativas breves** junto a cada sección — una o dos líneas en tono profesional pero claro (no jerga innecesaria), explicando qué significa la cifra o de qué se compone, como pondría un contador al pie de un estado financiero.

No agregues secciones que la app todavía no puede calcular con datos reales (ej. depreciación, flujo de caja proyectado) — mejor un reporte simple y honesto sobre lo que sí se registra (facturas emitidas y gastos) que uno que aparente más sofisticación de la que hay detrás.

## Al proponer cambios nuevos a Finanzas

Antes de agregar un campo o cálculo nuevo, pregúntate qué haría un contador real: ¿esta cifra necesita descomponerse? ¿hace falta una nota aclaratoria? ¿el usuario va a poder explicarle este número a su contador de verdad (el humano que le hace la declaración de renta) sin tener que re-calcular nada a mano?

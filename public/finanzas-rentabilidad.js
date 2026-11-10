// Sección "Rentabilidad (sin ITBM)" de Finanzas: ingresos y gastos por
// separado, mensual o anual, con gráfica circular de rentabilidad y
// descarga PDF/Excel. Reusa $, escapeHtml, money y MESES de finanzas.js
// (se carga después), por eso va dentro de un IIFE y no los redeclara.
(function () {
  const modoBtns = document.querySelectorAll('.rent-seg button');
  let modo = 'mensual';

  // Colores por concepto: los mismos tres conceptos siempre llevan el mismo
  // color, aunque alguno no aparezca en el período.
  const SEGMENTOS = [
    { key: 'gastos_proyectos', label: 'Gastos de proyectos', color: 'var(--serie-proyectos)' },
    { key: 'gastos_generales', label: 'Gastos generales', color: 'var(--serie-generales)' },
    { key: 'ganancia', label: 'Ganancia', color: 'var(--serie-ganancia)' },
  ];

  function pct(n) {
    return `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  function fmtFecha(iso) {
    if (!iso) return 'Sin fecha';
    return new Date(iso + 'T00:00:00').toLocaleDateString('es-PA');
  }

  function query() {
    const p = new URLSearchParams({ anio: $('rentAnio').value });
    if (modo === 'mensual') p.set('mes', $('rentMes').value);
    return p.toString();
  }

  function donutSvg(partes, total, centroValor, centroLabel, negativo) {
    const size = 190, R = 88, r = 58, c = size / 2;
    let a0 = -Math.PI / 2;
    const pt = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)} ${(c + rad * Math.sin(a)).toFixed(2)}`;
    const paths = partes.map((p) => {
      const sweep = Math.min((p.value / total) * Math.PI * 2, Math.PI * 2 - 0.0001);
      const a1 = a0 + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const d = `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`;
      a0 = a1;
      return `<path d="${d}" fill="${p.color}"><title>${escapeHtml(p.label)}: ${money(p.value)} (${pct(p.pct)})</title></path>`;
    }).join('');
    return `
      <svg class="${partes.length === 1 ? 'una' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Gráfica de rentabilidad: ${escapeHtml(centroValor)} ${escapeHtml(centroLabel)}">
        ${paths}
        <text x="${c}" y="${c + 4}" text-anchor="middle" class="rent-centro-valor${negativo ? ' neg' : ''}">${escapeHtml(centroValor)}</text>
        <text x="${c}" y="${c + 22}" text-anchor="middle" class="rent-centro-label">${escapeHtml(centroLabel)}</text>
      </svg>`;
  }

  function graficaHtml(d) {
    const conGanancia = d.ganancia >= 0 && d.ingresos > 0;
    const partes = SEGMENTOS
      .filter((s) => conGanancia || s.key !== 'ganancia')
      .map((s) => ({ ...s, value: Math.max(0, d[s.key]) }))
      .filter((s) => s.value > 0);
    const total = partes.reduce((a, p) => a + p.value, 0);
    if (!total) return '<div class="rent-vacio">No hay ingresos ni gastos en este período.</div>';
    partes.forEach((p) => { p.pct = (p.value / total) * 100; });

    const centroValor = d.margen == null ? 'Sin ingresos' : pct(d.margen);
    const centroLabel = conGanancia ? 'margen' : `pérdida ${money(-d.ganancia)}`;
    const nota = conGanancia
      ? 'De cada balboa que entró: lo que se fue en gastos y lo que quedó de ganancia.'
      : 'Este período no dejó ganancia: el anillo muestra cómo se repartieron los gastos.';

    return `
      <div class="rent-chart">
        ${donutSvg(partes, total, centroValor, centroLabel, !conGanancia)}
        <ul class="rent-leyenda">
          ${partes.map((p) => `
            <li><span class="sw" style="background:${p.color}"></span>
              <div><b>${escapeHtml(p.label)}</b><span>${money(p.value)} · ${pct(p.pct)}</span></div></li>`).join('')}
        </ul>
      </div>
      <div class="rent-nota">${nota}</div>`;
  }

  function tablaMesesHtml(d) {
    const celda = (n, esPct) => {
      if (n == null) return '<td>—</td>';
      return `<td class="${n < 0 ? 'neg' : ''}">${esPct ? pct(n) : money(n)}</td>`;
    };
    return `
      <div class="rent-tabla-wrap">
        <table class="rent-tabla">
          <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ganancia</th><th>Margen</th></tr></thead>
          <tbody>
            ${d.por_mes.map((m) => `
              <tr data-mes="${m.mes}" title="Ver ${escapeHtml(m.nombre)} en detalle">
                <td>${escapeHtml(m.nombre)}</td><td>${money(m.ingresos)}</td><td>${money(m.gastos)}</td>
                ${celda(m.ganancia)}${celda(m.margen, true)}
              </tr>`).join('')}
          </tbody>
          <tfoot><tr><td>Total</td><td>${money(d.ingresos)}</td><td>${money(d.gastos)}</td>${celda(d.ganancia)}${celda(d.margen, true)}</tr></tfoot>
        </table>
      </div>
      <div class="rent-sub">Toca un mes para verlo en detalle.</div>`;
  }

  function listaHtml(id, titulo, facturas) {
    const filas = facturas.map((f) => `
      <div class="rent-fila">
        <span class="q">${escapeHtml(f.contraparte || 'Sin nombre')}
          <small>${fmtFecha(f.fecha)}${f.numero_factura ? ` · #${escapeHtml(f.numero_factura)}` : ''} · ${escapeHtml(f.proyecto || (f.tipo === 'emitida' ? 'Sin proyecto' : 'Gasto general'))}</small></span>
        <span class="m">${money(f.monto)}</span>
      </div>`).join('') || '<div class="rent-vacio">No hay facturas en este período.</div>';
    return `
      <div class="rent-lista-toggle" data-lista="${id}">Ver ${titulo.toLowerCase()} del período (${facturas.length}) ▾</div>
      <div class="rent-lista" id="${id}">${filas}</div>`;
  }

  function render(d) {
    const esGanancia = d.ganancia >= 0;
    $('rentBody').innerHTML = `
      <div class="resumen-grid">
        <div class="resumen-box emitido"><div class="label">Ingresos</div><div class="valor">${money(d.ingresos)}</div>
          <div class="rent-sub">${d.ingresos_detalle.length} factura(s)</div></div>
        <div class="resumen-box gastos"><div class="label">Gastos</div><div class="valor">${money(d.gastos)}</div>
          <div class="rent-sub">${d.gastos_detalle.length} gasto(s)</div></div>
        <div class="resumen-box ganancia"><div class="label">${esGanancia ? 'Ganancia' : 'Pérdida'}</div>
          <div class="valor" style="${esGanancia ? '' : 'color:var(--red)'}">${money(d.ganancia)}</div>
          <div class="rent-sub">${d.margen == null ? 'Sin ingresos' : `Margen ${pct(d.margen)}`}</div></div>
      </div>
      ${graficaHtml(d)}
      ${d.por_mes ? tablaMesesHtml(d) : ''}
      ${listaHtml('rentListaIngresos', 'Ingresos', d.ingresos_detalle)}
      ${listaHtml('rentListaGastos', 'Gastos', d.gastos_detalle)}
    `;

    $('rentBody').querySelectorAll('.rent-lista-toggle').forEach((t) => {
      t.addEventListener('click', () => $(t.dataset.lista).classList.toggle('show'));
    });
    $('rentBody').querySelectorAll('.rent-tabla tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => {
        $('rentMes').value = tr.dataset.mes;
        setModo('mensual');
      });
    });
  }

  async function loadRentabilidad() {
    if (!$('rentAnio').value) return;
    const q = query();
    $('rentPdf').href = `/api/finanzas/rentabilidad/pdf?${q}`;
    $('rentExcel').href = `/api/finanzas/rentabilidad/excel?${q}`;
    try {
      const res = await fetch(`/api/finanzas/rentabilidad?${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error calculando la rentabilidad');
      if (q !== query()) return; // el usuario cambió el período mientras cargaba
      render(data);
    } catch (err) {
      $('rentBody').innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    }
  }

  function setModo(nuevo) {
    modo = nuevo;
    modoBtns.forEach((b) => b.classList.toggle('activo', b.dataset.modo === modo));
    $('rentMes').style.display = modo === 'mensual' ? '' : 'none';
    loadRentabilidad();
  }

  async function init() {
    const hoy = new Date();
    let anios = [];
    try {
      const res = await fetch('/api/finanzas/rentabilidad/anios');
      if (res.ok) anios = await res.json();
    } catch (e) { /* si falla, al menos el año actual */ }
    if (!anios.includes(hoy.getFullYear())) anios.unshift(hoy.getFullYear());
    anios.sort((a, b) => b - a);
    $('rentAnio').innerHTML = anios.map((a) => `<option value="${a}">${a}</option>`).join('');
    $('rentAnio').value = String(hoy.getFullYear());
    $('rentMes').innerHTML = MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    $('rentMes').value = String(hoy.getMonth() + 1);

    modoBtns.forEach((b) => b.addEventListener('click', () => setModo(b.dataset.modo)));
    $('rentAnio').addEventListener('change', loadRentabilidad);
    $('rentMes').addEventListener('change', loadRentabilidad);
    window.loadRentabilidad = loadRentabilidad;
    loadRentabilidad();
  }

  init();
})();

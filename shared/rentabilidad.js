// Rentabilidad de un período (un mes o un año completo): ingresos (facturas
// emitidas) vs gastos, por separado, SIN ITBM -- decisión del usuario
// 2026-11-09: el ITBM se cobra/paga por cuenta de la DGI, no es ganancia ni
// costo de la empresa, así que la rentabilidad se mide sobre el subtotal.
// Compartido por la pantalla de Finanzas y las descargas PDF/Excel para que
// los tres muestren exactamente los mismos números.

// Monto sin ITBM de una factura. Los gastos cargados a mano a veces solo
// tienen total (sin desglose): ahí se usa total - itbm, y si tampoco hay
// itbm, el total tal cual (un gasto sin factura normalmente no lleva ITBM).
const MONTO_SIN_ITBM_SQL = 'COALESCE(subtotal, total - COALESCE(itbm, 0), total, 0)';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function margen(ingresos, ganancia) {
  return ingresos > 0 ? round2((ganancia / ingresos) * 100) : null;
}

// anio: número de 4 dígitos; mes: 1-12 o null para el año completo.
function validarPeriodo(anioRaw, mesRaw) {
  const anio = Number(anioRaw);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw Object.assign(new Error('Año inválido'), { status: 400 });
  let mes = null;
  if (mesRaw != null && mesRaw !== '') {
    mes = Number(mesRaw);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw Object.assign(new Error('Mes inválido'), { status: 400 });
  }
  return { anio, mes };
}

function rangoFechas({ anio, mes }) {
  const pad = (n) => String(n).padStart(2, '0');
  if (mes == null) return [`${anio}-01-01`, `${anio + 1}-01-01`];
  const finAnio = mes === 12 ? anio + 1 : anio;
  const finMes = mes === 12 ? 1 : mes + 1;
  return [`${anio}-${pad(mes)}-01`, `${finAnio}-${pad(finMes)}-01`];
}

// La fecha se arma de año/mes/día (EXTRACT en SQL) a propósito: si llega
// como Date, el driver la ubica a medianoche de algún huso horario y al
// formatearla se corre un día (probado: el 1-nov salía como 31-oct y caía
// en el mes equivocado).
function fechaIso(r) {
  if (r.f_y == null) return '';
  const pad = (n) => String(Number(n)).padStart(2, '0');
  return `${Number(r.f_y)}-${pad(r.f_m)}-${pad(r.f_d)}`;
}

function totalesDe(facturas) {
  let ingresos = 0, gastosProyectos = 0, gastosGenerales = 0;
  for (const f of facturas) {
    if (f.tipo === 'emitida') ingresos += f.monto;
    else if (f.proyecto) gastosProyectos += f.monto;
    else gastosGenerales += f.monto;
  }
  const gastos = gastosProyectos + gastosGenerales;
  const ganancia = ingresos - gastos;
  return {
    ingresos: round2(ingresos),
    gastos: round2(gastos),
    gastos_proyectos: round2(gastosProyectos),
    gastos_generales: round2(gastosGenerales),
    ganancia: round2(ganancia),
    margen: margen(ingresos, ganancia),
  };
}

async function calcularRentabilidad(pool, periodoRaw, companyId) {
  const periodo = validarPeriodo(periodoRaw.anio, periodoRaw.mes);
  const [desde, hasta] = rangoFechas(periodo);
  const { rows } = await pool.query(
    `SELECT id, tipo, EXTRACT(YEAR FROM fecha) AS f_y, EXTRACT(MONTH FROM fecha) AS f_m, EXTRACT(DAY FROM fecha) AS f_d, contraparte, numero_factura, proyecto,
            total, itbm, ${MONTO_SIN_ITBM_SQL} AS monto
     FROM finance_invoices
     WHERE company_id = $1 AND fecha >= $2 AND fecha < $3
     ORDER BY fecha, id`,
    [companyId, desde, hasta]
  );

  const facturas = rows.map((r) => ({
    id: r.id,
    tipo: r.tipo,
    fecha: fechaIso(r),
    contraparte: r.contraparte || '',
    numero_factura: r.numero_factura || '',
    proyecto: (r.proyecto || '').trim(),
    monto: round2(r.monto),
    itbm: r.itbm == null ? null : round2(r.itbm),
    total: r.total == null ? null : round2(r.total),
  }));

  const resultado = {
    periodo: {
      anio: periodo.anio,
      mes: periodo.mes,
      label: periodo.mes ? `${MESES[periodo.mes - 1]} ${periodo.anio}` : `Año ${periodo.anio}`,
    },
    ...totalesDe(facturas),
    ingresos_detalle: facturas.filter((f) => f.tipo === 'emitida'),
    gastos_detalle: facturas.filter((f) => f.tipo === 'gasto'),
    por_mes: null,
  };

  if (periodo.mes == null) {
    resultado.por_mes = MESES.map((nombre, i) => {
      const prefijo = `${periodo.anio}-${String(i + 1).padStart(2, '0')}`;
      return { mes: i + 1, nombre, ...totalesDe(facturas.filter((f) => f.fecha.startsWith(prefijo))) };
    });
  }

  return resultado;
}

async function aniosConFacturas(pool, companyId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT EXTRACT(YEAR FROM fecha)::int AS anio FROM finance_invoices
     WHERE company_id = $1 AND fecha IS NOT NULL ORDER BY anio DESC`,
    [companyId]
  );
  return rows.map((r) => Number(r.anio));
}

module.exports = { calcularRentabilidad, aniosConFacturas, MESES };

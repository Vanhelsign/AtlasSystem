import { useState } from "react";
import { fmt, fmtNumero } from "./ui.js";

// Colores de la gráfica, validados con el verificador de paletas (separación para daltonismo ΔE 31.7, contraste ≥ 3:1).
const COLOR_ANTES = "#4F46E5";
const COLOR_RECUPERADO = "#16A34A";
const COLOR_COSTO = "#B45309";
const COLOR_REJILLA = "#E2E8F0";

const SIMPLIFICACIONES = [
  "La generación solar se reparte por igual en los 12 meses, sin variación por temporada.",
  "El cálculo es mensual aunque el recibo de CFE sea bimestral.",
  "La tarifa de alto consumo (DAC) se evalúa con un solo mes, no con el promedio de 12 meses que usa CFE.",
  "No se incluyen el cobro mínimo ni el derecho de alumbrado público.",
  "La potencia de los paneles es la del catálogo al emitir la cotización.",
  "La energía generada por encima de tu consumo no se paga ni se acumula.",
];

const compacto = (valor) => new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1, style: "currency", currency: "MXN" }).format(valor);

function pasoAgradable(maximo, marcas = 4) {
  const bruto = maximo / marcas;
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const normalizado = bruto / magnitud;
  return (normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10) * magnitud;
}

// Barra con la punta redondeada (4 px) y la base recta sobre el eje.
function rutaBarra(x, y, ancho, alto, radio = 4) {
  if (alto <= 0) return "";
  const r = Math.min(radio, ancho / 2, alto);
  return `M${x},${y + alto} V${y + r} Q${x},${y} ${x + r},${y} H${x + ancho - r} Q${x + ancho},${y} ${x + ancho},${y + r} V${y + alto} Z`;
}

function GraficaAhorro({ serie, precio, recuperacion }) {
  const [activo, setActivo] = useState(null);
  const ancho = 640;
  const alto = 280;
  const margen = { arriba: 16, derecha: 12, abajo: 32, izquierda: 60 };
  const anchoArea = ancho - margen.izquierda - margen.derecha;
  const altoArea = alto - margen.arriba - margen.abajo;
  const maximo = Math.max(precio, ...serie.map((fila) => fila.acumulado)) * 1.08;
  const paso = pasoAgradable(maximo);
  const tope = Math.ceil(maximo / paso) * paso;
  const marcas = Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso);
  const y = (valor) => margen.arriba + altoArea - (valor / tope) * altoArea;
  const banda = anchoArea / serie.length;
  const anchoBarra = Math.min(24, banda * 0.6);
  const cadaEtiqueta = serie.length > 20 ? 5 : serie.length > 12 ? 2 : 1;
  const yCosto = y(precio);
  const filaActiva = activo === null ? null : serie[activo];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="h-auto w-full" role="img" aria-label={`Ahorro acumulado por año durante ${serie.length} años frente al costo del proyecto de ${fmt(precio)}`}>
        {marcas.map((marca) => (
          <g key={marca}>
            <line x1={margen.izquierda} x2={ancho - margen.derecha} y1={y(marca)} y2={y(marca)} stroke={COLOR_REJILLA} strokeWidth="1" />
            <text x={margen.izquierda - 8} y={y(marca)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[11px]">{compacto(marca)}</text>
          </g>
        ))}
        {serie.map((fila, indice) => {
          const xBanda = margen.izquierda + indice * banda;
          const x = xBanda + (banda - anchoBarra) / 2;
          const altoBarra = y(0) - y(fila.acumulado);
          const recuperado = fila.acumulado >= precio;
          return (
            <g key={fila.anio}>
              <path d={rutaBarra(x, y(fila.acumulado), anchoBarra, altoBarra)} fill={recuperado ? COLOR_RECUPERADO : COLOR_ANTES} opacity={activo === null || activo === indice ? 1 : 0.55} />
              {(fila.anio % cadaEtiqueta === 0 || fila.anio === 1) && (
                <text x={xBanda + banda / 2} y={alto - margen.abajo + 18} textAnchor="middle" className="fill-slate-600 text-[11px]">{serie.length > 12 ? fila.anio : `Año ${fila.anio}`}</text>
              )}
              {/* Zona de interacción más grande que la barra: toda la banda del año. */}
              <rect
                x={xBanda} y={margen.arriba} width={banda} height={altoArea} fill="transparent" tabIndex={0}
                aria-label={`Año ${fila.anio}: ahorro acumulado ${fmt(fila.acumulado)}`}
                onPointerEnter={() => setActivo(indice)} onPointerLeave={() => setActivo(null)}
                onFocus={() => setActivo(indice)} onBlur={() => setActivo(null)}
                className="cursor-default outline-none focus-visible:stroke-indigo-400"
              />
            </g>
          );
        })}
        <line x1={margen.izquierda} x2={ancho - margen.derecha} y1={yCosto} y2={yCosto} stroke={COLOR_COSTO} strokeWidth="2" strokeLinecap="round" pointerEvents="none" />
        <text x={margen.izquierda + 6} y={yCosto - 6} className="fill-slate-700 text-[11px] font-semibold" pointerEvents="none">Costo del proyecto · {fmt(precio)}</text>
        <line x1={margen.izquierda} x2={ancho - margen.derecha} y1={y(0)} y2={y(0)} stroke="#94A3B8" strokeWidth="1" />
      </svg>
      {filaActiva && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((margen.izquierda + (activo + 0.5) * banda) / ancho) * 100}%` }}
        >
          <p className="font-semibold text-slate-900">Año {filaActiva.anio}</p>
          <p className="text-slate-600"><b className="text-slate-900">{fmt(filaActiva.acumulado)}</b> acumulado</p>
          <p className="text-slate-600"><b className="text-slate-900">{fmt(filaActiva.ahorro)}</b> ahorro del año</p>
          <p className="mt-1 text-slate-500">{filaActiva.acumulado >= precio ? "Inversión recuperada" : `Faltan ${fmt(precio - filaActiva.acumulado)}`}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: COLOR_ANTES }} />Antes de recuperar la inversión</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: COLOR_RECUPERADO }} />Inversión recuperada</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: COLOR_COSTO }} />Costo del proyecto</span>
        <span className="ml-auto rounded bg-green-50 px-2 py-1 font-semibold text-green-800">{recuperacion === null ? "Sin recuperación en el periodo mostrado" : `Recuperación: año ${Math.ceil(recuperacion)}`}</span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-indigo-700">Ver la tabla de datos</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="border-b text-slate-500"><tr><th className="py-1">Año</th><th className="py-1 text-right">Ahorro del año</th><th className="py-1 text-right">Ahorro acumulado</th></tr></thead>
          <tbody className="divide-y">{serie.map((fila) => <tr key={fila.anio}><td className="py-1">{fila.anio}</td><td className="py-1 text-right">{fmt(fila.ahorro)}</td><td className="py-1 text-right">{fmt(fila.acumulado)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, color }) {
  return (
    <div className="flex gap-3 rounded-2xl border bg-white p-5">
      <span className="w-1 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-slate-800">{titulo}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{valor}</p>
        <p className="mt-1 text-xs text-slate-500">{nota}</p>
      </div>
    </div>
  );
}

function Contenedor({ children, onVolver }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Ahorro y retorno de inversión</h1>
        <p className="mt-2 text-sm text-slate-500">Conoce una estimación de lo que podrías ahorrar con tu sistema solar.</p>
      </div>
      {children}
      <div className="flex justify-end">
        <button type="button" onClick={onVolver} className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">Volver a mi cotización</button>
      </div>
    </div>
  );
}

export default function AhorroInversion({ datos, cargando, error, onVolver }) {
  if (cargando) return <Contenedor onVolver={onVolver}><p className="rounded-xl border bg-white p-5 text-sm text-slate-600">Cargando información…</p></Contenedor>;
  if (error) return <Contenedor onVolver={onVolver}><p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{error}</p></Contenedor>;

  const cotizacion = datos?.cotizacion_emitida;
  const ahorro = cotizacion?.ahorro;
  if (!cotizacion) {
    return <Contenedor onVolver={onVolver}><p className="rounded-xl border bg-white p-5 text-sm text-slate-600">Tu cotización todavía está en preparación. La estimación de ahorro aparecerá aquí cuando la recibas.</p></Contenedor>;
  }
  if (ahorro?.estado !== "calculada" || !ahorro.resultado) {
    const mensajes = {
      tarifa_sin_precios: "La estimación de ahorro todavía no está disponible: la tarifa de CFE considerada para tu cotización no tenía precios capturados. Tu asesor puede compartirte una estimación actualizada.",
      sin_paneles: "Tu cotización no incluye paneles solares con potencia registrada, por lo que no hay generación ni ahorro que estimar.",
    };
    return (
      <Contenedor onVolver={onVolver}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-semibold text-amber-900">Estimación no disponible</p>
          <p className="mt-2 text-sm text-amber-900">{mensajes[ahorro?.estado] ?? ahorro?.motivo ?? "Esta cotización no incluye una estimación de ahorro."}</p>
        </div>
      </Contenedor>
    );
  }

  const r = ahorro.resultado;
  const recuperacion = r.retorno_inversion_anios;
  const preliminar = ahorro.tarifa?.pendiente_validar || ahorro.irradiacion?.fuente?.startsWith("valor por defecto");
  const datosEstimacion = [
    ["Consumo considerado", `${fmtNumero(ahorro.consumo_mensual_kwh, 1)} kWh/mes`, "Lo que pagas hoy"],
    ["Consumo objetivo", ahorro.consumo_objetivo_kwh ? `${fmtNumero(ahorro.consumo_objetivo_kwh, 1)} kWh/mes` : "No registrado", "Con margen de crecimiento; usado para dimensionar"],
    ["Generación solar anual", `${fmtNumero(r.generacion_anual_kwh)} kWh`, `${fmtNumero(r.kwp, 2)} kWp instalados`],
    ["Gasto CFE sin sistema", `${fmt(r.gasto_mensual_sin_sistema)} /mes`, r.dac_sin_sistema ? "Tarifa de alto consumo (DAC)" : "IVA incluido"],
    ["Gasto CFE con sistema", `${fmt(r.gasto_mensual_con_sistema)} /mes`, r.generacion_supera_consumo ? "Solo cargos fijos: generas más de lo que consumes" : "IVA incluido"],
  ];

  return (
    <Contenedor onVolver={onVolver}>
      <section className="flex flex-col gap-4 rounded-2xl border bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">Pago de contado</span>
          <p className="mt-3 font-semibold text-slate-900">Inversión inicial estimada</p>
          <p className="text-sm text-slate-500">Monto de la cotización que recibiste</p>
        </div>
        <div className="sm:text-right">
          <p className="text-4xl font-bold text-indigo-700">{fmt(cotizacion.precio_venta)}</p>
          <p className="text-sm text-slate-500">Pago único, IVA incluido</p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Tarjeta titulo="Ahorro mensual estimado" valor={fmt(r.ahorro_mensual)} nota="Según tu consumo y la tarifa considerada" color={COLOR_ANTES} />
        <Tarjeta titulo="Ahorro anual estimado" valor={fmt(r.ahorro_anual)} nota="Equivalente aproximado de doce meses" color={COLOR_RECUPERADO} />
        <Tarjeta titulo="Tiempo de recuperación" valor={recuperacion === null ? "Más de 30 años" : `${fmtNumero(recuperacion, 1)} años`} nota="Ahorro acumulado frente a la inversión" color={COLOR_ANTES} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Proyección del ahorro acumulado</h2>
          <p className="mb-4 text-sm text-slate-500">Comparación ilustrativa entre el ahorro y el costo del proyecto.</p>
          <GraficaAhorro serie={r.serie} precio={cotizacion.precio_venta} recuperacion={recuperacion} />
        </section>
        <section className="space-y-3 rounded-2xl border bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Datos de la estimación</h2>
          {datosEstimacion.map(([etiqueta, valor, nota]) => (
            <div key={etiqueta} className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{etiqueta}</p>
              <p className="font-semibold text-slate-900">{valor}</p>
              <p className="text-xs text-slate-500">{nota}</p>
            </div>
          ))}
          <p className="text-xs text-slate-500">
            Tarifa considerada: <b>{ahorro.tarifa?.codigo}</b> {ahorro.tarifa?.nombre ? `(${ahorro.tarifa.nombre})` : ""}. {fmtNumero(ahorro.irradiacion?.hsp ?? 0, 2)} horas solares pico al día.
          </p>
          {preliminar && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Cifras preliminares: {ahorro.tarifa?.pendiente_validar ? "la tarifa todavía no se valida con un recibo de CFE" : ""}{ahorro.tarifa?.pendiente_validar && ahorro.irradiacion?.fuente?.startsWith("valor por defecto") ? " y " : ""}{ahorro.irradiacion?.fuente?.startsWith("valor por defecto") ? "la radiación solar es un valor de referencia" : ""}.</p>}
        </section>
      </div>

      <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-6">
        <h2 className="text-lg font-semibold text-slate-900">¿Cómo se estima el retorno?</h2>
        <p className="mt-2 text-sm text-slate-700">El ahorro anual compara el gasto eléctrico estimado antes y después del sistema, con la tarifa de CFE por bloques y el IVA incluidos. El tiempo de recuperación relaciona ese ahorro con el pago inicial de contado, considerando que los paneles pierden {fmtNumero((ahorro.parametros?.degradacion_anual ?? 0) * 100, 1)}% de generación cada año.</p>
        <p className="mt-3 text-sm font-semibold text-slate-800">Cifras aproximadas: pueden variar según tu consumo real, la tarifa vigente y la generación real. Esta proyección orienta la decisión y no representa un ahorro garantizado.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
          {SIMPLIFICACIONES.map((texto) => <li key={texto}>{texto}</li>)}
        </ul>
      </section>
    </Contenedor>
  );
}

import { useState } from "react";
import { aplicaDac, costoEnergia, costoMensual, faltantesDeTarifa } from "../shared/ahorroSolar.js";
import { convertirRecibo, MAX_ESCALONES } from "../shared/reciboCfe.js";
import Modal from "./Modal.jsx";
import { MAX_BLOQUES, nombreBloque, ORDEN_TEMPORADAS, ORIGENES, TEMPORADAS, texto, TIPOS_TARIFA } from "./tarifasComunes.js";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO, ETIQUETA, fmtCentavos, fmtNumero } from "./ui.js";

// kWh con hasta 3 decimales y sin ceros sobrantes (75 en lugar de 75.000).
const kwh = (valor) => new Intl.NumberFormat("es-MX", { maximumFractionDigits: 3 }).format(valor);
const vacio = (valor) => valor === "" || valor === null || valor === undefined;
const numeroValido = (valor) => !vacio(valor) && Number.isFinite(Number(valor));
const ERROR = "mt-1 block text-xs font-normal text-red-600";
const CAMPO_ERROR = `${CAMPO} border-red-400 bg-red-50`;

function juegosIniciales(tarifa) {
  const bloques = tarifa?.bloques?.length ? tarifa.bloques : [
    { temporada: "todo_el_anio", orden: 1, hasta_kwh: 75, precio_kwh: null },
    { temporada: "todo_el_anio", orden: 2, hasta_kwh: 140, precio_kwh: null },
    { temporada: "todo_el_anio", orden: 3, hasta_kwh: null, precio_kwh: null },
  ];
  const juegos = {};
  for (const temporada of ORDEN_TEMPORADAS) {
    const lista = bloques.filter((bloque) => bloque.temporada === temporada).sort((a, b) => a.orden - b.orden);
    if (lista.length) {
      juegos[temporada] = lista.map((bloque) => ({
        hasta: texto(bloque.hasta_kwh),
        precio: texto(bloque.precio_kwh),
        // Un precio nuevo arranca como dato de prueba; uno guardado sin origen queda "sin especificar".
        origen: bloque.origen_precio ?? (bloque.precio_kwh === null || bloque.precio_kwh === undefined ? "prueba" : ""),
      }));
    }
  }
  return juegos;
}

// Inicio de cada bloque: 0 para el primero y el límite del anterior para los demás (no editable).
const desdeDe = (filas, indice) => indice === 0 ? 0 : numeroValido(filas[indice - 1].hasta) ? Number(filas[indice - 1].hasta) : null;

function erroresFila(filas, indice) {
  const fila = filas[indice];
  const errores = {};
  const ultimo = indice === filas.length - 1;
  const desde = desdeDe(filas, indice);
  if (!ultimo) {
    if (vacio(fila.hasta)) errores.hasta = "Escribe el límite superior";
    else if (!numeroValido(fila.hasta)) errores.hasta = "Debe ser un número";
    else if (desde !== null && Number(fila.hasta) <= desde) errores.hasta = `Debe ser mayor que ${kwh(desde)} kWh`;
  }
  if (!vacio(fila.precio) && (!numeroValido(fila.precio) || Number(fila.precio) < 0)) errores.precio = "Debe ser un número no negativo";
  return errores;
}

function estadoFila(filas, indice) {
  if (Object.keys(erroresFila(filas, indice)).length) return ["con errores", "bg-red-50 text-red-700"];
  if (vacio(filas[indice].precio)) return ["falta precio", "bg-amber-50 text-amber-800"];
  return ["completo", "bg-green-50 text-green-700"];
}

function bloquesDe(juegos) {
  return Object.entries(juegos).flatMap(([temporada, filas]) => filas.map((fila, indice) => ({
    temporada,
    orden: indice + 1,
    desde_kwh: indice === 0 ? 0 : filas[indice - 1].hasta,
    hasta_kwh: indice === filas.length - 1 ? null : fila.hasta,
    precio_kwh: fila.precio,
    origen_precio: vacio(fila.precio) ? null : fila.origen || null,
  })));
}

function SelectorOrigen({ valor, onCambiar, deshabilitado, etiqueta }) {
  return (
    <select value={valor} onChange={(event) => onCambiar(event.target.value)} disabled={deshabilitado} aria-label={etiqueta} className={`${CAMPO} ${valor === "" && !deshabilitado ? "border-amber-400" : ""}`}>
      {valor === "" && <option value="">Sin especificar</option>}
      {Object.entries(ORIGENES).map(([clave, nombre]) => <option key={clave} value={clave}>{nombre}</option>)}
    </select>
  );
}

function EditorBloques({ temporada, filas, mostrarErrores, onCambiar }) {
  const cambiarFila = (indice, campo, valor) => onCambiar(filas.map((fila, i) => i === indice ? { ...fila, [campo]: valor } : fila));
  return (
    <fieldset className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">{TEMPORADAS[temporada]}</legend>
      {filas.map((fila, indice) => {
        const ultimo = indice === filas.length - 1;
        const desde = desdeDe(filas, indice);
        const nombre = nombreBloque(indice, filas.length);
        const errores = erroresFila(filas, indice);
        const [estado, colorEstado] = estadoFila(filas, indice);
        const errorHasta = errores.hasta && (mostrarErrores || !vacio(fila.hasta)) ? errores.hasta : null;
        const etiqueta = `${nombre} (${TEMPORADAS[temporada]})`;
        return (
          <div key={indice} className="rounded-lg bg-slate-50 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{nombre} <span className="font-normal text-slate-500">· desde {desde === null ? "…" : kwh(desde)} kWh</span></p>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${colorEstado}`}>{estado}</span>
                <button type="button" disabled={filas.length === 1} onClick={() => onCambiar(filas.filter((_, i) => i !== indice))} aria-label={`Quitar ${etiqueta}`} className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30">Quitar</button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium">Hasta (kWh/mes)
                {ultimo
                  ? <span className="mt-1 block rounded-lg border border-dashed bg-white px-3 py-2 text-sm text-slate-500">Sin límite</span>
                  : <input type="number" min="0" step="any" value={fila.hasta} onChange={(event) => cambiarFila(indice, "hasta", event.target.value)} aria-label={`Límite superior de ${etiqueta}`} aria-invalid={Boolean(errorHasta)} className={errorHasta ? CAMPO_ERROR : CAMPO} />}
                {errorHasta && <span className={ERROR}>{errorHasta}</span>}
              </label>
              <label className="text-xs font-medium">Precio $/kWh sin IVA
                <input type="number" min="0" step="any" value={fila.precio} onChange={(event) => cambiarFila(indice, "precio", event.target.value)} placeholder="Sin capturar" aria-label={`Precio de ${etiqueta}`} aria-invalid={Boolean(errores.precio)} className={errores.precio ? CAMPO_ERROR : CAMPO} />
                {errores.precio && <span className={ERROR}>{errores.precio}</span>}
              </label>
              <label className="text-xs font-medium">Origen del precio
                <SelectorOrigen valor={vacio(fila.precio) ? "prueba" : fila.origen} deshabilitado={vacio(fila.precio)} etiqueta={`Origen del precio de ${etiqueta}`} onCambiar={(valor) => cambiarFila(indice, "origen", valor)} />
                {!vacio(fila.precio) && fila.origen === "" && <span className="mt-1 block text-xs font-normal text-amber-700">Indica si es de prueba o de un recibo</span>}
              </label>
            </div>
          </div>
        );
      })}
      <button type="button" disabled={filas.length >= MAX_BLOQUES} onClick={() => onCambiar([...filas, { hasta: "", precio: "", origen: "prueba" }])} className="text-xs font-semibold text-indigo-700 hover:underline disabled:text-slate-400 disabled:no-underline">
        {filas.length >= MAX_BLOQUES ? `Máximo ${MAX_BLOQUES} bloques` : "+ Agregar bloque"}
      </button>
    </fieldset>
  );
}

// Captura los escalones tal como aparecen en el recibo y muestra su conversión a mensual sin IVA.
function CapturaRecibo({ temporadas, iva, onAplicar }) {
  const [recibo, setRecibo] = useState({ periodo: "bimestral", conIva: true, temporada: temporadas[0], cargoFijo: "", escalones: [{ kwh: "", precio: "" }, { kwh: "", precio: "" }, { kwh: "", precio: "" }] });
  const [intento, setIntento] = useState(false);
  const conversion = convertirRecibo({ escalones: recibo.escalones, periodo: recibo.periodo, preciosConIva: recibo.conIva, iva, cargoFijo: recibo.cargoFijo });
  const errorDe = (indice, campo) => conversion.errores.find((error) => error.indice === indice && error.campo === campo)?.mensaje;
  const cambiarEscalon = (indice, campo, valor) => setRecibo({ ...recibo, escalones: recibo.escalones.map((escalon, i) => i === indice ? { ...escalon, [campo]: valor } : escalon) });
  const multiplicador = recibo.periodo === "bimestral" ? "bimestre" : "mes";

  const aplicar = () => {
    setIntento(true);
    if (conversion.errores.length) return;
    onAplicar(recibo.temporada, conversion);
  };

  return (
    <div className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <p className="text-sm text-slate-700">Copia los escalones como aparecen en tu recibo. ATLAS los convierte a valores mensuales sin IVA, que es como se guarda la tarifa.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={ETIQUETA}>Periodo del recibo
          <select value={recibo.periodo} onChange={(event) => setRecibo({ ...recibo, periodo: event.target.value })} className={CAMPO}>
            <option value="bimestral">Bimestral (dos meses)</option>
            <option value="mensual">Mensual</option>
          </select>
        </label>
        <label className={ETIQUETA}>Precios del recibo
          <select value={recibo.conIva ? "con" : "sin"} onChange={(event) => setRecibo({ ...recibo, conIva: event.target.value === "con" })} className={CAMPO}>
            <option value="con">Con IVA incluido ({fmtNumero(iva * 100)}%)</option>
            <option value="sin">Sin IVA</option>
          </select>
        </label>
        {temporadas.length > 1 && (
          <label className={ETIQUETA}>Aplicar a
            <select value={recibo.temporada} onChange={(event) => setRecibo({ ...recibo, temporada: event.target.value })} className={CAMPO}>
              {temporadas.map((temporada) => <option key={temporada} value={temporada}>{TEMPORADAS[temporada]}</option>)}
            </select>
          </label>
        )}
      </div>
      {recibo.escalones.map((escalon, indice) => {
        const ultimo = indice === recibo.escalones.length - 1;
        const nombre = nombreBloque(indice, recibo.escalones.length);
        const errorKwh = errorDe(indice, "kwh");
        const errorPrecio = errorDe(indice, "precio");
        return (
          <div key={indice} className="grid items-start gap-2 sm:grid-cols-[130px_1fr_1fr_auto]">
            <p className="text-sm font-medium sm:pt-7">{nombre}</p>
            <label className="text-xs font-medium">kWh del escalón en el {multiplicador}
              {ultimo
                ? <span className="mt-1 block rounded-lg border border-dashed bg-white px-3 py-2 text-sm text-slate-500">Sin límite (lo demás)</span>
                : <input type="number" min="0" step="any" value={escalon.kwh} onChange={(event) => cambiarEscalon(indice, "kwh", event.target.value)} aria-label={`kWh de ${nombre} en el recibo`} className={errorKwh && (intento || !vacio(escalon.kwh)) ? CAMPO_ERROR : CAMPO} />}
              {errorKwh && (intento || !vacio(escalon.kwh)) && <span className={ERROR}>{errorKwh}</span>}
            </label>
            <label className="text-xs font-medium">Precio por kWh en el recibo
              <input type="number" min="0" step="any" value={escalon.precio} onChange={(event) => cambiarEscalon(indice, "precio", event.target.value)} aria-label={`Precio de ${nombre} en el recibo`} className={errorPrecio ? CAMPO_ERROR : CAMPO} />
              {errorPrecio && <span className={ERROR}>{errorPrecio}</span>}
            </label>
            <button type="button" disabled={recibo.escalones.length === 1} onClick={() => setRecibo({ ...recibo, escalones: recibo.escalones.filter((_, i) => i !== indice) })} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30 sm:mt-6">Quitar</button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <button type="button" disabled={recibo.escalones.length >= MAX_ESCALONES} onClick={() => setRecibo({ ...recibo, escalones: [...recibo.escalones, { kwh: "", precio: "" }] })} className="text-xs font-semibold text-indigo-700 hover:underline disabled:text-slate-400">+ Agregar escalón</button>
        <label className="text-xs font-medium">Cargo fijo del recibo (opcional)
          <input type="number" min="0" step="any" value={recibo.cargoFijo} onChange={(event) => setRecibo({ ...recibo, cargoFijo: event.target.value })} aria-label="Cargo fijo del recibo" className={`${CAMPO} sm:w-44`} />
        </label>
      </div>

      <div className="rounded-lg bg-white p-3">
        <p className="text-sm font-semibold">Valores convertidos (mensual, sin IVA)</p>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Bloque</th><th className="py-1">Desde</th><th className="py-1">Hasta</th><th className="py-1 text-right">Precio sin IVA</th></tr></thead>
          <tbody className="divide-y">
            {conversion.bloques.map((bloque, indice) => (
              <tr key={bloque.orden}>
                <td className="py-1">{nombreBloque(indice, conversion.bloques.length)}</td>
                <td className="py-1">{kwh(bloque.desde_kwh)} kWh</td>
                <td className="py-1">{bloque.hasta_kwh === null ? (indice === conversion.bloques.length - 1 ? "Sin límite" : "—") : `${kwh(bloque.hasta_kwh)} kWh`}</td>
                <td className="py-1 text-right">{bloque.precio_kwh === null ? <span className="text-amber-700">sin capturar</span> : `$${fmtNumero(bloque.precio_kwh, 4)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">
          Cargo fijo mensual sin IVA: <b>{conversion.cargo_fijo_mensual === null ? "sin capturar" : fmtCentavos(conversion.cargo_fijo_mensual)}</b>.
          {recibo.periodo === "bimestral" && " Los kWh de cada escalón y el cargo fijo se dividieron entre 2."}
          {recibo.conIva && ` Los precios se dividieron entre ${fmtNumero(1 + iva, 2)} para quitar el IVA.`}
        </p>
      </div>
      {intento && conversion.errores.length > 0 && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">Corrige los escalones marcados antes de aplicar.</p>}
      <div className="flex justify-end"><button type="button" onClick={aplicar} className={BOTON_PRIMARIO}>Aplicar a {TEMPORADAS[recibo.temporada].toLowerCase()}</button></div>
    </div>
  );
}

// Importe mensual con la tarifa que se está editando, con desglose por escalón.
function Simulador({ tarifa, juegos, tarifaDac, iva }) {
  const [consumoTexto, setConsumoTexto] = useState("");
  const consumo = Number(consumoTexto);
  const consumoValido = numeroValido(consumoTexto) && consumo >= 0;
  const temporadas = Object.keys(juegos);

  const simular = (temporada) => {
    const filas = juegos[temporada];
    if (filas.some((_, indice) => Object.keys(erroresFila(filas, indice)).length) || filas.some((fila) => vacio(fila.precio))) {
      return { mensaje: "Completa los límites y precios de esta temporada para simular." };
    }
    const dac = aplicaDac(consumo, tarifa);
    if (dac && (!tarifaDac || faltantesDeTarifa(tarifaDac).length)) {
      return { mensaje: `Con ${fmtNumero(consumo)} kWh se supera el límite DAC de ${fmtNumero(tarifa.limite_dac_kwh)} kWh, pero ${tarifaDac ? `la tarifa ${tarifaDac.codigo} no tiene precios capturados` : "no hay una tarifa DAC asignada"}.` };
    }
    const costo = costoMensual(consumo, { tarifa, tarifaDac, temporada, iva });
    const aplicada = dac ? tarifaDac : tarifa;
    const propios = aplicada.bloques.filter((bloque) => bloque.temporada === temporada);
    const bloques = (propios.length ? propios : aplicada.bloques.filter((bloque) => bloque.temporada === aplicada.bloques[0].temporada)).sort((a, b) => a.orden - b.orden);
    return { costo, dac, aplicada, bloques };
  };

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className={ETIQUETA}>Consumo mensual en kWh
          <input type="number" min="0" step="any" value={consumoTexto} onChange={(event) => setConsumoTexto(event.target.value)} placeholder="Ej. 300" aria-label="Consumo mensual en kWh para simular" className={`${CAMPO} sm:w-44`} />
        </label>
        <p className="pb-2 text-xs text-slate-500">Importe mensual con los valores que estás capturando (aún sin guardar), con el mismo cálculo que la estimación de ahorro.</p>
      </div>
      {consumoValido && (
        <div className={`grid gap-3 ${temporadas.length > 1 ? "md:grid-cols-2" : ""}`}>
          {temporadas.map((temporada) => {
            const resultado = simular(temporada);
            return (
              <div key={temporada} className="rounded-lg bg-slate-50 p-3 text-sm">
                {temporadas.length > 1 && <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{TEMPORADAS[temporada]}</p>}
                {resultado.mensaje ? <p className="text-amber-800">{resultado.mensaje}</p> : (
                  <>
                    {resultado.dac && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">Supera el límite DAC de {fmtNumero(tarifa.limite_dac_kwh)} kWh: todo el consumo se cobra con la tarifa {resultado.aplicada.codigo}.</p>}
                    <table className="w-full">
                      <tbody className="divide-y">
                        {resultado.bloques.map((bloque, indice) => {
                          const hasta = bloque.hasta_kwh === null || bloque.hasta_kwh === undefined ? Infinity : Number(bloque.hasta_kwh);
                          const kwhEnBloque = Math.max(0, Math.min(consumo, hasta) - Number(bloque.desde_kwh));
                          return (
                            <tr key={indice}>
                              <td className="py-1">{nombreBloque(indice, resultado.bloques.length)}</td>
                              <td className="py-1 text-right text-slate-600">{kwh(kwhEnBloque)} kWh × ${fmtNumero(Number(bloque.precio_kwh), 4)}</td>
                              <td className="py-1 text-right font-medium">{fmtCentavos(costoEnergia(consumo, [bloque]))}</td>
                            </tr>
                          );
                        })}
                        <tr><td className="py-1">Cargo fijo</td><td /><td className="py-1 text-right font-medium">{fmtCentavos(resultado.costo.cargo_fijo)}</td></tr>
                        <tr><td className="py-1">Subtotal</td><td /><td className="py-1 text-right font-medium">{fmtCentavos(resultado.costo.subtotal)}</td></tr>
                        <tr><td className="py-1">IVA ({fmtNumero(iva * 100)}%)</td><td /><td className="py-1 text-right font-medium">{fmtCentavos(resultado.costo.subtotal * iva)}</td></tr>
                        <tr className="font-bold"><td className="py-1">Importe mensual</td><td /><td className="py-1 text-right">{fmtCentavos(resultado.costo.total)}</td></tr>
                      </tbody>
                    </table>
                    {vacio(tarifa.cargo_fijo_mensual) && !resultado.dac && <p className="mt-1 text-xs text-amber-700">Cargo fijo sin capturar: se tomó como $0.</p>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ModalTarifa({ tarifa, tarifasDac, iva, onCerrar, onGuardar }) {
  const editando = Boolean(tarifa);
  const [form, setForm] = useState(() => ({
    codigo: tarifa?.codigo ?? "",
    nombre: tarifa?.nombre ?? "",
    tipo: tarifa?.tipo ?? "domestica",
    limite_dac_kwh: texto(tarifa?.limite_dac_kwh),
    tarifa_dac_id: texto(tarifa?.tarifa_dac_id ?? (editando ? null : tarifasDac[0]?.id)),
    cargo_fijo_mensual: texto(tarifa?.cargo_fijo_mensual),
    origen_cargo_fijo: tarifa?.origen_cargo_fijo ?? (tarifa?.cargo_fijo_mensual === null || tarifa?.cargo_fijo_mensual === undefined ? "prueba" : ""),
    vigencia_desde: tarifa?.vigencia_desde ?? "",
    activa: tarifa ? Boolean(tarifa.activa) : true,
    validada: tarifa ? !tarifa.pendiente_validar : false,
    notas: tarifa?.notas ?? "",
  }));
  const [juegos, setJuegos] = useState(() => juegosIniciales(tarifa));
  // Campos, precios, orígenes y bloques con los que se abrió el modal; si difieren, cerrar pide confirmación.
  const [valoresIniciales] = useState(() => JSON.stringify({ form, juegos }));
  const hayCambios = JSON.stringify({ form, juegos }) !== valoresIniciales;
  const [modoCaptura, setModoCaptura] = useState("manual");
  const [nota, setNota] = useState("");
  const [intento, setIntento] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const temporadas = Object.keys(juegos);
  const porTemporada = temporadas.length > 1;
  const cambiar = (campo) => (event) => setForm({ ...form, [campo]: event.target.type === "checkbox" ? event.target.checked : event.target.value });

  // Errores de los campos generales, mostrados junto a cada campo.
  const erroresCampos = {};
  if (!form.codigo.trim()) erroresCampos.codigo = "Escribe el código, por ejemplo 1C";
  if (!form.nombre.trim()) erroresCampos.nombre = "Escribe el nombre de la tarifa";
  if (!vacio(form.cargo_fijo_mensual) && (!numeroValido(form.cargo_fijo_mensual) || Number(form.cargo_fijo_mensual) < 0)) erroresCampos.cargo_fijo_mensual = "Debe ser un número no negativo";
  if (form.tipo === "domestica" && !vacio(form.limite_dac_kwh) && (!numeroValido(form.limite_dac_kwh) || Number(form.limite_dac_kwh) <= 0)) erroresCampos.limite_dac_kwh = "Debe ser mayor que cero";
  const erroresBloques = temporadas.some((temporada) => juegos[temporada].some((_, indice) => Object.keys(erroresFila(juegos[temporada], indice)).length));
  const hayErrores = Object.keys(erroresCampos).length > 0 || erroresBloques;
  const verError = (campo) => erroresCampos[campo] && (intento || !["codigo", "nombre"].includes(campo)) ? erroresCampos[campo] : null;

  // Solo se puede validar si todos los precios y el cargo fijo están capturados y vienen de un recibo.
  const faltaValidar = [];
  if (vacio(form.cargo_fijo_mensual)) faltaValidar.push("capturar el cargo fijo");
  else if (form.origen_cargo_fijo !== "recibo") faltaValidar.push("marcar el cargo fijo como tomado de un recibo");
  for (const temporada of temporadas) {
    juegos[temporada].forEach((fila, indice) => {
      const nombre = `${nombreBloque(indice, juegos[temporada].length)}${porTemporada ? ` (${TEMPORADAS[temporada].toLowerCase()})` : ""}`;
      if (vacio(fila.precio)) faltaValidar.push(`capturar el precio de ${nombre}`);
      else if (fila.origen !== "recibo") faltaValidar.push(`marcar ${nombre} como tomado de un recibo`);
    });
  }
  if (hayErrores) faltaValidar.push("corregir los campos marcados");
  const puedeValidar = faltaValidar.length === 0;
  const perderaValidacion = editando && !tarifa.pendiente_validar && !puedeValidar;

  const bloquesNumericos = bloquesDe(juegos).map((bloque) => ({
    ...bloque,
    desde_kwh: Number(bloque.desde_kwh) || 0,
    hasta_kwh: vacio(bloque.hasta_kwh) ? null : Number(bloque.hasta_kwh),
    precio_kwh: vacio(bloque.precio_kwh) ? null : Number(bloque.precio_kwh),
  }));
  const tarifaEnEdicion = {
    codigo: form.codigo || "(nueva)",
    tipo: form.tipo,
    limite_dac_kwh: form.tipo === "domestica" && numeroValido(form.limite_dac_kwh) ? Number(form.limite_dac_kwh) : null,
    cargo_fijo_mensual: numeroValido(form.cargo_fijo_mensual) ? Number(form.cargo_fijo_mensual) : null,
    bloques: bloquesNumericos,
  };
  const tarifaDac = tarifasDac.find((dac) => String(dac.id) === String(form.tarifa_dac_id)) ?? null;

  const agregarTemporada = () => {
    const base = juegos.todo_el_anio;
    setJuegos({ verano: base, fuera_verano: base.map((fila) => ({ ...fila })) });
    setNota("Se creó «Fuera de verano» con los mismos bloques que «Verano»; ajusta lo que cambie.");
  };
  const quitarTemporada = () => {
    setJuegos({ todo_el_anio: juegos.verano });
    setNota("Ahora la tarifa usa un solo juego de bloques (el de verano) todo el año.");
  };

  const aplicarRecibo = (temporada, conversion) => {
    setJuegos({
      ...juegos,
      [temporada]: conversion.bloques.map((bloque) => ({
        hasta: texto(bloque.hasta_kwh),
        precio: texto(bloque.precio_kwh),
        origen: bloque.precio_kwh === null ? "prueba" : "recibo",
      })),
    });
    if (conversion.cargo_fijo_mensual !== null) setForm({ ...form, cargo_fijo_mensual: texto(conversion.cargo_fijo_mensual), origen_cargo_fijo: "recibo" });
    setModoCaptura("manual");
    setNota(`Se aplicaron los valores convertidos del recibo a «${TEMPORADAS[temporada]}», marcados como tomados de un recibo. Revísalos y guarda.`);
  };

  const guardar = async () => {
    setIntento(true);
    if (hayErrores) return;
    const domestica = form.tipo === "domestica";
    setError("");
    setOcupado(true);
    try {
      await onGuardar({
        codigo: form.codigo, nombre: form.nombre, tipo: form.tipo,
        limite_dac_kwh: domestica ? form.limite_dac_kwh : null,
        tarifa_dac_id: domestica ? form.tarifa_dac_id : null,
        cargo_fijo_mensual: form.cargo_fijo_mensual,
        origen_cargo_fijo: vacio(form.cargo_fijo_mensual) ? null : form.origen_cargo_fijo || null,
        vigencia_desde: form.vigencia_desde,
        activa: form.activa, pendiente_validar: !(form.validada && puedeValidar), notas: form.notas,
        bloques: bloquesDe(juegos),
      });
    } catch (apiError) {
      setError(apiError.datos?.estados ? `${apiError.message}: ${apiError.datos.estados.join(", ")}.` : apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo={editando ? `Editar tarifa ${tarifa.codigo}` : "Nueva tarifa"}
      descripcion="Los cambios no alteran cotizaciones ya emitidas: cada una guarda su propia copia de la tarifa."
      error={error || (intento && hayErrores ? "Corrige los campos marcados en rojo antes de guardar." : "")}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={guardar}
      ancho="max-w-4xl"
      confirmarCierre={hayCambios}
      mensajeCambios="Cambiaste datos, bloques, precios u orígenes de esta tarifa y no los has guardado. Si cierras, se perderán."
      acciones={({ cerrar }) => <>
        <button type="button" onClick={cerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Guardando…" : editando ? "Guardar tarifa" : "Crear tarifa"}</button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={ETIQUETA}>Código
          <input value={form.codigo} onChange={cambiar("codigo")} placeholder="Ej. 1C" aria-invalid={Boolean(verError("codigo"))} className={verError("codigo") ? CAMPO_ERROR : CAMPO} />
          {verError("codigo") && <span className={ERROR}>{verError("codigo")}</span>}
        </label>
        <label className={`${ETIQUETA} sm:col-span-2`}>Nombre
          <input value={form.nombre} onChange={cambiar("nombre")} aria-invalid={Boolean(verError("nombre"))} className={verError("nombre") ? CAMPO_ERROR : CAMPO} />
          {verError("nombre") && <span className={ERROR}>{verError("nombre")}</span>}
        </label>
        <label className={ETIQUETA}>Tipo
          <select value={form.tipo} onChange={cambiar("tipo")} className={CAMPO}>{Object.entries(TIPOS_TARIFA).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}</select>
        </label>
        <label className={ETIQUETA}>Cargo fijo mensual ($ sin IVA)
          <input type="number" min="0" step="any" value={form.cargo_fijo_mensual} onChange={cambiar("cargo_fijo_mensual")} placeholder="0 si no aplica" aria-invalid={Boolean(verError("cargo_fijo_mensual"))} className={verError("cargo_fijo_mensual") ? CAMPO_ERROR : CAMPO} />
          {verError("cargo_fijo_mensual") && <span className={ERROR}>{verError("cargo_fijo_mensual")}</span>}
        </label>
        <label className={ETIQUETA}>Origen del cargo fijo
          <SelectorOrigen valor={vacio(form.cargo_fijo_mensual) ? "prueba" : form.origen_cargo_fijo} deshabilitado={vacio(form.cargo_fijo_mensual)} etiqueta="Origen del cargo fijo" onCambiar={(valor) => setForm({ ...form, origen_cargo_fijo: valor })} />
        </label>
        <label className={ETIQUETA}>Vigente desde<input type="date" value={form.vigencia_desde} onChange={cambiar("vigencia_desde")} className={CAMPO} /></label>
        {form.tipo === "domestica" && <>
          <label className={ETIQUETA}>Límite DAC (kWh/mes)
            <input type="number" min="1" step="any" value={form.limite_dac_kwh} onChange={cambiar("limite_dac_kwh")} placeholder="Vacío = sin límite" aria-invalid={Boolean(verError("limite_dac_kwh"))} className={verError("limite_dac_kwh") ? CAMPO_ERROR : CAMPO} />
            {verError("limite_dac_kwh") && <span className={ERROR}>{verError("limite_dac_kwh")}</span>}
          </label>
          <label className={ETIQUETA}>Tarifa por encima del límite
            <select value={form.tarifa_dac_id} onChange={cambiar("tarifa_dac_id")} className={CAMPO}>
              <option value="">Sin tarifa DAC</option>
              {tarifasDac.map((dac) => <option key={dac.id} value={dac.id}>{dac.codigo} · {dac.nombre}</option>)}
            </select>
          </label>
        </>}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Bloques de consumo (hasta {MAX_BLOQUES} por temporada)</p>
          <div role="tablist" aria-label="Forma de captura" className="flex rounded-lg border bg-white p-0.5 text-sm">
            {[["manual", "Captura directa"], ["recibo", "Desde un recibo"]].map(([valor, etiqueta]) => (
              <button key={valor} type="button" role="tab" aria-selected={modoCaptura === valor} onClick={() => setModoCaptura(valor)} className={`rounded-md px-3 py-1 font-semibold ${modoCaptura === valor ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{etiqueta}</button>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">
          En la CFE, «verano» es la temporada tarifaria de los meses más cálidos que define cada tarifa (6 meses al año según la región), no el horario de verano; «fuera de verano» son los meses restantes.
          {" "}{porTemporada
            ? <button type="button" onClick={quitarTemporada} className="font-semibold text-indigo-700 hover:underline">Usar un solo juego de bloques todo el año</button>
            : <button type="button" onClick={agregarTemporada} className="font-semibold text-indigo-700 hover:underline">Agregar otra temporada (verano y fuera de verano)</button>}
        </p>
        {nota && <p role="status" className="rounded-lg bg-indigo-50 p-2 text-sm text-indigo-800">{nota}</p>}
        {modoCaptura === "recibo"
          ? <CapturaRecibo key={temporadas.join()} temporadas={temporadas} iva={iva} onAplicar={aplicarRecibo} />
          : (
            <div className="grid gap-3">
              {temporadas.map((temporada) => <EditorBloques key={temporada} temporada={temporada} filas={juegos[temporada]} mostrarErrores={intento} onCambiar={(nuevas) => setJuegos({ ...juegos, [temporada]: nuevas })} />)}
            </div>
          )}
      </section>

      <Simulador tarifa={tarifaEnEdicion} juegos={juegos} tarifaDac={form.tipo === "domestica" ? tarifaDac : null} iva={iva} />

      <label className={ETIQUETA}>Notas<textarea rows={2} value={form.notas} onChange={cambiar("notas")} placeholder="Ej. Recibo de referencia y periodo" className={CAMPO} /></label>
      <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.activa} onChange={cambiar("activa")} />Activa (disponible para asignar y emitir)</label>
        <label className={`flex items-center gap-2 ${puedeValidar ? "" : "text-slate-400"}`}><input type="checkbox" checked={form.validada && puedeValidar} disabled={!puedeValidar} onChange={cambiar("validada")} />Validada con un recibo de CFE</label>
        {!puedeValidar && <p className="text-xs text-slate-500">Para validarla falta: {faltaValidar.slice(0, 4).join("; ")}{faltaValidar.length > 4 ? `; y ${faltaValidar.length - 4} más` : ""}.</p>}
        {perderaValidacion && <p className="text-xs font-semibold text-amber-800">Esta tarifa estaba validada; al guardar quedará pendiente de validar hasta que todos sus precios estén marcados como tomados de un recibo.</p>}
      </div>
    </Modal>
  );
}

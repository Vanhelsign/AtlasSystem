import { useCallback, useEffect, useState } from "react";
import { ESTADOS_MEXICO } from "../shared/estadosMexico.js";
import { horasSolaresPico } from "../shared/irradiacion.js";
import Aviso from "./Aviso.jsx";
import Modal from "./Modal.jsx";
import { BOTON_PELIGRO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO, ETIQUETA, fmtCentavos, fmtNumero, plural } from "./ui.js";
import useAviso from "./useAviso.js";

const TIPOS_TARIFA = { domestica: "Doméstica", dac: "DAC (alto consumo)", comercial: "Comercial" };
const TEMPORADAS = { todo_el_anio: "Todo el año", verano: "Verano", fuera_verano: "Fuera de verano" };
const MAX_BLOQUES = 4;
const NOMBRES_BLOQUES = {
  1: ["Único"],
  2: ["Básico", "Excedente"],
  3: ["Básico", "Intermedio", "Excedente"],
  4: ["Básico", "Intermedio", "Intermedio alto", "Excedente"],
};
const PARAMETROS = [
  ["eficiencia", "Eficiencia del sistema", "%", 100, "Pérdidas por temperatura, cableado, inversor y suciedad."],
  ["degradacion_anual", "Degradación anual de los paneles", "% por año", 100, "Reduce el ahorro de cada año respecto al anterior."],
  ["alza_tarifa_anual", "Alza anual de la tarifa", "% por año", 100, "0% supone que el precio de la electricidad no cambia."],
  ["iva", "IVA del recibo", "%", 100, "Se aplica a los precios por kWh y al cargo fijo, que se capturan sin IVA."],
  ["meses_verano", "Meses de verano", "meses", 1, "Pondera las tarifas que tienen bloques de verano y fuera de verano."],
];

const nombreBloque = (indice, total) => NOMBRES_BLOQUES[total]?.[indice] ?? `Bloque ${indice + 1}`;
const texto = (valor) => valor === null || valor === undefined ? "" : String(valor);

function EtiquetaPendiente({ tarifa }) {
  if (!tarifa) return null;
  return tarifa.pendiente_validar
    ? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">Pendiente de validar</span>
    : <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-bold text-green-700">Validada</span>;
}

export default function TarifasCfe({ token }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [aviso, avisar, cerrarAviso] = useAviso();

  const solicitarApi = useCallback(async (url, options) => {
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...options?.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "No se pudo completar la operación."), { datos: data });
    return data;
  }, [token]);

  const cargar = useCallback((signal) => solicitarApi("/api/tarifas", { signal }), [solicitarApi]);

  useEffect(() => {
    const controller = new AbortController();
    cargar(controller.signal)
      .then((data) => { setDatos(data); setError(""); })
      .catch((cargaError) => { if (cargaError.name !== "AbortError") setError(cargaError.message); });
    return () => controller.abort();
  }, [cargar]);

  const recargar = async () => {
    try {
      setDatos(await cargar());
    } catch (cargaError) {
      avisar("error", cargaError.message);
    }
  };

  const guardarTarifa = async (tarifa, cuerpo) => {
    const data = await solicitarApi(tarifa ? `/api/tarifas/${tarifa.id}` : "/api/tarifas", { method: tarifa ? "PUT" : "POST", body: JSON.stringify(cuerpo) });
    await recargar();
    setModal(null);
    avisar("exito", tarifa ? `Tarifa ${data.codigo} actualizada. Las cotizaciones ya emitidas conservan los valores con los que se calcularon.` : `Tarifa ${data.codigo} creada.`);
  };

  const eliminarTarifa = async (tarifa) => {
    await solicitarApi(`/api/tarifas/${tarifa.id}`, { method: "DELETE" });
    await recargar();
    setModal(null);
    avisar("exito", `Tarifa ${tarifa.codigo} eliminada.`);
  };

  const guardarParametros = async (valores) => {
    const parametros = await solicitarApi("/api/parametros-ahorro", { method: "PUT", body: JSON.stringify(valores) });
    setDatos((actual) => ({ ...actual, parametros }));
    setModal(null);
    avisar("exito", "Parámetros de la estimación actualizados. Aplican a las cotizaciones que se emitan desde ahora.");
  };

  const asignarEstado = async (estadoCodigo, tarifaId) => {
    try {
      await solicitarApi(`/api/tarifas-estados/${estadoCodigo}`, { method: "PUT", body: JSON.stringify({ tarifa_id: Number(tarifaId) }) });
      await recargar();
      const tarifa = datos.tarifas.find((item) => item.id === Number(tarifaId));
      avisar("exito", `${ESTADOS_MEXICO.find((estado) => estado.codigo === estadoCodigo)?.nombre}: ahora usa la tarifa ${tarifa?.codigo}.`);
    } catch (asignacionError) {
      avisar("error", asignacionError.message);
    }
  };

  if (error) return <div className="mx-auto max-w-6xl p-4 sm:p-6"><p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p></div>;
  if (!datos) return <div className="mx-auto max-w-6xl p-4 sm:p-6"><p className="text-sm text-slate-500">Cargando tarifas…</p></div>;

  const pendientes = datos.tarifas.filter((tarifa) => tarifa.pendiente_validar);
  const tarifasDac = datos.tarifas.filter((tarifa) => tarifa.tipo === "dac");
  const asignables = datos.tarifas.filter((tarifa) => tarifa.activa && tarifa.tipo !== "dac");
  const porId = new Map(datos.tarifas.map((tarifa) => [tarifa.id, tarifa]));
  const asignacion = new Map(datos.estados.map((fila) => [fila.estado_codigo, fila.tarifa_id]));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tarifas y ahorro</h1>
          <p className="mt-1 text-sm text-slate-500">Tarifas de CFE y supuestos con los que se estima el ahorro de cada cotización. Los precios se capturan sin IVA.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={recargar} className={BOTON_SECUNDARIO}>Recargar</button>
          <button type="button" onClick={() => setModal({ tipo: "tarifa" })} className={BOTON_PRIMARIO}>Nueva tarifa</button>
        </div>
      </div>

      <Aviso aviso={aviso} onCerrar={cerrarAviso} />

      {pendientes.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <b>{plural(pendientes.length, "tarifa pendiente", "tarifas pendientes")} de validar:</b> {pendientes.map((tarifa) => tarifa.codigo).join(", ")}.
          {" "}Captura precios, cargo fijo y límites con un recibo de CFE y márcala como validada. Una estimación con una tarifa sin precios no muestra cifras.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tarifas</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {datos.tarifas.map((tarifa) => <TarjetaTarifa key={tarifa.id} tarifa={tarifa} dac={porId.get(tarifa.tarifa_dac_id)} onEditar={() => setModal({ tipo: "tarifa", tarifa })} onEliminar={() => setModal({ tipo: "eliminar", tarifa })} />)}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Parámetros de la estimación</h2>
            <p className="text-sm text-slate-500">Se copian en cada cotización al emitirla; cambiarlos no altera cotizaciones anteriores.</p>
          </div>
          <button type="button" onClick={() => setModal({ tipo: "parametros" })} className={BOTON_SECUNDARIO}>Editar</button>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PARAMETROS.map(([clave, etiqueta, unidad, factor]) => (
            <div key={clave} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">{etiqueta}</dt>
              <dd className="mt-1 font-semibold">{fmtNumero(datos.parametros[clave] * factor, factor === 1 ? 0 : 1)} {unidad}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3 rounded-xl border bg-white p-5">
        <div>
          <h2 className="text-lg font-semibold">Tarifa por estado y horas solares pico</h2>
          <p className="text-sm text-slate-500">La tarifa se propone por defecto al emitir una cotización según el estado de la dirección; el agente puede cambiarla. Las horas solares pico se actualizan con <code className="rounded bg-slate-100 px-1">scripts/cargar-irradiacion.mjs</code>.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-slate-50 text-left"><tr><th className="p-2">Estado</th><th className="p-2">Tarifa</th><th className="p-2">Horas solares pico</th><th className="p-2">Fuente</th></tr></thead>
            <tbody className="divide-y">
              {ESTADOS_MEXICO.map((estado) => {
                const tarifaId = asignacion.get(estado.codigo);
                const hsp = horasSolaresPico(estado.codigo);
                const porDefecto = hsp.fuente.startsWith("valor por defecto");
                return (
                  <tr key={estado.codigo}>
                    <td className="p-2 font-medium">{estado.nombre}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <select aria-label={`Tarifa de ${estado.nombre}`} value={tarifaId ?? ""} onChange={(event) => asignarEstado(estado.codigo, event.target.value)} className="rounded-lg border bg-white px-2 py-1">
                          {!tarifaId && <option value="">Sin tarifa</option>}
                          {asignables.map((tarifa) => <option key={tarifa.id} value={tarifa.id}>{tarifa.codigo} · {tarifa.nombre}</option>)}
                        </select>
                        {porId.get(tarifaId)?.pendiente_validar ? <span className="text-xs font-semibold text-amber-700">pendiente</span> : null}
                      </div>
                    </td>
                    <td className="p-2">{fmtNumero(hsp.hsp, 2)} kWh/m²/día</td>
                    <td className={`p-2 text-xs ${porDefecto ? "font-semibold text-amber-700" : "text-slate-500"}`}>{hsp.fuente}{hsp.fecha ? ` · ${hsp.fecha}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {modal?.tipo === "tarifa" && <ModalTarifa tarifa={modal.tarifa} tarifasDac={tarifasDac} onCerrar={() => setModal(null)} onGuardar={(cuerpo) => guardarTarifa(modal.tarifa, cuerpo)} />}
      {modal?.tipo === "eliminar" && <ModalEliminarTarifa tarifa={modal.tarifa} onCerrar={() => setModal(null)} onConfirmar={() => eliminarTarifa(modal.tarifa)} />}
      {modal?.tipo === "parametros" && <ModalParametros parametros={datos.parametros} onCerrar={() => setModal(null)} onGuardar={guardarParametros} />}
    </div>
  );
}

function TablaBloques({ bloques }) {
  const temporadas = [...new Set(bloques.map((bloque) => bloque.temporada))];
  return (
    <div className="space-y-3">
      {temporadas.map((temporada) => {
        const lista = bloques.filter((bloque) => bloque.temporada === temporada).sort((a, b) => a.orden - b.orden);
        return (
          <div key={temporada}>
            {temporadas.length > 1 || temporada !== "todo_el_anio" ? <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{TEMPORADAS[temporada]}</p> : null}
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {lista.map((bloque, indice) => (
                  <tr key={bloque.orden}>
                    <td className="py-1 pr-2 text-slate-600">{nombreBloque(indice, lista.length)}</td>
                    <td className="py-1 pr-2 text-slate-600">{bloque.hasta_kwh === null ? `más de ${fmtNumero(bloque.desde_kwh)} kWh` : `${fmtNumero(bloque.desde_kwh)}–${fmtNumero(bloque.hasta_kwh)} kWh`}</td>
                    <td className={`py-1 text-right font-medium ${bloque.precio_kwh === null ? "text-amber-700" : ""}`}>{bloque.precio_kwh === null ? "sin precio" : `${fmtCentavos(bloque.precio_kwh)}/kWh`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function TarjetaTarifa({ tarifa, dac, onEditar, onEliminar }) {
  return (
    <article className={`space-y-3 rounded-xl border bg-white p-4 ${tarifa.activa ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{tarifa.codigo}</h3>
            <EtiquetaPendiente tarifa={tarifa} />
            {tarifa.faltantes.length > 0 && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Sin precios</span>}
            {!tarifa.activa && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">Inactiva</span>}
          </div>
          <p className="text-sm text-slate-600">{tarifa.nombre} · {TIPOS_TARIFA[tarifa.tipo]}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onEditar} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100">Editar</button>
          <button type="button" onClick={onEliminar} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">Eliminar</button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-slate-500">Cargo fijo mensual</dt><dd className={`font-semibold ${tarifa.cargo_fijo_mensual === null ? "text-amber-700" : ""}`}>{tarifa.cargo_fijo_mensual === null ? "sin capturar" : fmtCentavos(tarifa.cargo_fijo_mensual)}</dd></div>
        {tarifa.tipo === "domestica" && <div><dt className="text-slate-500">Límite DAC</dt><dd className="font-semibold">{tarifa.limite_dac_kwh ? `${fmtNumero(tarifa.limite_dac_kwh)} kWh/mes → ${dac?.codigo ?? "sin tarifa DAC"}` : "Sin límite"}</dd></div>}
        <div><dt className="text-slate-500">Vigencia desde</dt><dd className="font-semibold">{tarifa.vigencia_desde ?? "sin capturar"}</dd></div>
        <div><dt className="text-slate-500">Estados asignados</dt><dd className="font-semibold">{tarifa.estados.length}</dd></div>
      </dl>
      <TablaBloques bloques={tarifa.bloques} />
      {tarifa.notas && <p className="text-xs text-slate-500">{tarifa.notas}</p>}
    </article>
  );
}

// Editor de bloques: solo se capturan el límite superior y el precio; el inicio es el límite del bloque anterior.
function juegosIniciales(tarifa) {
  const bloques = tarifa?.bloques?.length ? tarifa.bloques : [{ temporada: "todo_el_anio", orden: 1, desde_kwh: 0, hasta_kwh: null, precio_kwh: null }];
  const juegos = {};
  // Orden fijo de presentación: verano antes que fuera de verano.
  for (const temporada of ["verano", "fuera_verano", "todo_el_anio"]) {
    const lista = bloques.filter((bloque) => bloque.temporada === temporada).sort((a, b) => a.orden - b.orden);
    if (lista.length) juegos[temporada] = lista.map((bloque) => ({ hasta: texto(bloque.hasta_kwh), precio: texto(bloque.precio_kwh) }));
  }
  return juegos;
}

function EditorBloques({ temporada, filas, onCambiar }) {
  const cambiarFila = (indice, campo, valor) => onCambiar(filas.map((fila, i) => i === indice ? { ...fila, [campo]: valor } : fila));
  // El bloque nuevo queda al final (abierto); el que era el último ahora necesita su límite superior.
  const agregar = () => onCambiar([...filas, { hasta: "", precio: "" }]);
  const quitar = (indice) => onCambiar(filas.filter((_, i) => i !== indice));
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">{TEMPORADAS[temporada]}</legend>
      {filas.map((fila, indice) => {
        const ultimo = indice === filas.length - 1;
        const desde = indice === 0 ? "0" : filas[indice - 1].hasta || "…";
        const nombre = nombreBloque(indice, filas.length);
        return (
          <div key={indice} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[120px_1fr_1fr_auto]">
            <p className="col-span-2 text-sm font-medium sm:col-span-1 sm:pb-2">{nombre}<span className="block text-xs font-normal text-slate-500">desde {desde} kWh</span></p>
            <label className="text-xs">Hasta (kWh/mes)
              {ultimo
                ? <span className="mt-1 block rounded-lg border border-dashed bg-slate-50 px-3 py-2 text-sm text-slate-500">Sin límite</span>
                : <input type="number" min="0" step="any" value={fila.hasta} onChange={(event) => cambiarFila(indice, "hasta", event.target.value)} aria-label={`Límite superior de ${nombre} (${TEMPORADAS[temporada]})`} className={CAMPO} />}
            </label>
            <label className="text-xs">Precio $/kWh sin IVA
              <input type="number" min="0" step="any" value={fila.precio} onChange={(event) => cambiarFila(indice, "precio", event.target.value)} placeholder="Vacío = sin capturar" aria-label={`Precio de ${nombre} (${TEMPORADAS[temporada]})`} className={CAMPO} />
            </label>
            <button type="button" disabled={filas.length === 1} onClick={() => quitar(indice)} aria-label={`Quitar ${nombre}`} className="mb-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30">Quitar</button>
          </div>
        );
      })}
      <button type="button" disabled={filas.length >= MAX_BLOQUES} onClick={agregar} className="text-xs font-semibold text-indigo-700 hover:underline disabled:text-slate-400 disabled:no-underline">
        {filas.length >= MAX_BLOQUES ? `Máximo ${MAX_BLOQUES} bloques` : "+ Agregar bloque"}
      </button>
    </fieldset>
  );
}

function ModalTarifa({ tarifa, tarifasDac, onCerrar, onGuardar }) {
  const editando = Boolean(tarifa);
  const [form, setForm] = useState(() => ({
    codigo: tarifa?.codigo ?? "",
    nombre: tarifa?.nombre ?? "",
    tipo: tarifa?.tipo ?? "domestica",
    limite_dac_kwh: texto(tarifa?.limite_dac_kwh),
    tarifa_dac_id: texto(tarifa?.tarifa_dac_id ?? (editando ? null : tarifasDac[0]?.id)),
    cargo_fijo_mensual: texto(tarifa?.cargo_fijo_mensual),
    vigencia_desde: tarifa?.vigencia_desde ?? "",
    activa: tarifa ? Boolean(tarifa.activa) : true,
    validada: tarifa ? !tarifa.pendiente_validar : false,
    notas: tarifa?.notas ?? "",
  }));
  const [juegos, setJuegos] = useState(() => juegosIniciales(tarifa));
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const porTemporada = Boolean(juegos.verano || juegos.fuera_verano);
  const cambiar = (campo) => (event) => setForm({ ...form, [campo]: event.target.type === "checkbox" ? event.target.checked : event.target.value });

  const alternarTemporadas = (activar) => {
    if (activar) {
      const base = juegos.todo_el_anio ?? juegos.verano;
      setJuegos({ verano: base, fuera_verano: base.map((fila) => ({ ...fila })) });
    } else setJuegos({ todo_el_anio: juegos.verano ?? juegos.fuera_verano });
  };

  const guardar = async () => {
    const bloques = Object.entries(juegos).flatMap(([temporada, filas]) => filas.map((fila, indice) => ({
      temporada,
      orden: indice + 1,
      desde_kwh: indice === 0 ? 0 : filas[indice - 1].hasta,
      hasta_kwh: indice === filas.length - 1 ? null : fila.hasta,
      precio_kwh: fila.precio,
    })));
    const domestica = form.tipo === "domestica";
    setError("");
    setOcupado(true);
    try {
      await onGuardar({
        codigo: form.codigo, nombre: form.nombre, tipo: form.tipo,
        limite_dac_kwh: domestica ? form.limite_dac_kwh : null,
        tarifa_dac_id: domestica ? form.tarifa_dac_id : null,
        cargo_fijo_mensual: form.cargo_fijo_mensual, vigencia_desde: form.vigencia_desde,
        activa: form.activa, pendiente_validar: !form.validada, notas: form.notas, bloques,
      });
    } catch (apiError) {
      setError(apiError.datos?.estados ? `${apiError.message}: ${apiError.datos.estados.join(", ")}.` : apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo={editando ? `Editar tarifa ${tarifa.codigo}` : "Nueva tarifa"}
      descripcion="Captura los valores tal como aparecen en un recibo de CFE, sin IVA. Los cambios no alteran cotizaciones ya emitidas."
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={guardar}
      ancho="max-w-3xl"
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Guardando…" : editando ? "Guardar tarifa" : "Crear tarifa"}</button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={ETIQUETA}>Código<input value={form.codigo} onChange={cambiar("codigo")} placeholder="Ej. 1C" className={CAMPO} /></label>
        <label className={`${ETIQUETA} sm:col-span-2`}>Nombre<input value={form.nombre} onChange={cambiar("nombre")} className={CAMPO} /></label>
        <label className={ETIQUETA}>Tipo
          <select value={form.tipo} onChange={cambiar("tipo")} className={CAMPO}>{Object.entries(TIPOS_TARIFA).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}</select>
        </label>
        <label className={ETIQUETA}>Cargo fijo mensual ($ sin IVA)<input type="number" min="0" step="any" value={form.cargo_fijo_mensual} onChange={cambiar("cargo_fijo_mensual")} placeholder="0 si no aplica" className={CAMPO} /></label>
        <label className={ETIQUETA}>Vigente desde<input type="date" value={form.vigencia_desde} onChange={cambiar("vigencia_desde")} className={CAMPO} /></label>
        {form.tipo === "domestica" && <>
          <label className={ETIQUETA}>Límite DAC (kWh/mes)<input type="number" min="1" step="any" value={form.limite_dac_kwh} onChange={cambiar("limite_dac_kwh")} placeholder="Vacío = sin límite" className={CAMPO} /></label>
          <label className={`${ETIQUETA} sm:col-span-2`}>Tarifa que aplica por encima del límite
            <select value={form.tarifa_dac_id} onChange={cambiar("tarifa_dac_id")} className={CAMPO}>
              <option value="">Sin tarifa DAC</option>
              {tarifasDac.map((dac) => <option key={dac.id} value={dac.id}>{dac.codigo} · {dac.nombre}</option>)}
            </select>
          </label>
        </>}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Bloques de consumo (máximo {MAX_BLOQUES} por temporada)</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={porTemporada} onChange={(event) => alternarTemporadas(event.target.checked)} />Bloques distintos en verano y fuera de verano</label>
        </div>
        <div className="grid gap-3">
          {Object.entries(juegos).map(([temporada, filas]) => <EditorBloques key={temporada} temporada={temporada} filas={filas} onCambiar={(nuevas) => setJuegos({ ...juegos, [temporada]: nuevas })} />)}
        </div>
      </div>

      <label className={ETIQUETA}>Notas<textarea rows={2} value={form.notas} onChange={cambiar("notas")} placeholder="Ej. Recibo de referencia y periodo" className={CAMPO} /></label>
      <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.activa} onChange={cambiar("activa")} />Activa (disponible para asignar y emitir)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.validada} onChange={cambiar("validada")} />Validada con un recibo de CFE (requiere todos los precios y el cargo fijo)</label>
      </div>
    </Modal>
  );
}

function ModalEliminarTarifa({ tarifa, onCerrar, onConfirmar }) {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const asignada = tarifa.estados.length > 0;
  const nombres = tarifa.estados.map((codigo) => ESTADOS_MEXICO.find((estado) => estado.codigo === codigo)?.nombre ?? codigo);

  const confirmar = async () => {
    setOcupado(true);
    try {
      await onConfirmar();
    } catch (apiError) {
      setError(apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo={`Eliminar tarifa ${tarifa.codigo}`}
      descripcion={tarifa.nombre}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={asignada ? undefined : confirmar}
      acciones={<>
        <button type="button" data-autofocus onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>{asignada ? "Entendido" : "Cancelar"}</button>
        {!asignada && <button type="submit" disabled={ocupado} className={BOTON_PELIGRO}>{ocupado ? "Eliminando…" : "Eliminar tarifa"}</button>}
      </>}
    >
      {asignada ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Esta tarifa está asignada a {plural(nombres.length, "estado", "estados")}: <b>{nombres.join(", ")}</b>. Reasígnalos a otra tarifa en «Tarifa por estado» antes de eliminarla.
        </p>
      ) : (
        <p className="text-sm text-slate-600">La tarifa y sus bloques se borran. Las cotizaciones ya emitidas con ella no cambian, porque guardan su propia copia de la tarifa.</p>
      )}
    </Modal>
  );
}

function ModalParametros({ parametros, onCerrar, onGuardar }) {
  const [form, setForm] = useState(() => Object.fromEntries(PARAMETROS.map(([clave, , , factor]) => [clave, String(Math.round(parametros[clave] * factor * 1000) / 1000)])));
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const guardar = async () => {
    const valores = Object.fromEntries(PARAMETROS.map(([clave, , , factor]) => [clave, form[clave] === "" ? "" : Number(form[clave]) / factor]));
    setError("");
    setOcupado(true);
    try {
      await onGuardar(valores);
    } catch (apiError) {
      setError(apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo="Parámetros de la estimación"
      descripcion="Aplican a las cotizaciones que se emitan desde ahora."
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={guardar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Guardando…" : "Guardar parámetros"}</button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {PARAMETROS.map(([clave, etiqueta, unidad, , ayuda]) => (
          <label key={clave} className={ETIQUETA}>{etiqueta} ({unidad})
            <input type="number" step="any" value={form[clave]} onChange={(event) => setForm({ ...form, [clave]: event.target.value })} className={CAMPO} />
            <span className="mt-1 block text-xs font-normal text-slate-500">{ayuda}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

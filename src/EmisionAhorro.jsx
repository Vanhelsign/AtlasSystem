import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, fmt, fmtNumero } from "./ui.js";

const ESPERA_MS = 400;

// Aviso según el estado de la estimación; devuelve null cuando hay cifras sin observaciones.
function avisoEstimacion(supuestos) {
  if (!supuestos) return null;
  if (supuestos.estado !== "calculada") return { tono: "rojo", texto: `${supuestos.motivo} La cotización se enviará sin cifras de ahorro.` };
  const avisos = [];
  if (supuestos.tarifa?.pendiente_validar) avisos.push(`La tarifa ${supuestos.tarifa.codigo} está pendiente de validar con un recibo de CFE; las cifras son preliminares.`);
  if (supuestos.irradiacion?.fuente?.startsWith("valor por defecto")) avisos.push("Las horas solares pico del estado son un valor por defecto, todavía no consultado en PVGIS.");
  return avisos.length ? { tono: "ambar", texto: avisos.join(" ") } : null;
}

export function ResumenEstimacion({ supuestos }) {
  const r = supuestos?.resultado;
  if (!r) return null;
  const datos = [
    ["Ahorro mensual", fmt(r.ahorro_mensual)],
    ["Ahorro anual", fmt(r.ahorro_anual)],
    ["Recuperación", r.retorno_inversion_anios === null ? "Más de 30 años" : `${fmtNumero(r.retorno_inversion_anios, 1)} años`],
    ["Gasto CFE sin / con sistema", `${fmt(r.gasto_mensual_sin_sistema)} → ${fmt(r.gasto_mensual_con_sistema)} /mes`],
    ["Generación anual", `${fmtNumero(r.generacion_anual_kwh)} kWh (${fmtNumero(r.kwp, 2)} kWp × ${fmtNumero(r.hsp, 2)} h)`],
    ["Consumo considerado", `${fmtNumero(r.consumo_mensual_kwh, 1)} kWh/mes${r.dac_sin_sistema ? " · en DAC" : ""}`],
  ];
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      {datos.map(([etiqueta, valor]) => <div key={etiqueta} className="rounded-lg bg-white p-2"><dt className="text-xs text-slate-500">{etiqueta}</dt><dd className="font-semibold text-slate-900">{valor}</dd></div>)}
    </dl>
  );
}

// Selector de tarifa y vista previa del ahorro dentro de la revisión del agente.
export default function EmisionAhorro({ token, solicitudId, precioVenta, tarifaId, onTarifa, onEstimacion }) {
  const [tarifas, setTarifas] = useState([]);
  const [resultado, setResultado] = useState({ clave: null, datos: null, error: "" });
  const precio = Number(precioVenta);
  const precioValido = Number.isFinite(precio) && precio > 0;
  const clave = `${solicitudId}|${precio}|${tarifaId}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tarifas", { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then((data) => setTarifas(data.tarifas.filter((tarifa) => tarifa.activa && tarifa.tipo !== "dac")))
      .catch(() => {});
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!precioValido) return;
    const controller = new AbortController();
    const temporizador = setTimeout(async () => {
      try {
        const consulta = new URLSearchParams({ precio_venta: String(precio) });
        if (tarifaId) consulta.set("tarifa_id", tarifaId);
        const response = await fetch(`/api/agente/solicitudes/${solicitudId}/estimacion?${consulta}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo estimar el ahorro.");
        setResultado({ clave, datos: data, error: "" });
        onEstimacion(data.supuestos);
      } catch (estimacionError) {
        if (estimacionError.name === "AbortError") return;
        setResultado({ clave, datos: null, error: estimacionError.message });
        onEstimacion(null);
      }
    }, ESPERA_MS);
    return () => { clearTimeout(temporizador); controller.abort(); };
  }, [clave, precio, precioValido, solicitudId, tarifaId, token, onEstimacion]);

  const vigente = resultado.clave === clave;
  const datos = vigente ? resultado.datos : null;
  const supuestos = datos?.supuestos;
  const sugerida = tarifas.find((tarifa) => tarifa.id === datos?.tarifa_sugerida_id);
  const aviso = avisoEstimacion(supuestos);

  return (
    <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
      <div className="space-y-1">
        <label className="block text-sm font-medium">Tarifa CFE para estimar el ahorro
          <select value={tarifaId || (datos?.tarifa_sugerida_id ? String(datos.tarifa_sugerida_id) : "")} onChange={(event) => onTarifa(event.target.value)} className="mt-1 block w-full rounded-lg border bg-white px-3 py-2 font-normal">
            {!tarifaId && !datos?.tarifa_sugerida_id && <option value="">Selecciona una tarifa</option>}
            {tarifas.map((tarifa) => (
              <option key={tarifa.id} value={String(tarifa.id)}>
                {tarifa.codigo} · {tarifa.nombre}{tarifa.id === datos?.tarifa_sugerida_id ? " (sugerida por estado)" : ""}{tarifa.pendiente_validar ? " — pendiente" : ""}
              </option>
            ))}
          </select>
        </label>
        {sugerida && tarifaId && Number(tarifaId) !== sugerida.id && <button type="button" onClick={() => onTarifa("")} className="text-xs font-semibold text-indigo-700 hover:underline">Usar la sugerida ({sugerida.codigo})</button>}
      </div>
      {!precioValido && <p className="text-sm text-slate-500">Ingresa un precio final de venta para estimar el ahorro.</p>}
      {precioValido && !vigente && <p className="text-sm text-slate-500" role="status">Calculando estimación…</p>}
      {vigente && resultado.error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{resultado.error}</p>}
      {aviso && <p className={`rounded-lg p-2 text-sm ${aviso.tono === "rojo" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900"}`}>{aviso.texto}</p>}
      <ResumenEstimacion supuestos={supuestos} />
    </div>
  );
}

// Confirmación de la emisión con el resumen que verá el prospecto; reemplaza a window.confirm.
export function ModalEmitirCotizacion({ precio, supuestos, onCerrar, onConfirmar }) {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const aviso = avisoEstimacion(supuestos);

  const confirmar = async () => {
    setError("");
    setOcupado(true);
    const mensaje = await onConfirmar();
    if (mensaje) {
      setError(mensaje);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo="Enviar cotización al prospecto"
      descripcion={`Precio final de venta: ${fmt(precio)} (IVA incluido)`}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      ancho="max-w-xl"
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" data-autofocus disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Enviando…" : "Aprobar y enviar"}</button>
      </>}
    >
      <p className="text-sm text-slate-600">Se guardará una versión inmutable con los componentes y el precio. La estimación de ahorro se guarda con la tarifa{supuestos?.tarifa ? ` ${supuestos.tarifa.codigo}` : ""} y los supuestos actuales, y no cambiará si después se editan tarifas o precios.</p>
      {aviso && <p className={`rounded-lg p-2 text-sm ${aviso.tono === "rojo" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-900"}`}>{aviso.texto}</p>}
      {!supuestos && <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-600">La estimación todavía no se calculó; se calculará al enviar con la tarifa seleccionada.</p>}
      <ResumenEstimacion supuestos={supuestos} />
    </Modal>
  );
}

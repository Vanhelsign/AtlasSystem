import { useEffect, useState } from "react";
import Aviso from "./Aviso.jsx";
import Modal from "./Modal.jsx";
import useAviso from "./useAviso.js";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO, ETIQUETA } from "./ui.js";
import { ESTADOS_CORREO, fechaHora, textoDesactivado, TIPOS_CORREO } from "./correosComunes.js";

const CLIENTE = {
  papelera: { etiqueta: "En papelera", clase: "bg-amber-50 text-amber-800" },
  eliminado: { etiqueta: "Cliente eliminado", clase: "bg-slate-100 text-slate-600" },
};

// Pantalla "Notificaciones" del administrador: todos los correos con su estado, filtros, paginación y reintento
// de los fallidos. Los avisos nunca mencionan el correo del destinatario (solo el número de notificación), y las
// de clientes eliminados definitivamente ya llegan anonimizadas desde el servidor.
export default function Notificaciones({ token }) {
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [enlace, setEnlace] = useState("");
  const [pagina, setPagina] = useState(1);
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState({ clave: null, notificaciones: [], total: 0, por_pagina: 50, error: "" });
  const [porReintentar, setPorReintentar] = useState(null);
  const [aviso, avisar, cerrarAviso] = useAviso();
  const clave = `${estado}|${tipo}|${enlace}|${pagina}|${version}`;
  const cargando = resultado.clave !== clave;
  const paginas = Math.max(1, Math.ceil(resultado.total / resultado.por_pagina));

  useEffect(() => {
    const controller = new AbortController();
    const claveActual = `${estado}|${tipo}|${enlace}|${pagina}|${version}`;
    const consulta = new URLSearchParams({ ...(estado && { estado }), ...(tipo && { tipo }), ...(enlace && { enlace }), pagina: String(pagina) });
    fetch(`/api/notificaciones?${consulta}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las notificaciones.");
        setResultado({ clave: claveActual, ...data, error: "" });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setResultado({ clave: claveActual, notificaciones: [], total: 0, por_pagina: 50, error: error.message });
      });
    return () => controller.abort();
  }, [token, estado, tipo, enlace, pagina, version]);

  const cambiarFiltro = (aplicar) => (event) => { aplicar(event.target.value); setPagina(1); };

  const reintentar = async (notificacion) => {
    const response = await fetch(`/api/notificaciones/${notificacion.id}/reintentar`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: "{}" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo reintentar el envío.");
    setPorReintentar(null);
    setVersion((actual) => actual + 1);
    const { correo } = data;
    if (correo.estado === "fallido") avisar("error", `La notificación #${notificacion.id} volvió a fallar: ${correo.detalle}`);
    else if (correo.simulado) avisar("exito", `Notificación #${notificacion.id}: modo simulado, guardada en data/correos/${correo.archivo}.`);
    else avisar("exito", `Notificación #${notificacion.id}: el servidor de correo la aceptó.`);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Notificaciones</h1>
        <p className="mt-1 text-sm text-slate-500">Correos enviados a los clientes. El estado indica el resultado del envío: "Aceptado" significa que el servidor de correo lo recibió, no que llegó al buzón; "Pendiente" es un correo del modo simulado. "Desactivado" en un enlace de acceso significa que ese enlace ya no funciona, porque se envió uno más reciente o ya se usó para crear la contraseña.</p>
      </div>
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <div className="grid gap-3 sm:grid-cols-[200px_200px_200px_1fr] sm:items-end">
        <label className={ETIQUETA}>Estado
          <select value={estado} onChange={cambiarFiltro(setEstado)} className={CAMPO}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS_CORREO).map(([valor, { etiqueta }]) => <option key={valor} value={valor}>{etiqueta}</option>)}
          </select>
        </label>
        <label className={ETIQUETA}>Tipo
          <select value={tipo} onChange={cambiarFiltro(setTipo)} className={CAMPO}>
            <option value="">Todos</option>
            {Object.entries(TIPOS_CORREO).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
          </select>
        </label>
        <label className={ETIQUETA}>Enlace
          <select value={enlace} onChange={cambiarFiltro(setEnlace)} className={CAMPO}>
            <option value="">Todos</option>
            <option value="vigente">Vigente</option>
            <option value="desactivado">Desactivado</option>
          </select>
          <span className="mt-1 block text-xs font-normal text-slate-500">Solo enlaces de acceso.</span>
        </label>
        <p className="text-sm text-slate-500 sm:text-right">{resultado.total} {resultado.total === 1 ? "notificación" : "notificaciones"}</p>
      </div>
      {resultado.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{resultado.error}</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600">
            <tr><th className="p-3">#</th><th className="p-3">Destinatario</th><th className="p-3">Tipo</th><th className="p-3">Fecha</th><th className="p-3">Estado</th><th className="p-3">Intentos</th><th className="p-3">Detalle</th><th className="p-3">Acción</th></tr>
          </thead>
          <tbody className="divide-y">
            {resultado.notificaciones.map((notificacion) => (
              <tr key={notificacion.id} className="align-top">
                <td className="p-3 text-slate-500">{notificacion.id}</td>
                <td className="p-3">
                  <span className={`block break-all ${notificacion.cliente === "eliminado" ? "text-slate-400" : "text-slate-800"}`}>{notificacion.destinatario}</span>
                  {notificacion.cliente_nombre && <span className="block text-xs text-slate-500">{notificacion.cliente_nombre}</span>}
                  {CLIENTE[notificacion.cliente] && <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${CLIENTE[notificacion.cliente].clase}`}>{CLIENTE[notificacion.cliente].etiqueta}</span>}
                </td>
                <td className="p-3 text-slate-600">{TIPOS_CORREO[notificacion.tipo] ?? notificacion.tipo}</td>
                <td className="p-3 text-slate-600">{fechaHora(notificacion.ultimo_intento_at ?? notificacion.creada_at)}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADOS_CORREO[notificacion.estado]?.clase ?? ""}`}>{ESTADOS_CORREO[notificacion.estado]?.etiqueta ?? notificacion.estado}</span>
                    {notificacion.desactivado && <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Desactivado</span>}
                  </div>
                  {notificacion.desactivado && <span className="mt-1 block text-xs text-slate-500">{textoDesactivado(notificacion.motivo_desactivacion)}</span>}
                </td>
                <td className="p-3 text-slate-600">{notificacion.intentos}</td>
                <td className="max-w-xs break-words p-3 text-xs text-slate-600">{notificacion.detalle || "—"}</td>
                <td className="p-3">
                  {notificacion.puede_reintentar && <button type="button" onClick={() => setPorReintentar(notificacion)} className="rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">Reintentar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cargando && <p role="status" className="p-6 text-center text-sm text-slate-500">Cargando notificaciones…</p>}
        {!cargando && !resultado.error && resultado.notificaciones.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No hay notificaciones con estos filtros.</p>}
      </div>
      {paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} className={BOTON_SECUNDARIO}>Anterior</button>
          <span className="text-slate-600">Página {pagina} de {paginas}</span>
          <button type="button" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} className={BOTON_SECUNDARIO}>Siguiente</button>
        </div>
      )}
      {porReintentar && <ModalReintentar notificacion={porReintentar} onCerrar={() => setPorReintentar(null)} onConfirmar={() => reintentar(porReintentar)} />}
    </div>
  );
}

function ModalReintentar({ notificacion, onCerrar, onConfirmar }) {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const confirmar = async () => {
    setError("");
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
      titulo={`Reintentar la notificación #${notificacion.id}`}
      descripcion={TIPOS_CORREO[notificacion.tipo]}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" data-autofocus disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Enviando…" : "Reintentar"}</button>
      </>}
    >
      <p className="text-sm text-slate-600">
        {notificacion.tipo === "credenciales"
          ? "Se generará un enlace de acceso nuevo, válido por 48 horas, y el anterior dejará de funcionar."
          : "Se volverá a enviar el aviso de cotización lista."}
        {" "}Cuenta para el límite de envíos por hora de ese cliente.
      </p>
    </Modal>
  );
}

import { useEffect, useState } from "react";
import AvisoCorreo from "./AvisoCorreo.jsx";
import Modal from "./Modal.jsx";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "./ui.js";
import { ESTADOS_CORREO, fechaHora, TIPOS_CORREO } from "./correosComunes.js";

// Bloque "Correos" del detalle de la solicitud (agente responsable y administrador): estado de cada correo y
// botón para reenviar el enlace de acceso mientras el cliente no haya creado su contraseña.
// Nunca recibe ni muestra el token ni el enlace.
export default function CorreosSolicitud({ token, solicitudId }) {
  const [version, setVersion] = useState(0);
  const [datos, setDatos] = useState({ clave: null, notificaciones: [], acceso_pendiente: false, error: "" });
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const clave = `${solicitudId}|${version}`;

  useEffect(() => {
    const controller = new AbortController();
    const claveActual = `${solicitudId}|${version}`;
    fetch(`/api/solicitudes/${solicitudId}/notificaciones`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los correos.");
        setDatos({ clave: claveActual, ...data, error: "" });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setDatos({ clave: claveActual, notificaciones: [], acceso_pendiente: false, error: error.message });
      });
    return () => controller.abort();
  }, [token, solicitudId, version]);

  const reenviar = async () => {
    const response = await fetch(`/api/solicitudes/${solicitudId}/reenviar-credenciales`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: "{}",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo reenviar el enlace.");
    setConfirmando(false);
    setResultado(data.correo);
    setVersion((actual) => actual + 1);
  };

  return (
    <section className="mt-6 space-y-3 border-t pt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold">Correos al cliente</h3>
        {datos.acceso_pendiente && <button type="button" onClick={() => { setResultado(null); setConfirmando(true); }} className={BOTON_SECUNDARIO}>Reenviar enlace de acceso</button>}
      </div>
      <AvisoCorreo correo={resultado} tipo="credenciales" />
      {datos.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{datos.error}</p>}
      {datos.clave === clave && !datos.error && datos.notificaciones.length === 0 && <p className="text-sm text-slate-500">No se ha enviado ningún correo para esta solicitud.</p>}
      {datos.notificaciones.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {datos.notificaciones.map((correo) => (
            <li key={correo.id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium text-slate-800">{TIPOS_CORREO[correo.tipo_correo] ?? correo.tipo_correo}</p>
                <p className="text-xs text-slate-500">{fechaHora(correo.ultimo_intento_at ?? correo.created_at)}{correo.intentos > 1 ? ` · ${correo.intentos} intentos` : ""}</p>
                {correo.estado_envio === "fallido" && correo.detalle_error && <p className="break-words text-xs text-amber-800">{correo.detalle_error}</p>}
              </div>
              <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADOS_CORREO[correo.estado_envio]?.clase ?? ""}`}>{ESTADOS_CORREO[correo.estado_envio]?.etiqueta ?? correo.estado_envio}</span>
            </li>
          ))}
        </ul>
      )}
      {confirmando && <ModalReenviar onCerrar={() => setConfirmando(false)} onConfirmar={reenviar} />}
    </section>
  );
}

function ModalReenviar({ onCerrar, onConfirmar }) {
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
      titulo="Reenviar enlace de acceso"
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" data-autofocus disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Enviando…" : "Reenviar enlace"}</button>
      </>}
    >
      <p className="text-sm text-slate-600">Se enviará al cliente un enlace nuevo para crear su contraseña, válido por 48 horas. El enlace anterior dejará de funcionar.</p>
    </Modal>
  );
}

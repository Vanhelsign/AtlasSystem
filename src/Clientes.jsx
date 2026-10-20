import { useEffect, useMemo, useState } from "react";
import Aviso from "./Aviso.jsx";
import Modal from "./Modal.jsx";
import useAviso from "./useAviso.js";
import { BOTON_PELIGRO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO, ETIQUETA, plural } from "./ui.js";
import { nombreEstadoMexico } from "../shared/estadosMexico.js";

const MAX_MOTIVO = 500;
const ESTATUS = {
  sin_solicitud: "Sin solicitud",
  pendiente_revision_tecnica: "Pendiente de revisión técnica",
  en_revision_tecnica: "En revisión técnica",
  revision_tecnica_completada: "Revisión técnica completada",
  en_preparacion: "En preparación",
  pendiente_respuesta: "Cotización enviada al prospecto",
  aceptada_pendiente_pago: "Aceptada, pendiente de pago",
  venta_confirmada: "Venta confirmada",
};
// Mismo criterio que Cotizaciones Emitidas para el estatus visible de una solicitud.
const estatusDe = (estadoFlujo, revisionEstado) => {
  if (!estadoFlujo) return ESTATUS.sin_solicitud;
  const etapaTecnica = ["pendiente_revision_tecnica", "en_preparacion"].includes(estadoFlujo);
  if (etapaTecnica && revisionEstado === "completada") return ESTATUS.revision_tecnica_completada;
  if (etapaTecnica && revisionEstado === "en_revision") return ESTATUS.en_revision_tecnica;
  return ESTATUS[estadoFlujo] ?? estadoFlujo;
};
const fecha = (valor) => valor ? new Date(`${valor.replace(" ", "T")}Z`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const estadoGeografico = (codigo, texto) => (codigo && nombreEstadoMexico(codigo)) || texto || "—";
const impactoTexto = ({ solicitudes, cotizaciones }) => `${plural(solicitudes, "solicitud", "solicitudes")} y ${plural(cotizaciones, "cotización emitida", "cotizaciones emitidas")}`;

function usarApi(token) {
  return async (ruta, { metodo = "GET", cuerpo } = {}) => {
    const response = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
    return data;
  };
}

// Pantalla "Clientes" del administrador: activos y papelera, con borrado lógico y eliminación definitiva.
export default function Clientes({ token, onCambio }) {
  const api = useMemo(() => usarApi(token), [token]);
  const [vista, setVista] = useState("activos");
  const [busqueda, setBusqueda] = useState("");
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState({ clave: null, clientes: [], error: "" });
  const [detalleId, setDetalleId] = useState(null);
  const [aviso, avisar, cerrarAviso] = useAviso();
  const clave = `${vista}|${busqueda}|${version}`;
  const cargando = resultado.clave !== clave;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/clientes?estado=${vista}&q=${encodeURIComponent(busqueda)}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los clientes.");
        setResultado({ clave: `${vista}|${busqueda}|${version}`, clientes: data, error: "" });
      })
      .catch((error) => {
        if (error.name !== "AbortError") setResultado({ clave: `${vista}|${busqueda}|${version}`, clientes: [], error: error.message });
      });
    return () => controller.abort();
  }, [token, vista, busqueda, version]);

  const recargar = () => { setVersion((actual) => actual + 1); onCambio?.(); };
  const eliminados = vista === "eliminados";

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Clientes</h1>
        <p className="mt-1 text-sm text-slate-500">Clientes registrados desde Cotización. Eliminar los manda a la papelera, de donde se pueden restaurar o eliminar definitivamente.</p>
      </div>
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className={`${ETIQUETA} flex-1`}>Buscar
          <input type="search" value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Nombre o correo" className={CAMPO} />
        </label>
        <div role="group" aria-label="Mostrar" className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
          {[["activos", "Activos"], ["eliminados", "Eliminados"]].map(([valor, etiqueta]) => (
            <button key={valor} type="button" aria-pressed={vista === valor} onClick={() => setVista(valor)} className={`rounded-md px-4 py-1.5 text-sm font-semibold ${vista === valor ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{etiqueta}</button>
          ))}
        </div>
      </div>
      {resultado.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{resultado.error}</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="p-3">Nombre</th><th className="p-3">Correo</th><th className="p-3">Estado</th><th className="p-3">Solicitudes</th>
              <th className="p-3">Estatus más reciente</th><th className="p-3">{eliminados ? "Eliminado" : "Alta"}</th><th className="p-3">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {resultado.clientes.map((cliente) => (
              <tr key={cliente.id} className="align-top">
                <td className="p-3 font-semibold text-slate-900">{cliente.nombre}</td>
                <td className="break-all p-3 text-slate-600">{cliente.email || "—"}</td>
                <td className="p-3 text-slate-600">{estadoGeografico(cliente.direccion_estado_codigo, cliente.direccion_estado)}</td>
                <td className="p-3 text-slate-600">{cliente.total_solicitudes}</td>
                <td className="p-3 text-slate-600">{estatusDe(cliente.ultimo_estado_flujo, cliente.ultima_revision_estado)}</td>
                <td className="p-3 text-slate-600">
                  {eliminados ? <>{fecha(cliente.eliminado_at)}{cliente.motivo_eliminacion && <span className="block text-xs text-slate-500">{cliente.motivo_eliminacion}</span>}</> : fecha(cliente.created_at)}
                </td>
                <td className="p-3"><button type="button" onClick={() => setDetalleId(cliente.id)} className="font-semibold text-indigo-700 hover:underline">Ver detalle</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cargando && !resultado.error && resultado.clientes.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">{busqueda ? "Ningún cliente coincide con la búsqueda." : eliminados ? "La papelera está vacía." : "No hay clientes registrados."}</p>
        )}
        {cargando && <p role="status" className="p-6 text-center text-sm text-slate-500">Cargando clientes…</p>}
      </div>
      {detalleId && <ModalDetalleCliente key={detalleId} api={api} id={detalleId} avisar={avisar} onCambio={recargar} onCerrar={() => setDetalleId(null)} />}
    </div>
  );
}

function ModalDetalleCliente({ api, id, avisar, onCambio, onCerrar }) {
  const [detalle, setDetalle] = useState(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [accion, setAccion] = useState(null);

  useEffect(() => {
    let vigente = true;
    api(`/admin/clientes/${id}`)
      .then((data) => { if (vigente) { setDetalle(data); setError(""); } })
      .catch((apiError) => { if (vigente) setError(apiError.message); });
    return () => { vigente = false; };
  }, [api, id, version]);

  const terminar = (mensaje, { cerrarDetalle = false } = {}) => {
    setAccion(null);
    avisar("exito", mensaje);
    onCambio();
    if (cerrarDetalle) onCerrar();
    else setVersion((actual) => actual + 1);
  };

  const cliente = detalle?.cliente;
  const enPapelera = Boolean(cliente?.eliminado_at);
  const direccion = detalle?.direccion;

  return (
    <Modal
      titulo={cliente ? cliente.nombre : "Detalle del cliente"}
      descripcion={enPapelera ? "En la papelera" : "Cliente activo"}
      ancho="max-w-3xl"
      error={error}
      onCerrar={onCerrar}
      acciones={<>
        <button type="button" onClick={onCerrar} className={BOTON_SECUNDARIO}>Cerrar</button>
        {cliente && !enPapelera && <button type="button" onClick={() => setAccion({ tipo: "eliminar-cliente" })} className={BOTON_PELIGRO}>Eliminar cliente</button>}
        {cliente && enPapelera && <>
          <button type="button" onClick={() => setAccion({ tipo: "restaurar-cliente" })} className={BOTON_PRIMARIO}>Restaurar cliente</button>
          <button type="button" onClick={() => setAccion({ tipo: "definitivo-cliente" })} className={BOTON_PELIGRO}>Eliminar definitivamente</button>
        </>}
      </>}
    >
      {!detalle && !error && <p role="status" className="text-sm text-slate-500">Cargando…</p>}
      {cliente && <>
        {enPapelera && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">En la papelera desde el {fecha(cliente.eliminado_at)}{cliente.eliminado_por_nombre ? `, por ${cliente.eliminado_por_nombre}` : ""}.</p>
            {cliente.motivo_eliminacion && <p className="mt-1">Motivo: {cliente.motivo_eliminacion}</p>}
            <p className="mt-1 text-xs">No puede iniciar sesión y su correo queda reservado mientras esté aquí.</p>
          </div>
        )}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Correo</dt><dd className="break-all font-semibold">{cliente.email || "—"}</dd></div>
          <div><dt className="text-slate-500">Teléfono</dt><dd className="font-semibold">{cliente.telefono || "—"}</dd></div>
          <div><dt className="text-slate-500">Alta</dt><dd className="font-semibold">{fecha(cliente.created_at)}</dd></div>
          <div><dt className="text-slate-500">Cuenta del portal</dt><dd className="font-semibold">{cliente.cuenta_id ? (cliente.debe_cambiar_password ? "Creada; falta que el cliente cree su contraseña" : "Activa") : "Sin cuenta"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-500">Dirección</dt><dd className="font-semibold">
            {direccion ? `${direccion.calle} ${direccion.numero_exterior}${direccion.numero_interior ? ` int. ${direccion.numero_interior}` : ""}, Col. ${direccion.colonia}, C.P. ${direccion.codigo_postal}, ${direccion.municipio}, ${estadoGeografico(direccion.estado_codigo, direccion.estado)}` : "No registrada"}
          </dd></div>
        </dl>
        <section className="space-y-2 border-t pt-4">
          <h3 className="font-semibold">Solicitudes</h3>
          {detalle.solicitudes.length === 0 && <p className="text-sm text-slate-500">Este cliente no tiene solicitudes.</p>}
          <ul className="divide-y rounded-xl border">
            {detalle.solicitudes.map((solicitud) => (
              <li key={solicitud.id} className={`flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between ${solicitud.eliminado_at ? "bg-slate-50" : ""}`}>
                <div className="text-sm">
                  <p className="font-semibold text-slate-800">
                    Solicitud #{solicitud.id} · {fecha(solicitud.created_at)}
                    {solicitud.eliminado_at && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">En papelera</span>}
                  </p>
                  <p className="text-slate-600">{estatusDe(solicitud.estado_flujo, solicitud.revision_estado)} · {solicitud.agente_responsable || "Sin agente"}</p>
                  <p className="text-xs text-slate-500">{solicitud.total_cotizaciones ? `Cotización v${solicitud.cotizacion_version} emitida el ${fecha(solicitud.cotizacion_emitida_at)}` : "Sin cotización emitida"}</p>
                  {solicitud.eliminado_at && (
                    <p className="text-xs text-amber-800">
                      {solicitud.eliminada_con_cliente ? "Eliminada junto con el cliente" : `Eliminada aparte el ${fecha(solicitud.eliminado_at)}`}
                      {solicitud.motivo_eliminacion ? ` · Motivo: ${solicitud.motivo_eliminacion}` : ""}
                    </p>
                  )}
                </div>
                {!enPapelera && (
                  <div className="flex shrink-0 gap-2">
                    {!solicitud.eliminado_at
                      ? <button type="button" onClick={() => setAccion({ tipo: "eliminar-solicitud", solicitud })} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">Eliminar estimación</button>
                      : <>
                        <button type="button" onClick={() => setAccion({ tipo: "restaurar-solicitud", solicitud })} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100">Restaurar estimación</button>
                        <button type="button" onClick={() => setAccion({ tipo: "definitivo-solicitud", solicitud })} className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700">Eliminar definitivamente</button>
                      </>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </>}

      {accion?.tipo === "eliminar-cliente" && (
        <ModalConfirmarPapelera
          titulo={`Eliminar a ${cliente.nombre}`}
          texto={`El cliente y ${impactoTexto(detalle.impacto.eliminar)} pasan a la papelera. Dejan de aparecer en todas las pantallas, el cliente no podrá iniciar sesión y su correo queda reservado. Puedes restaurarlo después.`}
          etiqueta="Enviar a la papelera" peligro conMotivo
          onCerrar={() => setAccion(null)}
          onConfirmar={async (motivo) => {
            const r = await api(`/admin/clientes/${id}/eliminar`, { metodo: "POST", cuerpo: { motivo } });
            terminar(`${cliente.nombre} está en la papelera, con ${impactoTexto(r)}.`);
          }}
        />
      )}
      {accion?.tipo === "restaurar-cliente" && (
        <ModalConfirmarPapelera
          titulo={`Restaurar a ${cliente.nombre}`}
          texto={`Se restauran el cliente y ${impactoTexto(detalle.impacto.restaurar)} eliminadas con él. Las estimaciones que se eliminaron aparte siguen en la papelera.`}
          etiqueta="Restaurar"
          onCerrar={() => setAccion(null)}
          onConfirmar={async () => {
            const r = await api(`/admin/clientes/${id}/restaurar`, { metodo: "POST" });
            terminar(`${cliente.nombre} se restauró con ${impactoTexto(r)}.`);
          }}
        />
      )}
      {accion?.tipo === "eliminar-solicitud" && (
        <ModalConfirmarPapelera
          titulo={`Eliminar la solicitud #${accion.solicitud.id}`}
          texto={`La estimación y ${plural(accion.solicitud.total_cotizaciones, "cotización emitida", "cotizaciones emitidas")} pasan a la papelera. El cliente no cambia. Puedes restaurarla después.`}
          etiqueta="Enviar a la papelera" peligro conMotivo
          onCerrar={() => setAccion(null)}
          onConfirmar={async (motivo) => {
            await api(`/admin/solicitudes/${accion.solicitud.id}/eliminar`, { metodo: "POST", cuerpo: { motivo } });
            terminar(`La solicitud #${accion.solicitud.id} está en la papelera.`);
          }}
        />
      )}
      {accion?.tipo === "restaurar-solicitud" && (
        <ModalConfirmarPapelera
          titulo={`Restaurar la solicitud #${accion.solicitud.id}`}
          texto={`La estimación y ${plural(accion.solicitud.total_cotizaciones, "cotización emitida", "cotizaciones emitidas")} vuelven a aparecer en las pantallas.`}
          etiqueta="Restaurar"
          onCerrar={() => setAccion(null)}
          onConfirmar={async () => {
            await api(`/admin/solicitudes/${accion.solicitud.id}/restaurar`, { metodo: "POST" });
            terminar(`La solicitud #${accion.solicitud.id} se restauró.`);
          }}
        />
      )}
      {accion?.tipo === "definitivo-cliente" && (
        <ModalEliminarDefinitivo
          titulo={`Eliminar definitivamente a ${cliente.nombre}`}
          conteo={detalle.impacto.definitivo}
          confirmar={cliente.email || cliente.nombre}
          etiquetaConfirmar={cliente.email ? "Escribe el correo del cliente para confirmar" : "Escribe el nombre del cliente para confirmar"}
          liberaCorreo={Boolean(cliente.email)}
          onCerrar={() => setAccion(null)}
          onConfirmar={async (confirmacion) => {
            const r = await api(`/admin/clientes/${id}/eliminar-definitivamente`, { metodo: "POST", cuerpo: { entiendo: true, confirmacion } });
            const problemas = r.correos.fallidos.length + r.correos.rechazados;
            terminar(`${cliente.nombre} se eliminó definitivamente. Respaldo previo: ${r.respaldo}.${r.correos.borrados ? ` Se borraron ${plural(r.correos.borrados, "correo simulado", "correos simulados")}.` : ""}`, { cerrarDetalle: true });
            if (problemas) avisar("error", `La base quedó eliminada, pero ${plural(problemas, "archivo .eml no se pudo borrar", "archivos .eml no se pudieron borrar")}${r.correos.fallidos.length ? `: ${r.correos.fallidos.join(", ")}` : " (ruta fuera de data/correos/)"}. Revísalos a mano.`);
          }}
        />
      )}
      {accion?.tipo === "definitivo-solicitud" && (
        <ModalEliminarDefinitivo
          titulo={`Eliminar definitivamente la solicitud #${accion.solicitud.id}`}
          conteo={accion.solicitud.impacto_definitivo}
          onCerrar={() => setAccion(null)}
          onConfirmar={async () => {
            const r = await api(`/admin/solicitudes/${accion.solicitud.id}/eliminar-definitivamente`, { metodo: "POST", cuerpo: { entiendo: true } });
            terminar(`La solicitud #${accion.solicitud.id} se eliminó definitivamente. Respaldo previo: ${r.respaldo}.`);
          }}
        />
      )}
    </Modal>
  );
}

// Confirmación de eliminar o restaurar. Con motivo escrito, cerrar sin enviar pide confirmación.
function ModalConfirmarPapelera({ titulo, texto, etiqueta, peligro = false, conMotivo = false, onConfirmar, onCerrar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const confirmar = async () => {
    setError("");
    setOcupado(true);
    try {
      await onConfirmar(motivo.trim() || undefined);
    } catch (apiError) {
      setError(apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo={titulo}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      confirmarCierre={conMotivo && motivo.trim() !== ""}
      mensajeCambios="Escribiste un motivo y no has confirmado. Si cierras, se perderá y no se eliminará nada."
      acciones={({ cerrar }) => <>
        <button type="button" onClick={cerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" data-autofocus={conMotivo ? undefined : true} disabled={ocupado} className={peligro ? BOTON_PELIGRO : BOTON_PRIMARIO}>{ocupado ? "Guardando…" : etiqueta}</button>
      </>}
    >
      <p className="text-sm text-slate-600">{texto}</p>
      {conMotivo && (
        <label className={ETIQUETA}>Motivo (opcional)
          <textarea rows={3} maxLength={MAX_MOTIVO} value={motivo} onChange={(event) => setMotivo(event.target.value)} className={CAMPO} placeholder="Ej. Registro de prueba" />
          <span className="mt-1 block text-right text-xs font-normal text-slate-500">{motivo.length}/{MAX_MOTIVO}</span>
        </label>
      )}
    </Modal>
  );
}

// Eliminación definitiva: conteo exacto por tipo, casilla obligatoria y, para clientes, escribir su correo.
function ModalEliminarDefinitivo({ titulo, conteo, confirmar = null, etiquetaConfirmar, liberaCorreo = false, onConfirmar, onCerrar }) {
  const [entiendo, setEntiendo] = useState(false);
  const [escrito, setEscrito] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const coincide = !confirmar || escrito.trim().toLowerCase() === confirmar.trim().toLowerCase();
  const listo = entiendo && coincide;

  const enviar = async () => {
    if (!listo) return;
    setError("");
    setOcupado(true);
    try {
      await onConfirmar(escrito.trim());
    } catch (apiError) {
      setError(apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo={titulo}
      descripcion="Esta acción borra los datos de la base y no se puede deshacer."
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={enviar}
      acciones={({ cerrar }) => <>
        <button type="button" data-autofocus onClick={cerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado || !listo} className={BOTON_PELIGRO}>{ocupado ? "Eliminando…" : "Eliminar definitivamente"}</button>
      </>}
    >
      <div>
        <p className="text-sm font-semibold text-slate-800">Se eliminarán:</p>
        <ul className="mt-2 divide-y rounded-lg border text-sm">
          {conteo.tablas.map((fila) => (
            <li key={fila.tabla} className="flex justify-between gap-3 px-3 py-1.5"><span>{fila.etiqueta}</span><b>{fila.total}</b></li>
          ))}
        </ul>
        {conteo.notificaciones > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {plural(conteo.notificaciones, "registro de notificación se conserva", "registros de notificaciones se conservan")} sin vínculo{liberaCorreo ? ", con el destinatario anonimizado; sus archivos .eml de modo simulado se borran" : ""}.
          </p>
        )}
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        Antes de borrar se crea un respaldo completo de la base en <code className="text-xs">data/backups/</code>, que conserva los datos de este cliente. Los respaldos no se borran solos: elimínalos a mano cuando ya no los necesites.
      </p>
      {liberaCorreo && <p className="text-sm text-slate-600">Después, el correo queda libre para registrar otro cliente.</p>}
      <label className="flex items-start gap-2 text-sm font-medium">
        <input type="checkbox" checked={entiendo} onChange={(event) => setEntiendo(event.target.checked)} className="mt-0.5" />
        Entiendo que no se puede deshacer
      </label>
      {confirmar && (
        <label className={ETIQUETA}>{etiquetaConfirmar}
          <input value={escrito} onChange={(event) => setEscrito(event.target.value)} autoComplete="off" aria-invalid={escrito !== "" && !coincide} className={CAMPO} />
          {escrito !== "" && !coincide && <span className="mt-1 block text-xs font-normal text-red-600">No coincide.</span>}
        </label>
      )}
    </Modal>
  );
}

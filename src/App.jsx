/**
 * ATLAS CRM Solar — Funcionalidades Principales
 * Proyecto Integrador 1 — FIME UANL
 */

import { useEffect, useState } from "react";
import Cotizacion from "./Cotizacion.jsx";
import SolicitudesDimensionamiento from "./SolicitudesDimensionamiento.jsx";
import GestionInventario from "./InventarioFisico.jsx";
import { ESTADOS_MEXICO, nombreEstadoMexico } from "../shared/estadosMexico.js";

// ─────────────────────────────────────────────────────────
//  DATOS CONSTANTES E INICIALES
// ─────────────────────────────────────────────────────────

const IRRADIACION = { Monterrey: 5.4, "Ciudad de México": 5.1, Guadalajara: 5.3, Tijuana: 5.8, Mérida: 5.6, Otra: 5.0 };

// NUEVO: Lista de clientes inactivos para reactivación
const CLIENTES_INACTIVOS_INICIALES = [
  { id: 101, nombre: "Industrias Alfa", ultima_compra: "2024-10-15", meses_inactivo: 18, estado_reactivacion: "Pendiente" },
  { id: 102, nombre: "Comercializadora del Norte", ultima_compra: "2025-05-20", meses_inactivo: 12, estado_reactivacion: "Pendiente" }
];

// NUEVO: Tickets de instalación/mantenimiento
const TICKETS_INICIALES = [
  { id: 501, cliente: "Sunrise Energy", tipo: "Instalación Nueva", estado: "Asignado", tecnico: "Juan Técnico", fecha: "2026-05-30" },
  { id: 502, cliente: "Residencial Las Cumbres", tipo: "Mantenimiento Preventivo", estado: "En Progreso", tecnico: "Juan Técnico", fecha: "2026-05-25" }
];

// NUEVO: ROLES COMPLETOS
const ESTADOS_REACTIVACION = ["Pendiente", "Renovó mantenimiento", "Solicitó ampliación", "No interesado", "Sin respuesta (3 intentos)"];

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
const ESTADOS_SOLICITUD = {
  informacion_incompleta: "Información incompleta",
  pendiente_revision_tecnica: "Pendiente de revisión técnica",
  en_revision_tecnica: "En revisión técnica",
  revision_tecnica_completada: "Revisión técnica completada",
  en_preparacion: "En preparación",
  pendiente_respuesta: "Cotización enviada al prospecto",
  aceptada_pendiente_pago: "Aceptada, pendiente de pago",
  venta_confirmada: "Venta confirmada",
};

// ─────────────────────────────────────────────────────────
//  COMPONENTE: LOGIN
// ─────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [email, setEmail] = useState("admin@atlas.com");
  const [password, setPassword] = useState("123");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setCargando(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-indigo-700">ATLAS CRM</h1>
          <p className="text-sm text-slate-500 mt-1">Acceso al sistema (v2.0)</p>
        </div>
        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4">{error}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Correo electrónico</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="block text-sm font-medium mb-1">Contraseña</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <button disabled={cargando} type="submit" className="w-full bg-indigo-600 disabled:bg-indigo-300 text-white font-medium py-2.5 rounded-lg text-sm">{cargando ? "Validando…" : "Iniciar sesión"}</button>
        </form>
        <div className="mt-6 text-xs text-slate-500 text-center space-y-1">
          <p><b>Demos disponibles (Pass: 123)</b></p>
          <p>admin@atlas.com | ventas@atlas.com</p>
          <p>tecnico@atlas.com</p>
          <p>Los prospectos acceden con la cuenta creada desde Cotización.</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  MÓDULO: PORTAL TÉCNICO
// ─────────────────────────────────────────────────────────
function PortalTecnico({ tickets, setTickets }) {
  
  const actualizarTicket = (id) => {
    // 1. Pedimos el nuevo estado
    const nuevoEstado = window.prompt("Ingresa el nuevo estado del ticket (ej. Completado, En Progreso, Detenido):");
    
    if (nuevoEstado) {
      // 2. Simulamos la subida de evidencia
      const evidencia = window.confirm("¿Deseas adjuntar una fotografía como evidencia de la visita técnica?");
      if (evidencia) {
        alert("Simulando apertura de explorador de archivos... \n\n¡Evidencia fotográfica subida con éxito al servidor!");
      }
      
      // 3. Actualizamos el arreglo global de tickets
      setTickets(tickets.map(t => 
        t.id === id ? { ...t, estado: nuevoEstado } : t
      ));
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h2 className="text-xl font-semibold">Mis Instalaciones y Tickets Asignados</h2>
      <div className="grid gap-4">
        {tickets.map(t => (
          <div key={t.id} className="bg-white p-4 rounded-xl border flex justify-between items-center">
            <div>
              <p className="font-bold text-slate-800">Ticket #{t.id} - {t.cliente}</p>
              <p className="text-sm text-slate-500">Tipo: {t.tipo} | Fecha prog: {t.fecha}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                t.estado === 'Completado' ? 'bg-green-100 text-green-700' : 
                t.estado === 'Asignado' ? 'bg-blue-100 text-blue-700' : 
                'bg-yellow-100 text-yellow-700'
              }`}>
                {t.estado}
              </span>
              <button 
                onClick={() => actualizarTicket(t.id)} 
                className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-100 transition-colors"
              >
                Actualizar Estado / Subir Evidencia
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  MÓDULO: PORTAL CLIENTE (Dinámico)
// ─────────────────────────────────────────────────────────
const mostrarDato = (valor) => valor === null || valor === undefined || valor === "" ? "No registrado" : valor;
const mostrarNumero = (valor, unidad = "") => valor === null || valor === undefined
  ? "No registrado"
  : `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(valor)}${unidad}`;

function EstadoPortal({ cargando, error }) {
  if (cargando) return <p className="rounded-xl border bg-white p-5 text-sm text-slate-600">Cargando información…</p>;
  if (error) return <p className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{error}</p>;
  return null;
}

function ResumenSolicitud({ solicitud }) {
  if (!solicitud) return <p className="text-sm text-amber-950">No hay una solicitud registrada para esta cuenta.</p>;

  const historial = solicitud.historial_cfe?.[0];
  const usaHistorial = solicitud.modalidad === "historial_cfe";
  const bateria = solicitud.cubrir_baterias === 1
    ? `Sí${solicitud.cobertura_nocturna_pct ? `, ${solicitud.cobertura_nocturna_pct}% del consumo nocturno` : ""}`
    : solicitud.cubrir_baterias === 0 ? "No" : "No registrado";

  return (
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      <div><dt className="text-amber-800">Modalidad</dt><dd className="font-semibold text-amber-950">{usaHistorial ? "Historial CFE" : "Por electrodomésticos"}</dd></div>
      {usaHistorial ? (
        <>
          <div><dt className="text-amber-800">Consumo del recibo</dt><dd className="font-semibold text-amber-950">{mostrarNumero(solicitud.consumo_introducido_kwh ?? historial?.consumo_kwh, " kWh")}</dd></div>
          <div><dt className="text-amber-800">Periodo</dt><dd className="font-semibold capitalize text-amber-950">{mostrarDato(historial?.periodo)}</dd></div>
          <div><dt className="text-amber-800">Mes del periodo</dt><dd className="font-semibold text-amber-950">{mostrarDato(historial?.mes_inicio)}</dd></div>
        </>
      ) : (
        <>
          <div><dt className="text-amber-800">Consumo diario estimado</dt><dd className="font-semibold text-amber-950">{mostrarNumero(solicitud.consumo_diario_kwh, " kWh/día")}</dd></div>
          <div><dt className="text-amber-800">Aparatos registrados</dt><dd className="font-semibold text-amber-950">{solicitud.electrodomesticos?.length ?? 0}</dd></div>
        </>
      )}
      <div><dt className="text-amber-800">Consumo mensual estimado</dt><dd className="font-semibold text-amber-950">{mostrarNumero(solicitud.consumo_mensual_kwh, " kWh/mes")}</dd></div>
      <div><dt className="text-amber-800">Margen de crecimiento</dt><dd className="font-semibold text-amber-950">{mostrarNumero(solicitud.margen_crecimiento_pct, "%")}</dd></div>
      <div><dt className="text-amber-800">Consumo objetivo</dt><dd className="font-semibold text-amber-950">{mostrarNumero(solicitud.consumo_objetivo_kwh, " kWh/mes")}</dd></div>
      <div><dt className="text-amber-800">Preferencia de baterías</dt><dd className="font-semibold text-amber-950">{bateria}</dd></div>
    </dl>
  );
}

function PortalCliente({ usuarioActual, datos, cargando, error }) {
  const prospecto = datos?.prospecto;
  const cotizacion = datos?.cotizacion_emitida;

  return (
    <div className="mx-auto max-w-4xl space-y-7 p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Bienvenido, {prospecto?.nombre ?? usuarioActual.nombre}</h1>
      <EstadoPortal cargando={cargando} error={error} />
      {!cargando && !error && datos && (
        <article className="receipt-note p-6 sm:p-8" aria-label="Resumen de la solicitud o cotización">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-700">ATLAS · Resumen</p>
          <h2 className="mb-6 mt-2 text-2xl font-bold text-amber-950">{cotizacion?.estado ?? "Solicitud en preparación"}</h2>
          {cotizacion ? (
            <div className="space-y-5"><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-amber-800">Fecha de emisión</dt><dd className="font-semibold">{new Date(`${cotizacion.emitida_at.replace(" ", "T")}Z`).toLocaleString("es-MX")}</dd></div><div><dt className="text-amber-800">Precio final de venta</dt><dd className="text-xl font-bold">{fmt(cotizacion.precio_venta)}</dd></div></dl><div><h3 className="font-bold text-amber-950">Componentes incluidos</h3><ul className="mt-2 divide-y divide-amber-800/20 text-sm">{cotizacion.items.map((item, index) => <li key={`${item.modelo}-${index}`} className="flex justify-between gap-4 py-2"><span>{item.tipo} · {item.modelo}</span><b>{item.cantidad}</b></li>)}</ul></div><p className="text-xs text-amber-800">La aceptación de esta cotización todavía no está habilitada en el portal.</p></div>
          ) : <ResumenSolicitud solicitud={datos.solicitud} />}
        </article>
      )}
    </div>
  );
}

function DatosPersonales({ datos, cargando, error }) {
  const prospecto = datos?.prospecto;
  const campos = prospecto ? [
    ["Nombre", prospecto.nombre],
    ["Correo electrónico", prospecto.email],
    ["Teléfono", prospecto.telefono],
    ["Estado", prospecto.direccion_estado],
    ["Ciudad o municipio", prospecto.direccion_municipio],
    ["Colonia", prospecto.direccion_colonia],
    ["Código postal", prospecto.direccion_codigo_postal],
    ["Calle", prospecto.direccion_calle],
    ["Número exterior", prospecto.direccion_numero_exterior],
    ["Número interior", prospecto.direccion_numero_interior],
  ] : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div><h1 className="text-3xl font-bold text-slate-900">Datos personales</h1><p className="mt-2 text-sm text-slate-500">Información de consulta registrada en tu solicitud.</p></div>
      <EstadoPortal cargando={cargando} error={error} />
      {!cargando && !error && prospecto && (
        <dl className="grid gap-4 rounded-2xl border bg-white p-5 shadow-sm sm:grid-cols-2 sm:p-7">
          {campos.map(([etiqueta, valor]) => <div key={etiqueta} className="rounded-xl bg-slate-50 p-4"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{etiqueta}</dt><dd className="mt-1 break-words font-semibold text-slate-900">{mostrarDato(valor)}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  MÓDULO: REACTIVACIÓN COMERCIAL
// ─────────────────────────────────────────────────────────
function ListaSolicitudes({ registros, token, usuario, onActualizarRegistro }) {
  const [filtro, setFiltro] = useState("todos");
  const [registroDetalle, setRegistroDetalle] = useState(null);
  const [solicitudDetalle, setSolicitudDetalle] = useState(null);
  const [errorDetalle, setErrorDetalle] = useState("");
  const [mensajeDetalle, setMensajeDetalle] = useState("");
  const [margenComercial, setMargenComercial] = useState(25);
  const [precioVenta, setPrecioVenta] = useState("");
  const [motivoDevolucion, setMotivoDevolucion] = useState("");
  const [procesandoRevision, setProcesandoRevision] = useState(false);

  const estadoDe = (registro) => {
    if (!registro.solicitud_id) return "informacion_incompleta";
    const conservaEtapaTecnica = ["pendiente_revision_tecnica", "en_preparacion"].includes(registro.estado_flujo);
    if (conservaEtapaTecnica && registro.revision_tecnica_estado === "completada") return "revision_tecnica_completada";
    if (conservaEtapaTecnica && registro.revision_tecnica_estado === "en_revision") return "en_revision_tecnica";
    return registro.estado_flujo || "pendiente_revision_tecnica";
  };
  const fechaSolicitud = (valor) => valor
    ? new Date(`${valor.replace(" ", "T")}Z`).toLocaleString("es-MX")
    : "No registrada";
  const visibles = registros.filter((registro) => filtro === "todos" || estadoDe(registro) === filtro);

  const abrirDetalle = async (registro) => {
    setRegistroDetalle(registro);
    setSolicitudDetalle(null);
    setErrorDetalle("");
    setMensajeDetalle("");
    setMotivoDevolucion("");
    if (!registro.solicitud_id) return;
    try {
      const response = await fetch(`/api/solicitudes/${registro.solicitud_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el detalle.");
      setSolicitudDetalle(data);
      const costoInterno = data.revision_tecnica?.items?.reduce((total, item) => total + Number(item.subtotal), 0) ?? 0;
      setMargenComercial(25);
      setPrecioVenta((costoInterno * 1.25).toFixed(2));
    } catch (error) {
      setErrorDetalle(error.message);
    }
  };

  const costoInterno = solicitudDetalle?.revision_tecnica?.items?.reduce((total, item) => total + Number(item.subtotal), 0) ?? 0;
  const listaParaRevision = usuario.rol === "Agente"
    && solicitudDetalle?.estado_flujo === "en_preparacion"
    && solicitudDetalle?.revision_tecnica?.estado === "completada";

  const cambiarMargen = (valor) => {
    setMargenComercial(valor);
    const margen = Number(valor);
    if (Number.isFinite(margen)) setPrecioVenta((costoInterno * (1 + margen / 100)).toFixed(2));
  };

  const ejecutarRevision = async (accion, body) => {
    setProcesandoRevision(true); setErrorDetalle(""); setMensajeDetalle("");
    try {
      const response = await fetch(`/api/agente/solicitudes/${registroDetalle.solicitud_id}/${accion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo actualizar la revisión.");
      setSolicitudDetalle(data.solicitud);
      setRegistroDetalle(data.registro);
      onActualizarRegistro(data.registro);
      setMensajeDetalle(accion === "aprobar" ? "Cotización enviada al prospecto." : "Revisión devuelta al técnico responsable.");
      setMotivoDevolucion("");
    } catch (error) {
      setErrorDetalle(error.message);
    } finally {
      setProcesandoRevision(false);
    }
  };

  const aprobar = () => {
    const precio = Number(precioVenta);
    if (!Number.isFinite(precio) || precio <= 0) return setErrorDetalle("Ingresa un precio final de venta válido.");
    if (!window.confirm(`¿Enviar la cotización al prospecto por ${fmt(precio)}?`)) return;
    ejecutarRevision("aprobar", { precio_venta: precio });
  };

  const devolver = () => {
    if (!motivoDevolucion.trim()) return setErrorDetalle("Escribe el motivo de la devolución.");
    ejecutarRevision("devolver", { motivo: motivoDevolucion });
  };

  const consumoVisible = (registro) => {
    if (registro.consumo_introducido_kwh != null) return `${mostrarNumero(registro.consumo_introducido_kwh, " kWh")} (${registro.recibo_periodo || "periodo no registrado"})`;
    if (registro.consumo_mensual_kwh != null) return mostrarNumero(registro.consumo_mensual_kwh, " kWh/mes");
    return registro.consumo_kwh != null ? mostrarNumero(registro.consumo_kwh, " kWh/mes") : "No registrado";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">Cotizaciones Emitidas</h1><p className="mt-1 text-sm text-slate-500">Solicitudes persistidas; una solicitud sin precio no se presenta como cotización emitida.</p></div>
        <label className="text-sm font-medium text-slate-700">Filtrar por estado
          <select value={filtro} onChange={(event) => setFiltro(event.target.value)} className="mt-1 block w-full rounded-lg border bg-white px-3 py-2 sm:w-72">
            <option value="todos">Todos</option>
            {Object.entries(ESTADOS_SOLICITUD).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-[850px] w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-3">Prospecto</th><th className="p-3">Fecha de solicitud</th><th className="p-3">Consumo</th><th className="p-3">Agente</th><th className="p-3">Estado</th><th className="p-3">Detalle</th></tr></thead>
          <tbody className="divide-y">
            {visibles.map((registro) => <tr key={registro.id}>
              <td className="p-3 font-semibold text-slate-900">{registro.nombre}</td>
              <td className="p-3 text-slate-600">{fechaSolicitud(registro.solicitud_fecha)}</td>
              <td className="p-3 text-slate-600">{consumoVisible(registro)}</td>
              <td className="p-3 text-slate-600">{registro.agente_responsable || "No registrado"}</td>
              <td className="p-3"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${estadoDe(registro) === "revision_tecnica_completada" ? "bg-green-100 text-green-800" : "bg-indigo-50 text-indigo-700"}`}>{ESTADOS_SOLICITUD[estadoDe(registro)]}{estadoDe(registro) === "revision_tecnica_completada" ? " · Lista para revisión del agente" : ""}</span></td>
              <td className="p-3"><button onClick={() => abrirDetalle(registro)} className="font-semibold text-indigo-700 hover:underline">Ver detalle</button></td>
            </tr>)}
          </tbody>
        </table>
        {visibles.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No hay registros con este estado.</p>}
      </div>

      {registroDetalle && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">Detalle de la solicitud</h2><p className="text-sm text-slate-500">Consulta de solo lectura</p></div><button onClick={() => setRegistroDetalle(null)} className="rounded-lg border px-3 py-1 text-sm">Cerrar</button></div>
          {errorDetalle && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorDetalle}</p>}
          {mensajeDetalle && <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensajeDetalle}</p>}
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Prospecto</dt><dd className="font-semibold">{registroDetalle.nombre}</dd></div>
            <div><dt className="text-slate-500">Estado</dt><dd className="font-semibold">{ESTADOS_SOLICITUD[estadoDe(registroDetalle)]}</dd></div>
            <div><dt className="text-slate-500">Modalidad</dt><dd className="font-semibold">{registroDetalle.modalidad === "electrodomesticos" ? "Por electrodomésticos" : registroDetalle.modalidad === "historial_cfe" ? "Historial CFE" : "No registrada"}</dd></div>
            <div><dt className="text-slate-500">Consumo registrado</dt><dd className="font-semibold">{consumoVisible(registroDetalle)}</dd></div>
            <div><dt className="text-slate-500">Consumo objetivo</dt><dd className="font-semibold">{mostrarNumero(registroDetalle.consumo_objetivo_kwh, " kWh/mes")}</dd></div>
            <div><dt className="text-slate-500">Margen de crecimiento</dt><dd className="font-semibold">{mostrarNumero(registroDetalle.margen_crecimiento_pct, "%")}</dd></div>
            <div><dt className="text-slate-500">Agente responsable</dt><dd className="font-semibold">{registroDetalle.agente_responsable || "No registrado"}</dd></div>
            <div><dt className="text-slate-500">Baterías</dt><dd className="font-semibold">{registroDetalle.cubrir_baterias === 1 ? "Sí" : registroDetalle.cubrir_baterias === 0 ? "No" : "No registrado"}</dd></div>
          </dl>
          {solicitudDetalle?.electrodomesticos?.length > 0 && <div className="mt-5"><h3 className="font-semibold">Electrodomésticos</h3><ul className="mt-2 space-y-1 text-sm text-slate-600">{solicitudDetalle.electrodomesticos.map((equipo) => <li key={equipo.id}>{equipo.cantidad} × {equipo.tipo}: {mostrarNumero(equipo.consumo_total_kwh, " kWh/día")}</li>)}</ul></div>}
          {solicitudDetalle?.revision_tecnica?.items?.length > 0 && <section className="mt-6 space-y-3 border-t pt-5"><div><h3 className="font-semibold">Componentes propuestos por el técnico</h3><p className="text-xs text-slate-500">Costos internos; todavía no son el precio de venta.</p></div><div className="overflow-x-auto"><table className="min-w-[600px] w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Modelo</th><th className="p-2">Cantidad</th><th className="p-2">Costo unitario</th><th className="p-2">Subtotal</th></tr></thead><tbody>{solicitudDetalle.revision_tecnica.items.map((item) => <tr key={item.id} className="border-t"><td className="p-2"><b>{item.tipo_aplicado}</b><br/><span className="text-slate-500">{item.modelo_aplicado}</span></td><td className="p-2 text-center">{item.cantidad}</td><td className="p-2 text-right">{fmt(item.costo_unitario_aplicado)}</td><td className="p-2 text-right font-semibold">{fmt(item.subtotal)}</td></tr>)}</tbody></table></div><p className="text-right font-bold">Costo total interno: {fmt(costoInterno)}</p></section>}
          {solicitudDetalle?.revision_tecnica?.devoluciones?.length > 0 && <section className="mt-5 rounded-lg bg-amber-50 p-4"><h3 className="text-sm font-bold text-amber-900">Historial de devoluciones</h3><ul className="mt-2 space-y-2 text-sm text-amber-900">{solicitudDetalle.revision_tecnica.devoluciones.map((devolucion) => <li key={devolucion.id}><b>{devolucion.agente_nombre}:</b> {devolucion.motivo}<span className="block text-xs text-amber-700">Devuelta: {fechaSolicitud(devolucion.devuelta_at)} · {devolucion.atendida_at ? `Atendida: ${fechaSolicitud(devolucion.atendida_at)}` : "Pendiente de corrección"}</span></li>)}</ul></section>}
          {solicitudDetalle?.cotizacion && <section className="mt-5 rounded-lg border border-green-200 bg-green-50 p-4 text-sm"><h3 className="font-bold text-green-900">Cotización enviada al prospecto</h3><p className="mt-1 text-green-800">Versión {solicitudDetalle.cotizacion.version} · Precio final: <b>{fmt(solicitudDetalle.cotizacion.precio_venta)}</b></p><p className="text-xs text-green-700">Emitida: {fechaSolicitud(solicitudDetalle.cotizacion.emitida_at)}</p></section>}
          {listaParaRevision && <section className="mt-6 space-y-4 border-t pt-5"><div><h3 className="font-semibold">Revisión del agente</h3><p className="text-xs text-slate-500">El margen propone un precio, pero puedes confirmar otro precio final antes de enviarlo.</p></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Margen comercial (%)<input type="number" step="0.01" value={margenComercial} onChange={(event) => cambiarMargen(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"/></label><label className="text-sm font-medium">Precio final de venta<input type="number" min="0.01" step="0.01" value={precioVenta} onChange={(event) => setPrecioVenta(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"/></label></div><div className="rounded-lg bg-slate-50 p-3 text-sm">Costo interno: <b>{fmt(costoInterno)}</b> · Precio a confirmar: <b>{fmt(Number(precioVenta) || 0)}</b></div><label className="block text-sm font-medium">Motivo para devolver a corrección<textarea value={motivoDevolucion} onChange={(event) => setMotivoDevolucion(event.target.value)} rows="3" className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" placeholder="Describe qué debe corregir el técnico"/></label><div className="flex flex-col gap-2 sm:flex-row"><button disabled={procesandoRevision} onClick={aprobar} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:bg-green-300">Aprobar y enviar al prospecto</button><button disabled={procesandoRevision} onClick={devolver} className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-bold text-amber-800 disabled:opacity-50">Devolver para corrección</button></div></section>}
        </div>
      </div>}
    </div>
  );
}

function UsuariosPersonal({ token }) {
  const [personal, setPersonal] = useState([]);
  const [formulario, setFormulario] = useState({ nombre: "", email: "", telefono: "", rol: "", estado_trabajo_codigo: "" });
  const [filtros, setFiltros] = useState({ rol: "todos", estado: "todos", activo: "todos" });
  const [pestana, setPestana] = useState("registro");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/personal", { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(setPersonal)
      .catch((fetchError) => { if (fetchError.name !== "AbortError") setError(fetchError.message || "No se pudo cargar el personal."); });
    return () => controller.abort();
  }, [token]);

  const registrar = async (event) => {
    event.preventDefault(); setError(""); setMensaje("");
    if (!['Técnico', 'Agente'].includes(formulario.rol)) return setError("Selecciona un tipo de usuario válido.");
    if (!ESTADOS_MEXICO.some((estado) => estado.codigo === formulario.estado_trabajo_codigo)) return setError("Selecciona un estado de trabajo válido.");
    const response = await fetch("/api/personal", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(formulario) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "No se pudo registrar al personal.");
    setPersonal((actuales) => [data, ...actuales]);
    setFormulario({ nombre: "", email: "", telefono: "", rol: "", estado_trabajo_codigo: "" });
    setFiltros({ rol: "todos", estado: "todos", activo: "todos" });
    setMensaje("Personal registrado correctamente");
    setPestana("busqueda");
  };

  const cambiarActivo = async (persona) => {
    setError(""); setMensaje("");
    const response = await fetch(`/api/personal/${persona.id}/activo`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ activo: !persona.activo }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "No se pudo actualizar la cuenta.");
    setPersonal((actuales) => actuales.map((item) => item.id === data.id ? data : item));
  };

  const cambiarEstado = async (persona, estado_trabajo_codigo) => {
    if (!estado_trabajo_codigo) return;
    setError(""); setMensaje("");
    const response = await fetch(`/api/personal/${persona.id}/estado-trabajo`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ estado_trabajo_codigo }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "No se pudo actualizar el estado de trabajo.");
    setPersonal((actuales) => actuales.map((item) => item.id === data.id ? data : item));
    setMensaje("Estado de trabajo actualizado.");
  };

  const personalVisible = personal.filter((persona) => {
    const coincideRol = filtros.rol === "todos" || persona.rol === filtros.rol;
    const coincideEstado = filtros.estado === "todos" || persona.estado_trabajo_codigo === filtros.estado;
    const coincideActivo = filtros.activo === "todos" || Boolean(persona.activo) === (filtros.activo === "activos");
    return coincideRol && coincideEstado && coincideActivo;
  });

  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold">Usuarios y personal</h1><p className="mt-1 text-sm text-slate-500">Registra y consulta las cuentas del equipo de trabajo.</p></div>
    {(error || mensaje) && <p className={`rounded-lg p-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{error || mensaje}</p>}
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex border-b">
        <button type="button" onClick={() => setPestana("registro")} className={`flex-1 px-4 py-3 text-sm font-semibold ${pestana === "registro" ? "border-b-2 border-indigo-600 bg-indigo-50 text-indigo-700" : "text-slate-500"}`}>Registro de personal</button>
        <button type="button" onClick={() => setPestana("busqueda")} className={`flex-1 px-4 py-3 text-sm font-semibold ${pestana === "busqueda" ? "border-b-2 border-indigo-600 bg-indigo-50 text-indigo-700" : "text-slate-500"}`}>Búsqueda</button>
      </div>
      <div className="p-4 sm:p-5">
        {pestana === "registro" ? <form onSubmit={registrar} className="grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-semibold sm:col-span-2">Registrar personal</h2>
          {[['nombre','Nombre completo','Ej. Laura Martínez'],['email','Correo electrónico','Ej. laura@atlas.com'],['telefono','Teléfono','Ej. 8112345678']].map(([campo, etiqueta, ejemplo]) => <label key={campo} className="text-sm font-medium">{etiqueta}<input required type={campo === 'email' ? 'email' : 'text'} value={formulario[campo]} onChange={(event) => setFormulario({ ...formulario, [campo]: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"/><span className="mt-1 block text-xs font-normal text-slate-400">{ejemplo}</span></label>)}
          <label className="text-sm font-medium">Tipo de usuario<select required value={formulario.rol} onChange={(event) => setFormulario({ ...formulario, rol: event.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal"><option value="">Selecciona un tipo de usuario</option><option value="Técnico">Técnico</option><option value="Agente">Agente de ventas</option></select></label>
          <label className="text-sm font-medium sm:col-span-2">Estado de trabajo<select required value={formulario.estado_trabajo_codigo} onChange={(event) => setFormulario({ ...formulario, estado_trabajo_codigo: event.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal"><option value="">Selecciona un estado</option>{ESTADOS_MEXICO.map((estado) => <option key={estado.codigo} value={estado.codigo}>{estado.nombre}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-400">Se guarda con un código estable para futuras asignaciones por ubicación.</span></label>
          <div className="sm:col-span-2"><button className="w-full rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white sm:w-auto">Registrar personal</button></div>
        </form> : <div className="space-y-4">
          <h2 className="text-lg font-semibold">Personal registrado</h2>
          <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
            <label className="text-sm font-medium">Tipo de usuario<select value={filtros.rol} onChange={(event) => setFiltros({ ...filtros, rol: event.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal"><option value="todos">Todos</option><option value="Técnico">Técnicos</option><option value="Agente">Agentes de ventas</option></select></label>
            <label className="text-sm font-medium">Estado de trabajo<select value={filtros.estado} onChange={(event) => setFiltros({ ...filtros, estado: event.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal"><option value="todos">Todos los estados</option>{ESTADOS_MEXICO.map((estado) => <option key={estado.codigo} value={estado.codigo}>{estado.nombre}</option>)}</select></label>
            <label className="text-sm font-medium">Estatus<select value={filtros.activo} onChange={(event) => setFiltros({ ...filtros, activo: event.target.value })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal"><option value="todos">Todos</option><option value="activos">Activos</option><option value="inactivos">Inactivos</option></select></label>
          </div>
          {personalVisible.map((persona) => <article key={persona.id} className="grid gap-4 rounded-xl border p-4 md:grid-cols-[1fr_220px_auto] md:items-center"><div><p className="font-bold">{persona.nombre}</p><p className="text-sm text-slate-500">{persona.email}{persona.telefono ? ` · ${persona.telefono}` : " · Teléfono no registrado"}</p><p className="mt-1 text-xs font-semibold text-indigo-700">{persona.rol === "Agente" ? "Agente de ventas" : "Técnico"}</p>{persona.activo && persona.rol === "Técnico" && !persona.estado_trabajo_codigo && <p className="mt-1 text-xs font-semibold text-amber-700">Estado pendiente · No elegible para solicitudes por ubicación</p>}</div><label className="text-xs font-medium text-slate-500">Estado de trabajo<select value={persona.estado_trabajo_codigo || ""} onChange={(event) => cambiarEstado(persona, event.target.value)} className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${persona.estado_trabajo_codigo ? "bg-white text-slate-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}><option value="">Estado pendiente</option>{ESTADOS_MEXICO.map((estado) => <option key={estado.codigo} value={estado.codigo}>{estado.nombre}</option>)}</select>{persona.estado_trabajo_codigo && <span className="mt-1 block">Código: {persona.estado_trabajo_codigo} · {nombreEstadoMexico(persona.estado_trabajo_codigo)}</span>}</label><button onClick={() => cambiarActivo(persona)} className={`rounded-lg px-4 py-2 text-sm font-bold ${persona.activo ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"}`}>{persona.activo ? "Activo" : "Inactivo"}</button></article>)}
          {personalVisible.length === 0 && <p className="rounded-xl border border-dashed bg-slate-50 p-6 text-center text-sm text-slate-600">No hay personal que coincida con los filtros seleccionados.</p>}
        </div>}
      </div>
    </section>
  </div>;
}

function ReactivacionComercial({ clientes, setClientes }) {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <h2 className="text-xl font-semibold">Campañas de Reactivación</h2>
      <p className="text-sm text-slate-500 mb-4">Clientes inactivos por más de 12 meses (Umbral configurable por admin).</p>
      
      <table className="w-full bg-white border rounded-xl text-sm overflow-hidden">
        <thead className="bg-slate-50"><tr><th className="p-3 text-left">Cliente</th><th className="p-3 text-left">Meses Inactivo</th><th className="p-3 text-left">Resultado de Contacto</th></tr></thead>
        <tbody>
          {clientes.map(c => (
            <tr key={c.id} className="border-t">
              <td className="p-3 font-medium">{c.nombre} <br/><span className="text-xs text-slate-400">Última compra: {c.ultima_compra}</span></td>
              <td className="p-3 text-red-600 font-bold">{c.meses_inactivo} meses</td>
              <td className="p-3">
                <select value={c.estado_reactivacion} onChange={(e) => setClientes(clientes.map(x => x.id === c.id ? {...x, estado_reactivacion: e.target.value} : x))} className="border bg-slate-50 rounded px-2 py-1 text-xs w-full">
                  {ESTADOS_REACTIVACION.map(e => <option key={e}>{e}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  MÓDULOS: CALCULADORA, GENERADOR Y LEADS (Optimizados)
// ─────────────────────────────────────────────────────────

function CalculadoraSolar({ onCotizar, inventario, prospecto, onGuardarConsumo }) {
  const solicitudPersistida = Boolean(prospecto?.solicitud_id);
  const [form, setForm] = useState({
    consumo: prospecto?.consumo_kwh ?? "",
    ciudad: prospecto?.ciudad ?? "Monterrey",
    perdidas: String(prospecto?.perdidas ?? 80),
  });
  const [resultado, setResultado] = useState(null);

  const calcular = async () => {
    if (!form.consumo || Number(form.consumo) <= 0) return alert("Ingresa un consumo mayor que cero.");

    if (!solicitudPersistida) {
      try {
        await onGuardarConsumo({
          consumo_kwh: Number(form.consumo),
          ciudad: form.ciudad,
          perdidas: Number(form.perdidas),
        });
      } catch (error) {
        return alert(error.message);
      }
    }

    const irr = IRRADIACION[form.ciudad];
    const kwp_necesarios = (form.consumo / 30) / (irr * (form.perdidas/100));
    const panel = inventario.find(c => c.activo && c.clasificacion === "material" && c.tipo === "Panel");
    if(!panel) return alert("Error: No hay paneles registrados en el inventario.");
    
    const n_paneles = Math.ceil((kwp_necesarios * 1000) / panel.potencia_w);
    if(n_paneles > panel.existencias) return alert(`Stock insuficiente. Necesitas ${n_paneles} paneles, pero hay ${panel.existencias} disponibles.`);

    const inversor = inventario.find(c => c.activo && c.clasificacion === "material" && c.tipo === "Inversor");
    if(!inversor) return alert("Error: No hay inversores activos en el catálogo.");
    setResultado({ panel, n_paneles, kwp_real: (n_paneles * panel.potencia_w) / 1000, inversor, produccion: (n_paneles * panel.potencia_w) / 1000 * irr * 365 * (form.perdidas/100) });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h2 className="text-xl font-semibold">Calculadora de Dimensionamiento</h2>
      <div className="bg-white rounded-xl border p-6 grid grid-cols-2 gap-4">
        {solicitudPersistida ? (
          <>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-500">{prospecto.consumo_objetivo_kwh != null ? 'Consumo objetivo para dimensionamiento' : 'Consumo mensual equivalente'}</p><p className="font-bold">{Number(form.consumo).toFixed(2)} kWh</p>{prospecto.consumo_objetivo_kwh != null && <p className="text-xs text-slate-500">Base: {Number(prospecto.consumo_mensual_kwh).toFixed(2)} kWh · Margen: {prospecto.margen_crecimiento_pct} %</p>}</div>
            <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-500">Ciudad o municipio de la dirección</p><p className="font-bold">{prospecto.direccion_municipio || form.ciudad}</p>{prospecto.direccion_municipio && prospecto.direccion_municipio !== form.ciudad && <p className="text-xs text-slate-500">Categoría de irradiación utilizada: {form.ciudad}</p>}</div>
            {prospecto.potencia_conectada_w != null && <div className="bg-amber-50 rounded-lg p-3"><p className="text-xs text-slate-500">Potencia conectada aproximada</p><p className="font-bold">{Number(prospecto.potencia_conectada_w).toFixed(0)} W</p></div>}
            {prospecto.cubrir_baterias === 1 && <div className="bg-indigo-50 rounded-lg p-3"><p className="text-xs text-slate-500">Necesidad nocturna solicitada</p><p className="font-bold">{Number(prospecto.necesidad_bateria_kwh_dia).toFixed(2)} kWh/día</p><p className="text-xs text-indigo-700">Pendiente seleccionar batería y validar simultaneidad.</p></div>}
          </>
        ) : (
          <>
            <div><label className="block text-sm mb-1">Consumo (kWh)</label><input type="number" min="0.01" step="0.01" value={form.consumo} className="w-full border rounded px-3 py-2 text-sm" onChange={(e) => setForm({ ...form, consumo: e.target.value })} /></div>
            <div><label className="block text-sm mb-1">Ciudad</label><select value={form.ciudad} className="w-full border rounded px-3 py-2 text-sm" onChange={(e) => setForm({ ...form, ciudad: e.target.value })}>{Object.keys(IRRADIACION).map(c => <option key={c}>{c}</option>)}</select></div>
          </>
        )}
        <button onClick={calcular} className="col-span-2 bg-indigo-600 text-white py-2 rounded text-sm mt-2">Calcular sistema</button>
      </div>
      {resultado && (
        <div className="bg-green-50 rounded-xl border border-green-200 p-6">
          <h3 className="font-semibold text-green-800 mb-2">Sistema Sugerido ({resultado.kwp_real.toFixed(2)} kWp)</h3>
          <p className="text-sm">Paneles: {resultado.n_paneles}x {resultado.panel.modelo} | Inversor: 1x {resultado.inversor.modelo}</p>
          <button onClick={() => onCotizar(resultado)} className="w-full bg-green-600 text-white py-2 rounded text-sm mt-4">Generar Cotización Formal →</button>
        </div>
      )}
    </div>
  );
}

function GeneradorCotizacion({ lead, resultadoSolar, inventario, onGuardar }) {
  const [margen, setMargen] = useState(25);
  
  // Imprimir PDF usando el navegador
  const exportarPDF = () => {
    window.print();
  };

  if (!resultadoSolar) return <p className="p-6">Usa la calculadora primero.</p>;
  
  const items = [
    { ...resultadoSolar.panel, cantidad: resultadoSolar.n_paneles },
    { ...resultadoSolar.inversor, cantidad: 1 },
    { ...inventario.find(c => c.activo && c.clasificacion === "material" && c.tipo === "Estructura"), cantidad: resultadoSolar.n_paneles },
    { ...inventario.find(c => c.activo && c.clasificacion === "material" && c.tipo === "Cableado"), cantidad: 1 },
    { ...inventario.find(c => c.activo && c.clasificacion === "servicio" && c.tipo === "Mano de obra"), cantidad: 1 },
  ].map(it => ({ ...it, subtotal: (it.precio || 0) * (it.cantidad || 1) }));
  
  const costoTotal = items.reduce((s, i) => s + i.subtotal, 0);
  const precioVenta = costoTotal * (1 + margen / 100);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4 print:p-0">
      <div className="flex justify-between items-center print:hidden">
        <h2 className="text-xl font-semibold">Propuesta Comercial</h2>
        <button onClick={exportarPDF} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
          📄 Descargar PDF
        </button>
      </div>
      
      {/* Zona imprimible */}
      <div className="bg-white rounded-xl border p-8 print:border-none print:shadow-none" id="documento-pdf">
        <div className="border-b pb-4 mb-4 flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-indigo-700">ATLAS CRM Energy</h1>
            <p className="text-sm text-slate-500">Cotización formal de instalación fotovoltaica</p>
          </div>
          <div className="text-right text-sm">
            <p><b>Cliente:</b> {lead?.nombre || "Público General"}</p>
            <p><b>Fecha:</b> {new Date().toLocaleDateString()}</p>
          </div>
        </div>

        <table className="w-full text-sm mb-6">
          <thead><tr className="bg-slate-100 text-left"><th className="p-2">Concepto</th><th className="p-2">Cant.</th><th className="p-2 text-right">Subtotal</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-b"><td className="p-2">{it.modelo}</td><td className="p-2">{it.cantidad}</td><td className="p-2 text-right">{fmt(it.subtotal)}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="print:hidden mb-6">
          <label className="block text-sm mb-1 font-medium">Ajuste de Margen Comercial ({margen}%)</label>
          <input type="range" min="10" max="50" value={margen} onChange={(e) => setMargen(Number(e.target.value))} className="w-full" />
        </div>

        <div className="bg-indigo-50 p-4 rounded-lg text-right border border-indigo-100">
          <p className="text-sm text-slate-600">Subtotal Proyecto: {fmt(costoTotal)}</p>
          <p className="text-xl font-bold text-indigo-700 mt-2">INVERSIÓN TOTAL: {fmt(precioVenta)}</p>
          <p className="text-xs text-slate-500 mt-1">Precios expresados en MXN. Vigencia de 15 días.</p>
        </div>
      </div>

      <button onClick={onGuardar} className="w-full bg-indigo-600 text-white font-medium py-3 rounded-xl print:hidden">
        Finalizar vista previa
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  APP PRINCIPAL — ENRUTADOR POR ROLES
// ─────────────────────────────────────────────────────────
export default function App() {
  const [usuarioActual, setUsuarioActual] = useState(null);

  const [pagina, setPagina] = useState("dashboard");
  const [sidebarContraido, setSidebarContraido] = useState(() => {
    try { return window.localStorage.getItem("atlas.sidebarContraido") === "1"; } catch { return false; }
  });
  const [inventario, setInventario] = useState([]);
  const [errorInventario, setErrorInventario] = useState("");
  const [leads, setLeads] = useState([]);
  const [errorApi, setErrorApi] = useState("");
  const [inactivos, setInactivos] = useState(CLIENTES_INACTIVOS_INICIALES);
  const [tickets, setTickets] = useState(TICKETS_INICIALES);
  const [leadActivo, setLeadActivo] = useState(null);
  const [resultadoSolar, setResultadoSolar] = useState(null);
  const [datosPortal, setDatosPortal] = useState(null);
  const [cargandoPortal, setCargandoPortal] = useState(false);
  const [errorPortal, setErrorPortal] = useState("");

  useEffect(() => {
    if (!usuarioActual || !["Administrador", "Agente"].includes(usuarioActual.rol)) return;
    const controller = new AbortController();

    fetch("/api/prospectos", { signal: controller.signal, headers: { Authorization: `Bearer ${usuarioActual.token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar los prospectos.");
        return response.json();
      })
      .then((prospectos) => {
        setLeads(prospectos);
        setErrorApi("");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setErrorApi("No se pudieron cargar las solicitudes persistidas.");
      });

    return () => controller.abort();
  }, [usuarioActual]);

  useEffect(() => {
    if (!usuarioActual || !["Administrador", "Agente", "Técnico"].includes(usuarioActual.rol)) return;
    const controller = new AbortController();
    fetch("/api/productos", { signal: controller.signal, headers: { Authorization: `Bearer ${usuarioActual.token}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then((productos) => { setInventario(productos); setErrorInventario(""); })
      .catch((error) => { if (error.name !== "AbortError") setErrorInventario(error.message || "No se pudo cargar el catálogo."); });
    return () => controller.abort();
  }, [usuarioActual]);

  useEffect(() => {
    if (usuarioActual?.rol !== "Cliente" || !usuarioActual.prospecto_id) return;

    const controller = new AbortController();
    fetch(`/api/portal/prospectos/${usuarioActual.prospecto_id}`, { signal: controller.signal, headers: { Authorization: `Bearer ${usuarioActual.token}` } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo cargar la información del portal.");
        return data;
      })
      .then((data) => setDatosPortal(data))
      .catch((error) => {
        if (error.name !== "AbortError") {
          setDatosPortal(null);
          setErrorPortal(error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargandoPortal(false);
      });

    return () => controller.abort();
  }, [usuarioActual]);

  const registrarSolicitud = async (solicitud) => {
    const response = await fetch("/api/solicitudes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${usuarioActual.token}` },
      body: JSON.stringify(solicitud),
    });
    const data = await response.json();
    if (!response.ok) {
      const mensaje = data.error || "No se pudo guardar la solicitud.";
      setErrorApi(mensaje);
      throw new Error(mensaje);
    }

    setLeads((actuales) => [data.registro, ...actuales]);
    setErrorApi("");
    alert(`Solicitud registrada correctamente.\nPuedes consultarla en Cotizaciones Emitidas.\nCuenta del cliente: ${data.registro.email}\nContraseña temporal: 123`);
    return data;
  };

  const autenticarUsuario = async (email, password) => {
    const emailNormalizado = email.trim().toLowerCase();
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailNormalizado, password }),
    });
    const usuario = await response.json();
    if (!response.ok) throw new Error(usuario.error || "Credenciales incorrectas. Verifica tu correo y contraseña.");

    setDatosPortal(null);
    if (usuario.rol === "Cliente" && usuario.prospecto_id) {
      setCargandoPortal(true);
      setErrorPortal("");
    } else {
      setCargandoPortal(false);
      setErrorPortal("");
    }
    setUsuarioActual(usuario);
    setPagina(usuario.rol === 'Cliente' ? 'portal_cliente' : usuario.rol === 'Técnico' ? 'solicitudes_dimensionamiento' : 'dashboard');
  };

  const actualizarConsumoProspecto = async (consumo) => {
    if (!leadActivo) throw new Error("Selecciona un prospecto antes de calcular.");

    const response = await fetch(`/api/prospectos/${leadActivo.id}/consumo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${usuarioActual.token}` },
      body: JSON.stringify(consumo),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo guardar el consumo.");

    setLeads((actuales) => actuales.map((lead) => lead.id === data.id ? data : lead));
    setLeadActivo(data);
    setErrorApi("");
    return data;
  };

  if (!usuarioActual) return <Login onLogin={autenticarUsuario} />;

  // Filtrado de menú lateral según el rol
  const getNavItems = () => {
    const rol = usuarioActual.rol;
    if (rol === "Cliente") return [
      { key: "portal_cliente", label: "Inicio", icon: "🏠" },
      { key: "datos_personales", label: "Datos personales", icon: "👤" },
    ];
    if (rol === "Técnico") return [
      { key: "solicitudes_dimensionamiento", label: "Solicitudes de dimensionamiento", icon: "📐" },
      { key: "portal_tecnico", label: "Mis Tickets", icon: "🔧" },
      { key: "inventario", label: "Inventario Físico", icon: "📦" },
    ];
    if (rol === "Administrador") return [
      { key: "dashboard", label: "Dashboard", icon: "📊" },
      { key: "reactivacion", label: "Reactivación Comercial", icon: "📞" },
      { key: "historial", label: "Cotizaciones Emitidas", icon: "📄" },
      { key: "inventario", label: "Inventario Físico", icon: "📦" },
      { key: "usuarios", label: "Usuarios y personal", icon: "👥" },
    ];
    return [
      { key: "dashboard", label: "Dashboard", icon: "📊" },
      { key: "leads", label: "Cotización", icon: "🧾" },
      { key: "reactivacion", label: "Reactivación Comercial", icon: "📞" },
      { key: "historial", label: "Cotizaciones Emitidas", icon: "📄" },
      { key: "inventario", label: "Inventario Físico", icon: "📦" },
    ];
  };

  // Cálculos dinámicos para el Dashboard
  const leadsActivos = leads.filter(l => l.estado !== "Cerrado ganado" && l.estado !== "Cerrado perdido").length;
  const cotizacionesEmitidas = leads.filter((registro) => ["pendiente_respuesta", "aceptada_pendiente_pago", "venta_confirmada"].includes(registro.estado_flujo));
  const ingresosProyectados = 0;

  const alternarSidebar = () => {
    const contraido = !sidebarContraido;
    setSidebarContraido(contraido);
    try { window.localStorage.setItem("atlas.sidebarContraido", contraido ? "1" : "0"); } catch { /* El navegador puede bloquear el almacenamiento local. */ }
  };

  const cerrarSesion = () => {
    fetch("/api/logout", { method: "POST", headers: { Authorization: `Bearer ${usuarioActual.token}` } }).catch(() => {});
    setUsuarioActual(null);
    setDatosPortal(null);
    setLeads([]);
    setInventario([]);
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Menú lateral (oculto al imprimir) */}
      <aside className={`${sidebarContraido ? "w-16" : "w-64"} shrink-0 bg-white border-r flex flex-col transition-[width] duration-200 print:hidden`}>
        <div className={`border-b ${sidebarContraido ? "px-2 py-4" : "p-5"}`}>
          <div className={`flex items-center ${sidebarContraido ? "flex-col gap-3" : "justify-between gap-2"}`}>
            <p className="text-xl font-bold text-indigo-700" title={sidebarContraido ? "ATLAS CRM" : undefined}>{sidebarContraido ? "A" : "ATLAS CRM"}</p>
            <button type="button" onClick={alternarSidebar} aria-expanded={!sidebarContraido} aria-label={sidebarContraido ? "Expandir menú" : "Contraer menú"} title={sidebarContraido ? "Expandir menú" : "Contraer menú"} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
              <span aria-hidden="true" className="block text-sm leading-none">{sidebarContraido ? "»" : "«"}</span>
            </button>
          </div>
          {sidebarContraido ? (
            <div className="mx-auto mt-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700" title={usuarioActual.rol === "Cliente" ? "Prospecto" : `${usuarioActual.rol} · ${usuarioActual.nombre}`}>
              {(usuarioActual.rol === "Cliente" ? "Prospecto" : usuarioActual.nombre || usuarioActual.rol).charAt(0).toUpperCase()}
            </div>
          ) : (
            <div className="mt-2 bg-slate-100 p-2 rounded text-xs">
              {usuarioActual.rol === "Cliente" ? (
                <span className="font-bold text-slate-700">Prospecto</span>
              ) : (
                <><span className="font-bold text-slate-700">{usuarioActual.rol}</span><br/><span className="text-slate-500">{usuarioActual.nombre}</span></>
              )}
            </div>
          )}
        </div>
        <nav className={`flex-1 space-y-1 ${sidebarContraido ? "p-2" : "p-3"}`}>
          {getNavItems().map((n) => (
            <button key={n.key} onClick={() => setPagina(n.key)} aria-label={sidebarContraido ? n.label : undefined} aria-current={pagina === n.key ? "page" : undefined} className={`group relative w-full flex items-center rounded-lg text-sm text-left transition-colors ${sidebarContraido ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5"} ${pagina === n.key ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-600 hover:bg-slate-50"}`}>
              <span className="text-lg" aria-hidden={sidebarContraido || undefined}>{n.icon}</span>{!sidebarContraido && n.label}
              {sidebarContraido && <span aria-hidden="true" className="pointer-events-none absolute left-full z-40 ml-2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{n.label}</span>}
            </button>
          ))}
        </nav>
        <button onClick={cerrarSesion} aria-label={sidebarContraido ? "Cerrar sesión" : undefined} className={`group relative border rounded-lg text-sm text-slate-600 hover:bg-slate-50 font-medium ${sidebarContraido ? "mx-2 my-4 py-2" : "m-4 py-2"}`}>
          {sidebarContraido ? <span aria-hidden="true">🚪</span> : "Cerrar Sesión"}
          {sidebarContraido && <span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Cerrar sesión</span>}
        </button>
      </aside>

      {/* Contenedor principal */}
      <main className="flex-1 overflow-y-auto">
        {pagina === "dashboard" && (
          <div className="p-6 max-w-4xl mx-auto space-y-6">
            <h2 className="text-xl font-semibold text-slate-900">Dashboard Dinámico</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-xl p-4">
                <p className="text-xs text-slate-500">Solicitudes en proceso</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{leadsActivos}</p>
              </div>
              <div className="bg-indigo-50 rounded-xl p-4">
                <p className="text-xs text-slate-500">Cotizaciones Totales</p>
                <p className="text-3xl font-bold text-indigo-600 mt-1">{cotizacionesEmitidas.length}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-xs text-slate-500">Ingresos (Aprobadas)</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{fmt(ingresosProyectados)}</p>
              </div>
            </div>
            <p className="text-sm text-slate-400 mt-4">Selecciona un módulo en el menú lateral para comenzar a operar.</p>
          </div>
        )}
        
        {pagina === "leads" && <Cotizacion
          errorApi={errorApi}
          onRegistrar={registrarSolicitud}
        />}

        {pagina === "calc" && <CalculadoraSolar key={leadActivo?.id} inventario={inventario} prospecto={leadActivo} onGuardarConsumo={actualizarConsumoProspecto} onCotizar={(res) => { setResultadoSolar(res); setPagina("cotizacion"); }} />}
        {pagina === "cotizacion" && <GeneradorCotizacion lead={leadActivo} resultadoSolar={resultadoSolar} inventario={inventario} onGuardar={() => setPagina("historial")} />}
        {pagina === "inventario" && <><GestionInventario inventario={inventario} setInventario={setInventario} usuario={usuarioActual} />{errorInventario && <p className="mx-auto max-w-6xl px-6 pb-6 text-sm text-red-700">{errorInventario}</p>}</>}
        {pagina === "reactivacion" && <ReactivacionComercial clientes={inactivos} setClientes={setInactivos} />}
        {pagina === "portal_tecnico" && <PortalTecnico tickets={tickets} setTickets={setTickets} />}
        {pagina === "solicitudes_dimensionamiento" && <SolicitudesDimensionamiento token={usuarioActual.token} inventario={inventario} />}
        
        {pagina === "portal_cliente" && <PortalCliente usuarioActual={usuarioActual} datos={datosPortal} cargando={cargandoPortal} error={errorPortal} />}
        {pagina === "datos_personales" && <DatosPersonales datos={datosPortal} cargando={cargandoPortal} error={errorPortal} />}
        {pagina === "historial" && <ListaSolicitudes registros={leads} token={usuarioActual.token} usuario={usuarioActual} onActualizarRegistro={(registro) => setLeads((actuales) => actuales.map((item) => item.id === registro.id ? registro : item))} />}
        {pagina === "usuarios" && usuarioActual.rol === "Administrador" && <UsuariosPersonal token={usuarioActual.token} />}
      </main>
    </div>
  );
}

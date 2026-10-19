import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import {
  generarCsvInventario,
  generarExcelInventario,
  guardarArchivo,
  leerArchivoInventario,
  LIMITE_FILAS_IMPORTACION,
} from "./inventarioArchivos.js";

const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
const TIPOS = ["Panel", "Inversor", "Estructura", "Cableado", "Mano de obra", "Batería", "Extra"];
const BOTON_PRIMARIO = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
const BOTON_SECUNDARIO = "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50";
const BOTON_PELIGRO = "rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
const ETIQUETA = "block text-sm font-medium";
const CAMPO = "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal";
const RESULTADOS = {
  nuevo: ["Nuevo", "bg-indigo-50 text-indigo-700"],
  actualizar: ["Actualizar", "bg-green-50 text-green-700"],
  sin_cambios: ["Sin cambios", "bg-slate-100 text-slate-600"],
  invalida: ["Inválida", "bg-red-50 text-red-700"],
};
const NOMBRES_CAMPO = {
  tipo: "Tipo", modelo: "Modelo", clasificacion: "Clase", costo_unitario: "Costo", existencias: "Existencias",
  marca: "Marca", capacidad_kwh: "Capacidad (kWh)", potencia_w: "Potencia (W)", potencia_kw: "Potencia (kW)", activo: "Estado",
};

const plural = (n, singular, varios) => `${n} ${n === 1 ? singular : varios}`;
const tamanoLegible = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fechaArchivo = () => new Date().toISOString().slice(0, 10);

function valorCambio(campo, valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (campo === "costo_unitario") return fmt(valor);
  if (campo === "activo") return valor ? "Activo" : "Inactivo";
  if (campo === "clasificacion") return valor === "servicio" ? "Servicio" : "Material físico";
  return String(valor);
}

function detalleTecnico(producto) {
  return [
    producto.marca,
    producto.potencia_w ? `${producto.potencia_w} W` : null,
    producto.potencia_kw ? `${producto.potencia_kw} kW` : null,
    producto.capacidad_kwh ? `${producto.capacidad_kwh} kWh` : null,
  ].filter(Boolean).join(" · ");
}

// Avisos dentro de la página que desaparecen solos.
function useAviso() {
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    if (!aviso) return;
    const temporizador = setTimeout(() => setAviso(null), aviso.tipo === "error" ? 8000 : 4500);
    return () => clearTimeout(temporizador);
  }, [aviso]);
  const avisar = useCallback((tipo, texto) => setAviso({ tipo, texto, id: Date.now() }), []);
  return [aviso, avisar, () => setAviso(null)];
}

export default function InventarioFisico({ inventario, setInventario, usuario }) {
  const isAdmin = usuario.rol === "Administrador";
  const [proveedores, setProveedores] = useState([]);
  const [aviso, avisar, cerrarAviso] = useAviso();
  const [modal, setModal] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [exportando, setExportando] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [leyendoArchivo, setLeyendoArchivo] = useState(false);
  const [revision, setRevision] = useState(null);
  const [revisando, setRevisando] = useState(false);
  const selectorArchivo = useRef(null);
  const inicio = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/proveedores", { signal: controller.signal, headers: { Authorization: `Bearer ${usuario.token}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(setProveedores)
      .catch((fetchError) => { if (fetchError.name !== "AbortError") avisar("error", fetchError.message || "No se pudieron cargar los proveedores."); });
    return () => controller.abort();
  }, [usuario.token, avisar]);

  const solicitarApi = async (url, options) => {
    const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${usuario.token}`, ...options?.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "No se pudo completar la operación.");
      error.estado = response.status;
      error.datos = data;
      throw error;
    }
    return data;
  };

  const reemplazarProducto = (data) => setInventario((actual) => actual.map((producto) => producto.id === data.id ? data : producto));

  const recargar = async () => {
    setRecargando(true);
    try {
      const productos = await solicitarApi("/api/productos");
      setInventario(productos);
      avisar("exito", `Inventario actualizado: ${plural(productos.length, "producto", "productos")}.`);
    } catch (apiError) {
      avisar("error", apiError.message);
    } finally {
      setRecargando(false);
    }
  };

  const crearProducto = async (datos) => {
    const data = await solicitarApi("/api/productos", { method: "POST", body: JSON.stringify(datos) });
    setInventario((actual) => [...actual, data]);
    setModal(null);
    avisar("exito", `Producto ${data.codigo} agregado.`);
  };

  const editarProducto = async (producto, datos) => {
    const data = await solicitarApi(`/api/productos/${producto.id}`, { method: "PATCH", body: JSON.stringify(datos) });
    reemplazarProducto(data);
    setModal(null);
    avisar("exito", `Producto ${data.codigo} actualizado.`);
  };

  const cambiarActivo = async (producto, activo, motivo = null) => {
    const data = await solicitarApi(`/api/productos/${producto.id}/activo`, { method: "PATCH", body: JSON.stringify({ activo, motivo }) });
    reemplazarProducto(data);
    setModal(null);
    avisar("exito", activo ? `Producto ${data.codigo} reactivado.` : `Producto ${data.codigo} dado de baja sin eliminar su historial.`);
  };

  const exportar = async (formato) => {
    setExportando(formato);
    try {
      const esExcel = formato === "xlsx";
      const guardado = await guardarArchivo({
        nombre: `inventario_atlas_${fechaArchivo()}.${formato}`,
        descripcion: esExcel ? "Libro de Excel" : "Archivo CSV",
        mime: esExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
        construir: () => esExcel ? generarExcelInventario(inventario) : generarCsvInventario(inventario),
      });
      if (guardado) avisar("exito", `Inventario exportado a ${esExcel ? "Excel" : "CSV"} (${plural(inventario.length, "producto", "productos")}).`);
    } catch (exportError) {
      avisar("error", `No se pudo exportar el inventario: ${exportError.message}`);
    } finally {
      setExportando(null);
    }
  };

  const seleccionarArchivo = async (event) => {
    const elegido = event.target.files?.[0];
    event.target.value = "";
    if (!elegido) return;
    setLeyendoArchivo(true);
    setRevision(null);
    try {
      const datos = await leerArchivoInventario(elegido);
      setArchivo({ nombre: elegido.name, tamano: elegido.size, ...datos });
    } catch (lecturaError) {
      setArchivo({ nombre: elegido.name, tamano: elegido.size, error: lecturaError.message });
    } finally {
      setLeyendoArchivo(false);
    }
  };

  const revisarArchivo = async () => {
    setRevisando(true);
    try {
      const data = await solicitarApi("/api/productos/importacion/previsualizar", {
        method: "POST",
        body: JSON.stringify({ archivo: archivo.nombre, columnas: archivo.columnas, filas: archivo.filas }),
      });
      setRevision(data);
      inicio.current?.scrollIntoView({ block: "start" });
    } catch (apiError) {
      avisar("error", apiError.message);
    } finally {
      setRevisando(false);
    }
  };

  const confirmarImportacion = async () => {
    try {
      const data = await solicitarApi("/api/productos/importacion/confirmar", {
        method: "POST",
        body: JSON.stringify({ archivo: archivo.nombre, columnas: archivo.columnas, filas: archivo.filas, firma: revision.firma }),
      });
      setInventario(data.productos);
      setRevision(null);
      setArchivo(null);
      setModal(null);
      avisar("exito", `Importación aplicada: ${plural(data.agregados, "producto agregado", "productos agregados")} y ${plural(data.actualizados, "actualizado", "actualizados")}.`);
    } catch (apiError) {
      // Si el catálogo cambió, la vista previa se actualiza con la nueva revisión para volver a confirmar.
      if (apiError.estado === 409 && apiError.datos?.revision) {
        setRevision(apiError.datos.revision);
        throw new Error("El catálogo cambió desde la revisión. La vista previa y el resumen ya se actualizaron; revísalos y confirma de nuevo.", { cause: apiError });
      }
      throw apiError;
    }
  };

  const descartarArchivo = () => { setArchivo(null); setRevision(null); };
  const etapa = revision ? "Vista previa" : archivo ? (archivo.error ? "Archivo con errores" : "Archivo listo") : "Catálogo";

  return (
    <div ref={inicio} className="mx-auto max-w-6xl scroll-mt-4 space-y-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inventario físico</h1>
          <p className="mt-1 text-sm text-slate-500">Materiales y servicios disponibles para las cotizaciones de ATLAS.</p>
        </div>
        <span className="shrink-0 rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{etapa}</span>
      </div>

      {aviso && (
        <div key={aviso.id} role={aviso.tipo === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-lg p-3 text-sm ${aviso.tipo === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
          <span>{aviso.texto}</span>
          <button type="button" onClick={cerrarAviso} aria-label="Cerrar aviso" className="leading-none opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <input ref={selectorArchivo} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={seleccionarArchivo} />

      {revision ? (
        <VistaPreviaImportacion
          revision={revision}
          onVolver={() => setRevision(null)}
          onConfirmar={() => setModal({ tipo: "confirmar_importacion" })}
        />
      ) : (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={recargar} disabled={recargando} className={BOTON_SECUNDARIO}>{recargando ? "Recargando…" : "Recargar"}</button>
            {isAdmin && <>
              <button type="button" onClick={() => setModal({ tipo: "proveedores" })} className={BOTON_SECUNDARIO}>Proveedores</button>
              <button type="button" onClick={() => setModal({ tipo: "nuevo" })} className={BOTON_SECUNDARIO}>Nuevo producto</button>
              <button type="button" onClick={() => exportar("csv")} disabled={Boolean(exportando)} className={BOTON_SECUNDARIO}>{exportando === "csv" ? "Exportando…" : "Exportar CSV"}</button>
              <button type="button" onClick={() => exportar("xlsx")} disabled={Boolean(exportando)} className={BOTON_SECUNDARIO}>{exportando === "xlsx" ? "Exportando…" : "Exportar Excel"}</button>
              <button type="button" onClick={() => selectorArchivo.current?.click()} disabled={leyendoArchivo} className={BOTON_PRIMARIO}>{leyendoArchivo ? "Leyendo archivo…" : "Importar CSV"}</button>
            </>}
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Catálogo actual</h2>
              <p className="text-sm text-slate-500">Consultar productos no reserva ni descuenta existencias.</p>
            </div>
            <TablaCatalogo
              inventario={inventario}
              isAdmin={isAdmin}
              onEditar={(producto) => setModal({ tipo: "editar", producto })}
              onBaja={(producto) => setModal({ tipo: "baja", producto })}
              onReactivar={(producto) => setModal({ tipo: "reactivar", producto })}
            />
          </section>

          {isAdmin && archivo && (
            <SeccionArchivo
              archivo={archivo}
              revisando={revisando}
              onRevisar={revisarArchivo}
              onCambiar={() => selectorArchivo.current?.click()}
              onDescartar={descartarArchivo}
            />
          )}
        </>
      )}

      {modal?.tipo === "nuevo" && <ModalProducto onCerrar={() => setModal(null)} onGuardar={crearProducto} />}
      {modal?.tipo === "editar" && <ModalProducto producto={modal.producto} onCerrar={() => setModal(null)} onGuardar={(datos) => editarProducto(modal.producto, datos)} />}
      {modal?.tipo === "baja" && <ModalBaja producto={modal.producto} onCerrar={() => setModal(null)} onConfirmar={(motivo) => cambiarActivo(modal.producto, false, motivo)} />}
      {modal?.tipo === "reactivar" && <ModalReactivar producto={modal.producto} onCerrar={() => setModal(null)} onConfirmar={() => cambiarActivo(modal.producto, true)} />}
      {modal?.tipo === "proveedores" && <ModalProveedores proveedores={proveedores} setProveedores={setProveedores} solicitarApi={solicitarApi} onCerrar={() => setModal(null)} />}
      {modal?.tipo === "confirmar_importacion" && revision && <ModalConfirmarImportacion revision={revision} onCerrar={() => setModal(null)} onConfirmar={confirmarImportacion} />}
    </div>
  );
}

function TablaCatalogo({ inventario, isAdmin, onEditar, onBaja, onReactivar }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[850px] text-sm">
        <thead className="border-b bg-slate-50">
          <tr>
            <th className="p-3 text-left">Código</th><th className="p-3 text-left">Clase</th><th className="p-3 text-left">Tipo / Modelo</th>
            <th className="p-3 text-left">Costo base</th><th className="p-3 text-left">Existencias</th><th className="p-3 text-left">Estado</th>
            {isAdmin && <th className="p-3 text-left">Acciones</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {inventario.map((item) => (
            <tr key={item.id} className={`hover:bg-slate-50 ${item.activo ? "" : "opacity-60"}`}>
              <td className="p-3 font-semibold text-slate-800">{item.codigo}</td>
              <td className="p-3"><span className={`rounded px-2 py-1 text-xs font-bold ${item.clasificacion === "servicio" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"}`}>{item.clasificacion === "servicio" ? "Servicio" : "Material físico"}</span></td>
              <td className="p-3">
                <span className="font-medium">{item.tipo}</span> <span className="text-slate-400">|</span> <span className="text-slate-600">{item.modelo}</span>
                {detalleTecnico(item) && <span className="block text-xs text-slate-500">{detalleTecnico(item)}</span>}
              </td>
              <td className="p-3 font-medium">{fmt(item.costo_unitario)}</td>
              <td className="p-3">{item.clasificacion === "servicio" ? <span className="text-slate-400">No aplica</span> : <span className={`text-xs font-bold ${item.existencias > 10 ? "text-green-700" : "text-red-600"}`}>{item.existencias} uds.</span>}</td>
              <td className="p-3">
                <span className={`text-xs font-bold ${item.activo ? "text-green-700" : "text-slate-500"}`}>{item.activo ? "Activo" : "Inactivo"}</span>
                {!item.activo && item.motivo_baja && <span className="block max-w-[180px] truncate text-xs text-slate-500" title={item.motivo_baja}>{item.motivo_baja}</span>}
              </td>
              {isAdmin && (
                <td className="space-x-2 whitespace-nowrap p-3">
                  <button type="button" onClick={() => onEditar(item)} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100">Editar</button>
                  {item.activo
                    ? <button type="button" onClick={() => onBaja(item)} className="rounded bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100">Dar de baja</button>
                    : <button type="button" onClick={() => onReactivar(item)} className="rounded bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100">Reactivar</button>}
                </td>
              )}
            </tr>
          ))}
          {inventario.length === 0 && <tr><td colSpan={isAdmin ? 7 : 6} className="p-6 text-center text-slate-500">No hay productos en el catálogo.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SeccionArchivo({ archivo, revisando, onRevisar, onCambiar, onDescartar }) {
  const totalFilas = archivo.filas?.length ?? 0;
  const problemas = [];
  if (archivo.error) problemas.push(archivo.error);
  else {
    if (archivo.faltantes.length) problemas.push(`Faltan columnas obligatorias: ${archivo.faltantes.join(", ")}.`);
    if (totalFilas === 0) problemas.push("El archivo no tiene filas de productos debajo del encabezado.");
    if (totalFilas > LIMITE_FILAS_IMPORTACION) problemas.push(`El archivo tiene ${totalFilas} filas; el máximo por importación es ${LIMITE_FILAS_IMPORTACION}.`);
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold">Importar productos desde CSV</h2>
        <p className="text-sm text-slate-500">Agrega o actualiza varios materiales o servicios en una sola operación.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-[1fr_280px]">
        <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <p className="text-sm font-semibold text-slate-700">Archivo seleccionado</p>
          <p className="break-all text-lg font-semibold">{archivo.nombre}</p>
          <p className="text-xs text-slate-500">
            {archivo.error ? "No se pudo leer" : plural(totalFilas, "fila detectada", "filas detectadas")}
            {archivo.formato && ` · ${archivo.formato}`} · {tamanoLegible(archivo.tamano)}
          </p>
          {archivo.hoja && (
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">
              Se leyó solo la primera hoja: «{archivo.hoja.nombre}».{archivo.hoja.total > 1 && ` El libro tiene ${archivo.hoja.total} hojas; las demás se ignoran.`}
            </p>
          )}
          {problemas.map((problema) => <p key={problema} className="rounded bg-red-50 p-2 text-xs text-red-700">{problema}</p>)}
          {archivo.ignoradas?.length > 0 && <p className="text-xs text-slate-500">Columnas ignoradas: {archivo.ignoradas.join(", ")}.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={onCambiar} className={BOTON_SECUNDARIO}>Cambiar archivo</button>
            <button type="button" onClick={onDescartar} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">Descartar</button>
          </div>
        </div>
        <div>
          <p className="font-semibold">Antes de importar</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-600">
            <li>Revisa la vista previa y las filas inválidas.</li>
            <li>Los códigos existentes se identifican y se actualizan.</li>
            <li>La importación se confirma por separado.</li>
          </ol>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">Columnas: código, clase, tipo, modelo, costo, existencias y estado. Opcionales: marca, capacidad_kwh, potencia_w y potencia_kw. Acepta .csv y .xlsx.</p>
        <button type="button" onClick={onRevisar} disabled={problemas.length > 0 || revisando} className={`${BOTON_PRIMARIO} shrink-0`}>
          {revisando ? "Revisando…" : `Revisar ${plural(totalFilas, "fila", "filas")}`}
        </button>
      </div>
    </section>
  );
}

function VistaPreviaImportacion({ revision, onVolver, onConfirmar }) {
  const { nuevos, actualizar, sin_cambios: sinCambios, invalidas } = revision.resumen;
  const tarjetas = [
    [nuevos, "Productos nuevos", "bg-indigo-50 text-indigo-700"],
    [actualizar, actualizar === 1 ? "Producto por actualizar" : "Productos por actualizar", "bg-green-50 text-green-700"],
    [sinCambios, "Sin cambios", "bg-slate-100 text-slate-700"],
    [invalidas, invalidas === 1 ? "Fila inválida" : "Filas inválidas", "bg-red-50 text-red-700"],
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="break-all text-lg font-semibold">Revisión de {revision.archivo}</h2>
          <p className="text-sm text-slate-500">Comprueba los cambios antes de guardarlos en el inventario.</p>
        </div>
        <button type="button" onClick={onVolver} className={`${BOTON_SECUNDARIO} shrink-0`}>Volver al catálogo</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tarjetas.map(([valor, etiqueta, color]) => (
          <div key={etiqueta} className="flex items-center gap-3 rounded-xl border bg-white p-4">
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold ${color}`}>{valor}</span>
            <span className="font-semibold text-slate-800">{etiqueta}</span>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[850px] text-sm">
          <thead className="border-b bg-slate-50">
            <tr><th className="p-3 text-left">Fila</th><th className="p-3 text-left">Código</th><th className="p-3 text-left">Tipo / Modelo</th><th className="p-3 text-left">Costo</th><th className="p-3 text-left">Existencias</th><th className="p-3 text-left">Resultado</th></tr>
          </thead>
          <tbody className="divide-y">
            {revision.filas.map((fila) => {
              const [etiqueta, color] = RESULTADOS[fila.accion];
              return (
                <tr key={fila.fila} className={`align-top ${fila.accion === "invalida" ? "bg-red-50/40" : ""}`}>
                  <td className="p-3 text-slate-500">{fila.fila}</td>
                  <td className="p-3 font-semibold text-slate-800">{fila.codigo || <span className="font-normal text-slate-400">Sin código</span>}</td>
                  <td className="p-3">
                    <span className="font-medium">{fila.tipo || "—"}</span> <span className="text-slate-400">|</span> <span className="text-slate-600">{fila.modelo || "—"}</span>
                    {fila.errores.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-red-700">{fila.errores.map((error) => <li key={error}>{error}</li>)}</ul>}
                    {fila.cambios.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {fila.cambios.map((cambio) => <li key={cambio.campo}><b>{NOMBRES_CAMPO[cambio.campo]}:</b> {valorCambio(cambio.campo, cambio.antes)} → {valorCambio(cambio.campo, cambio.despues)}</li>)}
                      </ul>
                    )}
                  </td>
                  <td className="p-3 font-medium">{typeof fila.costo_unitario === "number" ? fmt(fila.costo_unitario) : "—"}</td>
                  <td className="p-3">{fila.clasificacion === "servicio" ? <span className="text-slate-400">No aplica</span> : typeof fila.existencias === "number" ? `${fila.existencias} uds.` : (fila.existencias || "—")}</td>
                  <td className="p-3"><span className={`rounded px-2 py-1 text-xs font-bold ${color}`}>{etiqueta}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-semibold">Cambios por confirmar</p>
          <p className="mt-1 text-sm text-slate-700">
            {nuevos + actualizar === 0 ? "No hay productos por agregar ni por actualizar." : `Se ${nuevos === 1 ? "agregará" : "agregarán"} ${plural(nuevos, "producto", "productos")} y se ${actualizar === 1 ? "actualizará" : "actualizarán"} ${plural(actualizar, "producto", "productos")}.`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {sinCambios + invalidas > 0 && `Se ${sinCambios + invalidas === 1 ? "omitirá" : "omitirán"} ${[sinCambios && plural(sinCambios, "fila sin cambios", "filas sin cambios"), invalidas && plural(invalidas, "fila inválida", "filas inválidas")].filter(Boolean).join(" y ")}. `}No se reservarán ni descontarán existencias.
          </p>
        </div>
        <button type="button" onClick={onConfirmar} disabled={nuevos + actualizar === 0} className={`${BOTON_PRIMARIO} shrink-0`}>Confirmar importación</button>
      </div>
    </section>
  );
}

function ModalProducto({ producto, onCerrar, onGuardar }) {
  const editando = Boolean(producto);
  const texto = (valor) => valor === null || valor === undefined ? "" : String(valor);
  const [form, setForm] = useState(() => ({
    tipo: producto?.tipo ?? "Panel",
    modelo: producto?.modelo ?? "",
    marca: texto(producto?.marca),
    costo_unitario: texto(producto?.costo_unitario),
    existencias: texto(producto?.existencias),
    potencia_w: texto(producto?.potencia_w),
    potencia_kw: texto(producto?.potencia_kw),
    capacidad_kwh: texto(producto?.capacidad_kwh),
  }));
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const clasificacion = editando ? producto.clasificacion : form.tipo === "Mano de obra" ? "servicio" : "material";
  const esMaterial = clasificacion === "material";
  const cambiar = (campo) => (event) => setForm({ ...form, [campo]: event.target.value });

  const guardar = async () => {
    if (!editando && !form.modelo.trim()) return setError("Escribe el modelo o la descripción del producto.");
    if (form.costo_unitario.trim() === "") return setError("Escribe el costo unitario.");
    if (esMaterial && form.existencias.trim() === "") return setError("Escribe las existencias del material.");
    const datos = { costo_unitario: form.costo_unitario };
    if (!editando) Object.assign(datos, { tipo: form.tipo, modelo: form.modelo, clasificacion });
    if (esMaterial) Object.assign(datos, { existencias: form.existencias, marca: form.marca });
    if (form.tipo === "Panel") datos.potencia_w = form.potencia_w;
    if (form.tipo === "Inversor") datos.potencia_kw = form.potencia_kw;
    if (form.tipo === "Batería") datos.capacidad_kwh = form.capacidad_kwh;
    setError("");
    setOcupado(true);
    try {
      await onGuardar(datos);
    } catch (apiError) {
      setError(apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo={editando ? `Editar ${producto.codigo}` : "Nuevo producto"}
      descripcion={editando ? `${producto.tipo} | ${producto.modelo}` : "El código se genera automáticamente al guardar."}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={guardar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Guardando…" : editando ? "Guardar cambios" : "Agregar producto"}</button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!editando && <>
          <label className={ETIQUETA}>Tipo<select value={form.tipo} onChange={cambiar("tipo")} className={CAMPO}>{TIPOS.map((tipo) => <option key={tipo}>{tipo}</option>)}</select></label>
          <div className="self-end rounded-lg bg-slate-50 p-2 text-xs text-slate-600">Clase: <b>{esMaterial ? "Material físico" : "Servicio (sin existencias)"}</b></div>
          <label className={`${ETIQUETA} sm:col-span-2`}>Modelo<input value={form.modelo} onChange={cambiar("modelo")} className={CAMPO} /></label>
        </>}
        <label className={ETIQUETA}>Costo unitario (MXN)<input type="number" min="0" step="0.01" value={form.costo_unitario} onChange={cambiar("costo_unitario")} className={CAMPO} /></label>
        {esMaterial
          ? <label className={ETIQUETA}>Existencias<input type="number" min="0" step="1" value={form.existencias} onChange={cambiar("existencias")} className={CAMPO} /></label>
          : <div className="self-end rounded-lg bg-indigo-50 p-2 text-xs text-indigo-700"><b>Servicio</b>: no maneja existencias.</div>}
        {esMaterial && <label className={ETIQUETA}>Marca<input value={form.marca} onChange={cambiar("marca")} placeholder="Opcional" className={CAMPO} /></label>}
        {form.tipo === "Panel" && <label className={ETIQUETA}>Potencia (W)<input type="number" min="0.01" step="any" value={form.potencia_w} onChange={cambiar("potencia_w")} className={CAMPO} /></label>}
        {form.tipo === "Inversor" && <label className={ETIQUETA}>Potencia (kW)<input type="number" min="0.01" step="any" value={form.potencia_kw} onChange={cambiar("potencia_kw")} className={CAMPO} /></label>}
        {form.tipo === "Batería" && <label className={ETIQUETA}>Capacidad (kWh)<input type="number" min="0.01" step="any" value={form.capacidad_kwh} onChange={cambiar("capacidad_kwh")} className={CAMPO} /></label>}
      </div>
    </Modal>
  );
}

function ModalBaja({ producto, onCerrar, onConfirmar }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const confirmar = async () => {
    if (!motivo.trim()) return setError("Escribe el motivo de la baja.");
    setError("");
    setOcupado(true);
    try {
      await onConfirmar(motivo.trim());
    } catch (apiError) {
      setError(apiError.message);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo={`Dar de baja ${producto.codigo}`}
      descripcion={`${producto.tipo} | ${producto.modelo}`}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado} className={BOTON_PELIGRO}>{ocupado ? "Guardando…" : "Dar de baja"}</button>
      </>}
    >
      <p className="text-sm text-slate-600">El producto dejará de ofrecerse en nuevas cotizaciones. Su historial y las revisiones técnicas que lo usan se conservan, y puedes reactivarlo después.</p>
      <label className={ETIQUETA}>Motivo de la baja<textarea rows={3} value={motivo} onChange={(event) => setMotivo(event.target.value)} className={CAMPO} placeholder="Ej. Modelo descontinuado por el fabricante" /></label>
    </Modal>
  );
}

function ModalReactivar({ producto, onCerrar, onConfirmar }) {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

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
      titulo={`Reactivar ${producto.codigo}`}
      descripcion={`${producto.tipo} | ${producto.modelo}`}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" data-autofocus disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Guardando…" : "Reactivar"}</button>
      </>}
    >
      <p className="text-sm text-slate-600">El producto volverá a estar disponible para las cotizaciones.</p>
      {producto.motivo_baja && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><b>Motivo de la baja:</b> {producto.motivo_baja}</p>}
    </Modal>
  );
}

function ModalProveedores({ proveedores, setProveedores, solicitarApi, onCerrar }) {
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [edicion, setEdicion] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const ejecutar = async (accion, exito) => {
    setError("");
    setMensaje("");
    setOcupado(true);
    try {
      const data = await accion();
      setProveedores((actual) => actual.some((item) => item.id === data.id) ? actual.map((item) => item.id === data.id ? data : item) : [...actual, data]);
      setMensaje(exito(data));
      return true;
    } catch (apiError) {
      setError(apiError.message);
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const agregar = async (event) => {
    event.preventDefault();
    if (!nuevoNombre.trim()) return setError("Escribe el nombre del proveedor.");
    const listo = await ejecutar(() => solicitarApi("/api/proveedores", { method: "POST", body: JSON.stringify({ nombre: nuevoNombre.trim() }) }), (data) => `Proveedor «${data.nombre}» registrado.`);
    if (listo) setNuevoNombre("");
  };

  const renombrar = async (event) => {
    event.preventDefault();
    if (!edicion.nombre.trim()) return setError("El nombre del proveedor no puede quedar vacío.");
    const listo = await ejecutar(() => solicitarApi(`/api/proveedores/${edicion.id}`, { method: "PATCH", body: JSON.stringify({ nombre: edicion.nombre.trim() }) }), (data) => `Proveedor renombrado a «${data.nombre}».`);
    if (listo) setEdicion(null);
  };

  const cambiarActivo = (proveedor) => ejecutar(
    () => solicitarApi(`/api/proveedores/${proveedor.id}/activo`, { method: "PATCH", body: JSON.stringify({ activo: !proveedor.activo }) }),
    (data) => data.activo ? `Proveedor «${data.nombre}» reactivado.` : `Proveedor «${data.nombre}» dado de baja.`,
  );

  return (
    <Modal titulo="Proveedores" descripcion="Directorio de proveedores del catálogo." error={error} onCerrar={onCerrar} ancho="max-w-2xl"
      acciones={<button type="button" onClick={onCerrar} className={BOTON_SECUNDARIO}>Cerrar</button>}>
      {mensaje && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}
      <form onSubmit={agregar} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className={`${ETIQUETA} flex-1`}>Nuevo proveedor<input value={nuevoNombre} onChange={(event) => setNuevoNombre(event.target.value)} placeholder="Nombre comercial" className={CAMPO} /></label>
        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>Agregar</button>
      </form>
      <ul className="divide-y rounded-xl border">
        {proveedores.map((proveedor) => (
          <li key={proveedor.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            {edicion?.id === proveedor.id ? (
              <form onSubmit={renombrar} className="flex flex-1 flex-col gap-2 sm:flex-row">
                <input autoFocus value={edicion.nombre} onChange={(event) => setEdicion({ ...edicion, nombre: event.target.value })} aria-label="Nuevo nombre del proveedor" className="flex-1 rounded-lg border px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>Guardar</button>
                  <button type="button" onClick={() => setEdicion(null)} className={BOTON_SECUNDARIO}>Cancelar</button>
                </div>
              </form>
            ) : (
              <>
                <div>
                  <p className={`font-medium ${proveedor.activo ? "text-slate-800" : "text-slate-400"}`}>{proveedor.nombre}</p>
                  <p className={`text-xs font-semibold ${proveedor.activo ? "text-green-700" : "text-slate-500"}`}>{proveedor.activo ? "Activo" : "Inactivo"}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={ocupado} onClick={() => { setError(""); setMensaje(""); setEdicion({ id: proveedor.id, nombre: proveedor.nombre }); }} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">Renombrar</button>
                  <button type="button" disabled={ocupado} onClick={() => cambiarActivo(proveedor)} className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${proveedor.activo ? "bg-red-50 text-red-600 hover:bg-red-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>{proveedor.activo ? "Dar de baja" : "Reactivar"}</button>
                </div>
              </>
            )}
          </li>
        ))}
        {proveedores.length === 0 && <li className="p-4 text-center text-sm text-slate-500">No hay proveedores registrados.</li>}
      </ul>
    </Modal>
  );
}

function ModalConfirmarImportacion({ revision, onCerrar, onConfirmar }) {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { nuevos, actualizar, sin_cambios: sinCambios, invalidas } = revision.resumen;

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
      titulo="Confirmar importación"
      descripcion={revision.archivo}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" data-autofocus disabled={ocupado || nuevos + actualizar === 0} className={BOTON_PRIMARIO}>{ocupado ? "Importando…" : "Confirmar importación"}</button>
      </>}
    >
      <ul className="space-y-1 text-sm text-slate-700">
        <li><b>{plural(nuevos, "producto nuevo", "productos nuevos")}</b> se agregarán al catálogo.</li>
        <li><b>{plural(actualizar, "producto existente", "productos existentes")}</b> se actualizarán.</li>
        <li>{plural(sinCambios + invalidas, "fila se omitirá", "filas se omitirán")} ({sinCambios} sin cambios, {plural(invalidas, "inválida", "inválidas")}).</li>
      </ul>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Todo el lote se guarda en una sola operación: si algo falla, no se aplica ningún cambio. Importar no reserva ni descuenta existencias.</p>
    </Modal>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import Aviso from "./Aviso.jsx";
import Modal from "./Modal.jsx";
import {
  generarCsvInventario,
  generarExcelInventario,
  guardarArchivo,
  leerArchivoInventario,
  LIMITE_FILAS_IMPORTACION,
} from "./inventarioArchivos.js";
import { BOTON_PELIGRO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO, ETIQUETA, fmt, plural } from "./ui.js";
import useAviso from "./useAviso.js";

const TIPOS = ["Panel", "Inversor", "Estructura", "Cableado", "Mano de obra", "Batería", "Extra"];
const RESULTADOS = {
  nuevo: ["Nuevo", "bg-indigo-50 text-indigo-700"],
  actualizar: ["Actualizar", "bg-green-50 text-green-700"],
  sin_cambios: ["Sin cambios", "bg-slate-100 text-slate-600"],
  invalida: ["Inválida", "bg-red-50 text-red-700"],
};
const NOMBRES_CAMPO = {
  tipo: "Tipo", modelo: "Modelo", clasificacion: "Clase", costo_unitario: "Costo", existencias: "Existencias",
  marca: "Marca", capacidad_kwh: "Capacidad (kWh)", potencia_w: "Potencia (W)", potencia_kw: "Potencia (kW)", activo: "Estatus",
};

const tamanoLegible = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fechaArchivo = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
};
const claveBusqueda = (valor) => String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
// SQLite guarda CURRENT_TIMESTAMP en UTC con el formato "AAAA-MM-DD HH:MM:SS".
const fechaAlta = (valor) => valor ? new Date(`${valor.replace(" ", "T")}Z`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const COLUMNAS_FILA = [
  ["codigo", "Código"], ["clase", "Clase"], ["tipo", "Tipo"], ["modelo", "Modelo"], ["costo", "Costo"], ["existencias", "Existencias"],
  ["estado", "Estatus"], ["marca", "Marca"], ["capacidad_kwh", "Capacidad (kWh)"], ["potencia_w", "Potencia (W)"], ["potencia_kw", "Potencia (kW)"],
];

function leerPreferencia(clave, porDefecto) {
  try { return window.localStorage.getItem(clave) ?? porDefecto; } catch { return porDefecto; }
}
function guardarPreferencia(clave, valor) {
  try { window.localStorage.setItem(clave, valor); } catch { /* El navegador puede bloquear el almacenamiento local. */ }
}

function valorCambio(campo, valor) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (campo === "costo_unitario") return fmt(valor);
  if (campo === "activo") return valor ? "Activo" : "Inactivo";
  if (campo === "clasificacion") return valor === "servicio" ? "Servicio" : "Material físico";
  return String(valor);
}

function detalleTecnico(producto, nombreProveedor) {
  return [
    producto.marca,
    nombreProveedor ? `Proveedor: ${nombreProveedor}` : null,
    producto.potencia_w ? `${producto.potencia_w} W` : null,
    producto.potencia_kw ? `${producto.potencia_kw} kW` : null,
    producto.capacidad_kwh ? `${producto.capacidad_kwh} kWh` : null,
  ].filter(Boolean).join(" · ");
}

export default function InventarioFisico({ inventario, setInventario, usuario }) {
  const isAdmin = usuario.rol === "Administrador";
  const [proveedores, setProveedores] = useState([]);
  const [aviso, avisar, cerrarAviso] = useAviso();
  const [modal, setModal] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const [leyendoArchivo, setLeyendoArchivo] = useState(false);
  const [revision, setRevision] = useState(null);
  const [revisando, setRevisando] = useState(false);
  // Correcciones y exclusiones de la vista previa: solo viven en memoria, el archivo original no cambia.
  const [correcciones, setCorrecciones] = useState({});
  const [excluidas, setExcluidas] = useState([]);
  const selectorArchivo = useRef(null);
  const inicio = useRef(null);

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

  const pedirProveedores = useCallback(async (signal) => {
    const response = await fetch("/api/proveedores", { signal, headers: { Authorization: `Bearer ${usuario.token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }, [usuario.token]);

  const avisarErrorProveedores = useCallback((fetchError) => {
    if (fetchError.name !== "AbortError") avisar("error", fetchError.message || "No se pudieron cargar los proveedores.");
  }, [avisar]);

  useEffect(() => {
    const controller = new AbortController();
    pedirProveedores(controller.signal).then(setProveedores).catch(avisarErrorProveedores);
    return () => controller.abort();
  }, [pedirProveedores, avisarErrorProveedores]);

  // Vuelve a pedir los proveedores para actualizar el conteo de productos ligados.
  const cargarProveedores = () => pedirProveedores().then(setProveedores).catch(avisarErrorProveedores);

  const reemplazarProducto = (data) => setInventario((actual) => actual.map((producto) => producto.id === data.id ? data : producto));

  const recargar = async () => {
    setRecargando(true);
    try {
      const productos = await solicitarApi("/api/productos");
      setInventario(productos);
      await cargarProveedores();
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
    if (data.proveedor_id) cargarProveedores();
  };

  const editarProducto = async (producto, datos) => {
    const data = await solicitarApi(`/api/productos/${producto.id}`, { method: "PATCH", body: JSON.stringify(datos) });
    reemplazarProducto(data);
    setModal(null);
    avisar("exito", `Producto ${data.codigo} actualizado.`);
    if (data.proveedor_id !== producto.proveedor_id) cargarProveedores();
  };

  const cambiarActivo = async (producto, activo, motivo = null) => {
    const data = await solicitarApi(`/api/productos/${producto.id}/activo`, { method: "PATCH", body: JSON.stringify({ activo, motivo }) });
    reemplazarProducto(data);
    setModal(null);
    avisar("exito", activo ? `Producto ${data.codigo} reactivado.` : `Producto ${data.codigo} dado de baja sin eliminar su historial.`);
  };

  const exportar = async (formato) => {
    const esExcel = formato === "xlsx";
    const guardado = await guardarArchivo({
      nombre: `inventario-${fechaArchivo()}.${formato}`,
      descripcion: esExcel ? "Libro de Excel" : "Archivo CSV",
      mime: esExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
      construir: () => esExcel ? generarExcelInventario(inventario) : generarCsvInventario(inventario),
    });
    if (!guardado) return false;
    setModal(null);
    avisar("exito", `Inventario exportado a ${esExcel ? "Excel" : "CSV"} (${plural(inventario.length, "producto", "productos")}).`);
    return true;
  };

  const proveedorEliminado = (resultado) => {
    setProveedores((actual) => actual.filter((proveedor) => proveedor.id !== resultado.id));
    setInventario((actual) => actual.map((producto) => producto.proveedor_id === resultado.id ? { ...producto, proveedor_id: null } : producto));
  };

  const seleccionarArchivo = async (event) => {
    const elegido = event.target.files?.[0];
    event.target.value = "";
    if (!elegido) return;
    setLeyendoArchivo(true);
    setRevision(null);
    setCorrecciones({});
    setExcluidas([]);
    try {
      const datos = await leerArchivoInventario(elegido);
      setArchivo({ nombre: elegido.name, tamano: elegido.size, ...datos });
    } catch (lecturaError) {
      setArchivo({ nombre: elegido.name, tamano: elegido.size, error: lecturaError.message });
    } finally {
      setLeyendoArchivo(false);
    }
  };

  const filasDeTrabajo = (corr, excl) => archivo.filas.filter((fila) => !excl.includes(fila.fila)).map((fila) => corr[fila.fila] ?? fila);

  // Revisa el lote completo para recalcular códigos repetidos y la firma que valida la confirmación.
  const pedirRevision = async (corr, excl) => {
    const filas = filasDeTrabajo(corr, excl);
    if (!filas.length) return { archivo: archivo.nombre, filas: [], resumen: { nuevos: 0, actualizar: 0, sin_cambios: 0, invalidas: 0 }, firma: null };
    return solicitarApi("/api/productos/importacion/previsualizar", {
      method: "POST",
      body: JSON.stringify({ archivo: archivo.nombre, columnas: archivo.columnas, filas }),
    });
  };

  const revisarArchivo = async () => {
    setRevisando(true);
    try {
      setRevision(await pedirRevision(correcciones, excluidas));
      inicio.current?.scrollIntoView({ block: "start" });
    } catch (apiError) {
      avisar("error", apiError.message);
    } finally {
      setRevisando(false);
    }
  };

  const guardarCorreccion = async (numeroFila, valores) => {
    const original = archivo.filas.find((fila) => fila.fila === numeroFila);
    const igualAlArchivo = COLUMNAS_FILA.every(([campo]) => (original[campo] ?? null) === (valores[campo] ?? null));
    const nuevas = { ...correcciones };
    if (igualAlArchivo) delete nuevas[numeroFila];
    else nuevas[numeroFila] = { ...valores, fila: numeroFila };
    const data = await pedirRevision(nuevas, excluidas);
    setCorrecciones(nuevas);
    setRevision(data);
    setModal(null);
    const resultado = data.filas.find((fila) => fila.fila === numeroFila);
    avisar(resultado?.accion === "invalida" ? "error" : "exito", `Fila ${numeroFila} revisada: ${RESULTADOS[resultado?.accion]?.[0] ?? "sin resultado"}.`);
  };

  const alternarExclusion = async (numeroFila) => {
    const nuevas = excluidas.includes(numeroFila) ? excluidas.filter((fila) => fila !== numeroFila) : [...excluidas, numeroFila];
    setRevisando(true);
    try {
      setRevision(await pedirRevision(correcciones, nuevas));
      setExcluidas(nuevas);
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
        body: JSON.stringify({ archivo: archivo.nombre, columnas: archivo.columnas, filas: filasDeTrabajo(correcciones, excluidas), firma: revision.firma }),
      });
      setInventario(data.productos);
      setRevision(null);
      setArchivo(null);
      setCorrecciones({});
      setExcluidas([]);
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

  const descartarArchivo = () => { setArchivo(null); setRevision(null); setCorrecciones({}); setExcluidas([]); };
  const etapa = revision ? "Vista previa" : archivo ? (archivo.error ? "Archivo con errores" : "Archivo listo") : "Catálogo";
  const filaEnEdicion = modal?.tipo === "editar_fila" ? archivo.filas.find((fila) => fila.fila === modal.fila) : null;

  return (
    <div ref={inicio} className="mx-auto max-w-6xl scroll-mt-4 space-y-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inventario físico</h1>
          <p className="mt-1 text-sm text-slate-500">Materiales y servicios disponibles para las cotizaciones de ATLAS.</p>
        </div>
        <span className="shrink-0 rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">{etapa}</span>
      </div>

      <Aviso aviso={aviso} onCerrar={cerrarAviso} />

      <input ref={selectorArchivo} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={seleccionarArchivo} />

      {revision ? (
        <VistaPreviaImportacion
          revision={revision}
          archivo={archivo}
          correcciones={correcciones}
          excluidas={excluidas}
          revisando={revisando}
          onEditar={(numeroFila) => setModal({ tipo: "editar_fila", fila: numeroFila })}
          onAlternarExclusion={alternarExclusion}
          onVolver={() => setRevision(null)}
          onConfirmar={() => setModal({ tipo: "confirmar_importacion" })}
        />
      ) : (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={recargar} disabled={recargando} className={BOTON_SECUNDARIO}>{recargando ? "Recargando…" : "Recargar"}</button>
            {isAdmin && <>
              <button type="button" onClick={() => { cargarProveedores(); setModal({ tipo: "proveedores" }); }} className={BOTON_SECUNDARIO}>Proveedores</button>
              <button type="button" onClick={() => setModal({ tipo: "nuevo" })} className={BOTON_SECUNDARIO}>Nuevo producto</button>
              <button type="button" onClick={() => setModal({ tipo: "exportar" })} className={BOTON_SECUNDARIO}>Exportar</button>
              <button type="button" onClick={() => selectorArchivo.current?.click()} disabled={leyendoArchivo} className={BOTON_PRIMARIO}>{leyendoArchivo ? "Leyendo archivo…" : "Importar"}</button>
            </>}
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Catálogo actual</h2>
              <p className="text-sm text-slate-500">Consultar productos no reserva ni descuenta existencias.</p>
            </div>
            <TablaCatalogo
              inventario={inventario}
              proveedores={proveedores}
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

      {modal?.tipo === "nuevo" && <ModalProducto proveedores={proveedores} onCerrar={() => setModal(null)} onGuardar={crearProducto} />}
      {modal?.tipo === "editar" && <ModalProducto producto={modal.producto} proveedores={proveedores} onCerrar={() => setModal(null)} onGuardar={(datos) => editarProducto(modal.producto, datos)} />}
      {modal?.tipo === "baja" && <ModalBaja producto={modal.producto} onCerrar={() => setModal(null)} onConfirmar={(motivo) => cambiarActivo(modal.producto, false, motivo)} />}
      {modal?.tipo === "reactivar" && <ModalReactivar producto={modal.producto} onCerrar={() => setModal(null)} onConfirmar={() => cambiarActivo(modal.producto, true)} />}
      {modal?.tipo === "exportar" && <ModalExportar total={inventario.length} onCerrar={() => setModal(null)} onExportar={exportar} />}
      {modal?.tipo === "proveedores" && <ModalProveedores proveedores={proveedores} setProveedores={setProveedores} solicitarApi={solicitarApi} onEliminado={proveedorEliminado} onCerrar={() => setModal(null)} />}
      {filaEnEdicion && (
        <ModalFilaImportacion
          original={filaEnEdicion}
          actual={correcciones[filaEnEdicion.fila] ?? filaEnEdicion}
          revisionFila={revision?.filas.find((fila) => fila.fila === filaEnEdicion.fila)}
          onCerrar={() => setModal(null)}
          onGuardar={(valores) => guardarCorreccion(filaEnEdicion.fila, valores)}
        />
      )}
      {modal?.tipo === "confirmar_importacion" && revision && <ModalConfirmarImportacion revision={revision} excluidas={excluidas.length} onCerrar={() => setModal(null)} onConfirmar={confirmarImportacion} />}
    </div>
  );
}

function TablaCatalogo({ inventario, proveedores, isAdmin, onEditar, onBaja, onReactivar }) {
  const nombresProveedor = new Map(proveedores.map((proveedor) => [proveedor.id, proveedor.nombre]));
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[850px] text-sm">
        <thead className="border-b bg-slate-50">
          <tr>
            <th className="p-3 text-left">Código</th><th className="p-3 text-left">Clase</th><th className="p-3 text-left">Tipo / Modelo</th>
            <th className="p-3 text-left">Costo base</th><th className="p-3 text-left">Existencias</th><th className="p-3 text-left">Estatus</th>
            {isAdmin && <th className="p-3 text-left">Acciones</th>}
          </tr>
        </thead>
        <tbody className="divide-y">
          {inventario.map((item) => {
            const detalle = detalleTecnico(item, nombresProveedor.get(item.proveedor_id));
            return (
              <tr key={item.id} className={`hover:bg-slate-50 ${item.activo ? "" : "opacity-60"}`}>
                <td className="p-3 font-semibold text-slate-800">{item.codigo}</td>
                <td className="p-3"><span className={`rounded px-2 py-1 text-xs font-bold ${item.clasificacion === "servicio" ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"}`}>{item.clasificacion === "servicio" ? "Servicio" : "Material físico"}</span></td>
                <td className="p-3">
                  <span className="font-medium">{item.tipo}</span> <span className="text-slate-400">|</span> <span className="text-slate-600">{item.modelo}</span>
                  {detalle && <span className="block text-xs text-slate-500">{detalle}</span>}
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
            );
          })}
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
        <p className="text-xs text-slate-500">Columnas: código, clase, tipo, modelo, costo, existencias y estado (el estatus: Activo o Inactivo; también se acepta «estatus»). Opcionales: marca, capacidad_kwh, potencia_w y potencia_kw. Acepta .csv y .xlsx.</p>
        <button type="button" onClick={onRevisar} disabled={problemas.length > 0 || revisando} className={`${BOTON_PRIMARIO} shrink-0`}>
          {revisando ? "Revisando…" : `Revisar ${plural(totalFilas, "fila", "filas")}`}
        </button>
      </div>
    </section>
  );
}

function VistaPreviaImportacion({ revision, archivo, correcciones, excluidas, revisando, onEditar, onAlternarExclusion, onVolver, onConfirmar }) {
  const { nuevos, actualizar, sin_cambios: sinCambios, invalidas } = revision.resumen;
  const resultadosPorFila = new Map(revision.filas.map((fila) => [fila.fila, fila]));
  const tarjetas = [
    [nuevos, "Productos nuevos", "bg-indigo-50 text-indigo-700"],
    [actualizar, actualizar === 1 ? "Producto por actualizar" : "Productos por actualizar", "bg-green-50 text-green-700"],
    [sinCambios, "Sin cambios", "bg-slate-100 text-slate-700"],
    [invalidas, invalidas === 1 ? "Fila inválida" : "Filas inválidas", "bg-red-50 text-red-700"],
  ];
  const omitidas = sinCambios + invalidas + excluidas.length;
  const partesOmitidas = [
    sinCambios && plural(sinCambios, "fila sin cambios", "filas sin cambios"),
    invalidas && plural(invalidas, "fila inválida", "filas inválidas"),
    excluidas.length && plural(excluidas.length, "fila excluida", "filas excluidas"),
  ].filter(Boolean);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="break-all text-lg font-semibold">Revisión de {revision.archivo}</h2>
          <p className="text-sm text-slate-500">Comprueba los cambios antes de guardarlos en el inventario. Puedes corregir o excluir filas; el archivo original no se modifica.</p>
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
        <table className="w-full min-w-[950px] text-sm">
          <thead className="border-b bg-slate-50">
            <tr><th className="p-3 text-left">Fila</th><th className="p-3 text-left">Código</th><th className="p-3 text-left">Tipo / Modelo</th><th className="p-3 text-left">Costo</th><th className="p-3 text-left">Existencias</th><th className="p-3 text-left">Resultado</th><th className="p-3 text-left">Acciones</th></tr>
          </thead>
          <tbody className="divide-y">
            {archivo.filas.map((original) => {
              const excluida = excluidas.includes(original.fila);
              const corregida = Boolean(correcciones[original.fila]);
              const datos = correcciones[original.fila] ?? original;
              const fila = excluida ? null : resultadosPorFila.get(original.fila);
              const [etiqueta, color] = excluida ? ["Excluida", "bg-slate-100 text-slate-500"] : RESULTADOS[fila?.accion] ?? ["—", ""];
              return (
                <tr key={original.fila} className={`align-top ${excluida ? "bg-slate-50 text-slate-400" : fila?.accion === "invalida" ? "bg-red-50/40" : ""}`}>
                  <td className="p-3 text-slate-500">{original.fila}</td>
                  <td className="p-3 font-semibold text-slate-800">
                    {(fila?.codigo ?? datos.codigo) || <span className="font-normal text-slate-400">Sin código</span>}
                    {corregida && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">Corregida</span>}
                  </td>
                  <td className={`p-3 ${excluida ? "line-through" : ""}`}>
                    <span className="font-medium">{(fila?.tipo ?? datos.tipo) || "—"}</span> <span className="text-slate-400">|</span> <span className="text-slate-600">{(fila?.modelo ?? datos.modelo) || "—"}</span>
                    {fila?.errores.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-red-700">{fila.errores.map((error) => <li key={error}>{error}</li>)}</ul>}
                    {fila?.cambios.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {fila.cambios.map((cambio) => <li key={cambio.campo}><b>{NOMBRES_CAMPO[cambio.campo]}:</b> {valorCambio(cambio.campo, cambio.antes)} → {valorCambio(cambio.campo, cambio.despues)}</li>)}
                      </ul>
                    )}
                  </td>
                  <td className="p-3 font-medium">{typeof fila?.costo_unitario === "number" ? fmt(fila.costo_unitario) : (datos.costo || "—")}</td>
                  <td className="p-3">{(fila?.clasificacion ?? datos.clase) === "servicio" ? <span className="text-slate-400">No aplica</span> : typeof fila?.existencias === "number" ? `${fila.existencias} uds.` : (datos.existencias || "—")}</td>
                  <td className="p-3"><span className={`rounded px-2 py-1 text-xs font-bold ${color}`}>{etiqueta}</span></td>
                  <td className="whitespace-nowrap p-3">
                    <div className="flex gap-2">
                      <button type="button" disabled={excluida || revisando} onClick={() => onEditar(original.fila)} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-40">Editar</button>
                      <button type="button" disabled={revisando} onClick={() => onAlternarExclusion(original.fila)} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200 disabled:opacity-40">{excluida ? "Incluir" : "Excluir"}</button>
                    </div>
                  </td>
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
            {omitidas > 0 && `Se ${omitidas === 1 ? "omitirá" : "omitirán"} ${partesOmitidas.join(", ").replace(/, ([^,]*)$/, " y $1")}. `}No se reservarán ni descontarán existencias.
          </p>
        </div>
        <button type="button" onClick={onConfirmar} disabled={nuevos + actualizar === 0 || revisando} className={`${BOTON_PRIMARIO} shrink-0`}>Confirmar importación</button>
      </div>
    </section>
  );
}

function SelectorProveedor({ proveedores, valor, onCambiar }) {
  // Muestra los proveedores activos y, si el producto ya tiene uno inactivo, también ese.
  const opciones = proveedores.filter((proveedor) => proveedor.activo || String(proveedor.id) === valor);
  return (
    <label className={ETIQUETA}>Proveedor
      <select value={valor} onChange={(event) => onCambiar(event.target.value)} className={CAMPO}>
        <option value="">Sin proveedor</option>
        {opciones.map((proveedor) => <option key={proveedor.id} value={String(proveedor.id)}>{proveedor.nombre}{proveedor.activo ? "" : " (inactivo)"}</option>)}
      </select>
    </label>
  );
}

function ModalProducto({ producto, proveedores, onCerrar, onGuardar }) {
  const editando = Boolean(producto);
  const texto = (valor) => valor === null || valor === undefined ? "" : String(valor);
  const [form, setForm] = useState(() => ({
    tipo: producto?.tipo ?? "Panel",
    modelo: producto?.modelo ?? "",
    marca: texto(producto?.marca),
    proveedor_id: texto(producto?.proveedor_id),
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
    const datos = { costo_unitario: form.costo_unitario, proveedor_id: form.proveedor_id };
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
      {editando && !producto.activo && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <p className="text-xs font-semibold uppercase text-slate-500">Producto inactivo · Motivo de baja</p>
          <p className="mt-1">{producto.motivo_baja || "Sin motivo registrado."}</p>
        </div>
      )}
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
        <SelectorProveedor proveedores={proveedores} valor={form.proveedor_id} onCambiar={(valor) => setForm({ ...form, proveedor_id: valor })} />
        {form.tipo === "Panel" && <label className={ETIQUETA}>Potencia (W)<input type="number" min="0.01" step="any" value={form.potencia_w} onChange={cambiar("potencia_w")} className={CAMPO} /></label>}
        {form.tipo === "Inversor" && <label className={ETIQUETA}>Potencia (kW)<input type="number" min="0.01" step="any" value={form.potencia_kw} onChange={cambiar("potencia_kw")} className={CAMPO} /></label>}
        {form.tipo === "Batería" && <label className={ETIQUETA}>Capacidad (kWh)<input type="number" min="0.01" step="any" value={form.capacidad_kwh} onChange={cambiar("capacidad_kwh")} className={CAMPO} /></label>}
      </div>
    </Modal>
  );
}

function ModalFilaImportacion({ original, actual, revisionFila, onCerrar, onGuardar }) {
  const aTexto = (fila) => Object.fromEntries(COLUMNAS_FILA.map(([campo]) => [campo, fila[campo] ?? ""]));
  const [form, setForm] = useState(() => aTexto(actual));
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const cambiar = (campo) => (event) => setForm({ ...form, [campo]: event.target.value });
  // Si el archivo trae un valor no reconocido, se muestra como opción para que se vea qué venía.
  const opciones = (campo, validas) => {
    const valor = form[campo];
    const reconocido = validas.some(([clave]) => claveBusqueda(clave) === claveBusqueda(valor));
    return [
      ...(valor && !reconocido ? [[valor, `${valor} (valor del archivo, no válido)`]] : []),
      ...validas,
    ];
  };
  const selector = (campo, etiqueta, validas) => (
    <label className={ETIQUETA}>{etiqueta}
      <select value={opciones(campo, validas).find(([clave]) => claveBusqueda(clave) === claveBusqueda(form[campo]))?.[0] ?? ""} onChange={cambiar(campo)} className={CAMPO}>
        <option value="">Selecciona…</option>
        {opciones(campo, validas).map(([clave, texto]) => <option key={clave} value={clave}>{texto}</option>)}
      </select>
    </label>
  );

  const guardar = async () => {
    const valores = Object.fromEntries(COLUMNAS_FILA.map(([campo]) => [campo, form[campo].trim() || null]));
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
      titulo={`Editar fila ${original.fila}`}
      descripcion="La corrección solo se guarda en esta revisión; el archivo original no cambia. Al guardar, el servidor vuelve a validar la fila."
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={guardar}
      ancho="max-w-2xl"
      acciones={<>
        <button type="button" onClick={() => setForm(aTexto(original))} disabled={ocupado} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 sm:mr-auto">Restaurar valores del archivo</button>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Revisando…" : "Guardar y revisar"}</button>
      </>}
    >
      {revisionFila?.errores.length > 0 && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">Errores actuales de la fila</p>
          <ul className="mt-1 list-disc pl-5">{revisionFila.errores.map((mensaje) => <li key={mensaje}>{mensaje}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={ETIQUETA}>Código<input value={form.codigo} onChange={cambiar("codigo")} className={CAMPO} /></label>
        {selector("clase", "Clase", [["material", "Material físico"], ["servicio", "Servicio"]])}
        {selector("tipo", "Tipo", TIPOS.map((tipo) => [tipo, tipo]))}
        <label className={ETIQUETA}>Modelo<input value={form.modelo} onChange={cambiar("modelo")} className={CAMPO} /></label>
        <label className={ETIQUETA}>Costo (MXN)<input value={form.costo} onChange={cambiar("costo")} inputMode="decimal" className={CAMPO} /></label>
        <label className={ETIQUETA}>Existencias<input value={form.existencias} onChange={cambiar("existencias")} placeholder="Servicios: vacío o No aplica" className={CAMPO} /></label>
        {selector("estado", "Estatus", [["Activo", "Activo"], ["Inactivo", "Inactivo"]])}
        <label className={ETIQUETA}>Marca<input value={form.marca} onChange={cambiar("marca")} placeholder="Vacío conserva la actual" className={CAMPO} /></label>
        <label className={ETIQUETA}>Capacidad (kWh)<input value={form.capacidad_kwh} onChange={cambiar("capacidad_kwh")} inputMode="decimal" placeholder="Baterías" className={CAMPO} /></label>
        <label className={ETIQUETA}>Potencia (W)<input value={form.potencia_w} onChange={cambiar("potencia_w")} inputMode="decimal" placeholder="Paneles" className={CAMPO} /></label>
        <label className={ETIQUETA}>Potencia (kW)<input value={form.potencia_kw} onChange={cambiar("potencia_kw")} inputMode="decimal" placeholder="Inversores" className={CAMPO} /></label>
      </div>
    </Modal>
  );
}

function ModalExportar({ total, onCerrar, onExportar }) {
  const [formato, setFormato] = useState("csv");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const opciones = [
    ["csv", "CSV", "Texto separado por comas (UTF-8). Se abre en Excel, Hojas de cálculo de Google o cualquier editor."],
    ["xlsx", "Excel (.xlsx)", "Libro de Excel con una hoja «Inventario»; el código se guarda como texto para conservar los ceros."],
  ];

  const exportar = async () => {
    setError("");
    setOcupado(true);
    try {
      if (!(await onExportar(formato))) setOcupado(false);
    } catch (exportError) {
      setError(`No se pudo exportar el inventario: ${exportError.message}`);
      setOcupado(false);
    }
  };

  return (
    <Modal
      titulo="Exportar inventario"
      descripcion={`${plural(total, "producto", "productos")} · archivo inventario-${fechaArchivo()}.${formato}`}
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={exportar}
      acciones={<>
        <button type="button" onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" data-autofocus disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Exportando…" : "Exportar"}</button>
      </>}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Formato</legend>
        {opciones.map(([valor, etiqueta, descripcion]) => (
          <label key={valor} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${formato === valor ? "border-indigo-400 bg-indigo-50" : "hover:bg-slate-50"}`}>
            <input type="radio" name="formato" value={valor} checked={formato === valor} onChange={() => setFormato(valor)} className="mt-1" />
            <span><span className="block text-sm font-semibold">{etiqueta}</span><span className="block text-xs text-slate-500">{descripcion}</span></span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-slate-500">Incluye las mismas 11 columnas que acepta la importación: código, clase, tipo, modelo, costo, existencias, estado (estatus Activo o Inactivo), marca, capacidad_kwh, potencia_w y potencia_kw.</p>
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

function ModalProveedores({ proveedores, setProveedores, solicitarApi, onEliminado, onCerrar }) {
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [edicion, setEdicion] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState(() => leerPreferencia("atlas.proveedores.orden", "nombre"));
  const [porEliminar, setPorEliminar] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cambiarOrden = (valor) => {
    setOrden(valor);
    guardarPreferencia("atlas.proveedores.orden", valor);
  };

  const visibles = proveedores
    .filter((proveedor) => claveBusqueda(proveedor.nombre).includes(claveBusqueda(busqueda)))
    .sort((a, b) => orden === "fecha"
      ? (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id - a.id
      : a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));

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

  const eliminar = async () => {
    const resultado = await solicitarApi(`/api/proveedores/${porEliminar.id}`, { method: "DELETE" });
    onEliminado(resultado);
    setPorEliminar(null);
    setError("");
    setMensaje(`Proveedor «${resultado.nombre}» eliminado. ${resultado.productos_sin_proveedor === 0 ? "Ningún producto estaba ligado a él." : `${plural(resultado.productos_sin_proveedor, "producto quedó", "productos quedaron")} sin proveedor.`}`);
  };

  return (
    <Modal titulo="Proveedores" descripcion="Directorio de proveedores del catálogo." error={error} onCerrar={onCerrar} ancho="max-w-2xl"
      acciones={<button type="button" onClick={onCerrar} className={BOTON_SECUNDARIO}>Cerrar</button>}>
      {mensaje && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{mensaje}</p>}
      <form onSubmit={agregar} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className={`${ETIQUETA} flex-1`}>Nuevo proveedor<input value={nuevoNombre} onChange={(event) => setNuevoNombre(event.target.value)} placeholder="Nombre comercial" className={CAMPO} /></label>
        <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>Agregar</button>
      </form>
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_180px]">
        <label className={ETIQUETA}>Buscar<input type="search" value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Nombre del proveedor" className={CAMPO} /></label>
        <label className={ETIQUETA}>Ordenar por
          <select value={orden} onChange={(event) => cambiarOrden(event.target.value)} className={CAMPO}>
            <option value="nombre">A-Z</option>
            <option value="fecha">Fecha de alta</option>
          </select>
        </label>
      </div>
      <ul className="divide-y rounded-xl border">
        {visibles.map((proveedor) => (
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
                  <p className="text-xs text-slate-500">
                    <span className={`font-semibold ${proveedor.activo ? "text-green-700" : "text-slate-500"}`}>{proveedor.activo ? "Activo" : "Inactivo"}</span>
                    {` · Alta: ${fechaAlta(proveedor.created_at)} · ${plural(proveedor.productos_ligados ?? 0, "producto ligado", "productos ligados")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={ocupado} onClick={() => { setError(""); setMensaje(""); setEdicion({ id: proveedor.id, nombre: proveedor.nombre }); }} className="rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">Renombrar</button>
                  <button type="button" disabled={ocupado} onClick={() => cambiarActivo(proveedor)} className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${proveedor.activo ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : "bg-green-50 text-green-700 hover:bg-green-100"}`}>{proveedor.activo ? "Dar de baja" : "Reactivar"}</button>
                  <button type="button" disabled={ocupado} onClick={() => { setError(""); setMensaje(""); setPorEliminar(proveedor); }} aria-label={`Eliminar ${proveedor.nombre}`} title="Eliminar permanentemente" className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50">
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg>
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
        {visibles.length === 0 && <li className="p-4 text-center text-sm text-slate-500">{proveedores.length ? "Ningún proveedor coincide con la búsqueda." : "No hay proveedores registrados."}</li>}
      </ul>
      {porEliminar && <ModalEliminarProveedor proveedor={porEliminar} onCerrar={() => setPorEliminar(null)} onConfirmar={eliminar} />}
    </Modal>
  );
}

function ModalEliminarProveedor({ proveedor, onCerrar, onConfirmar }) {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const ligados = proveedor.productos_ligados ?? 0;

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
      titulo={`Eliminar ${proveedor.nombre}`}
      descripcion="Esta acción es permanente y no se puede deshacer."
      error={error}
      ocupado={ocupado}
      onCerrar={onCerrar}
      onEnviar={confirmar}
      acciones={<>
        <button type="button" data-autofocus onClick={onCerrar} disabled={ocupado} className={BOTON_SECUNDARIO}>Cancelar</button>
        <button type="submit" disabled={ocupado} className={BOTON_PELIGRO}>{ocupado ? "Eliminando…" : "Eliminar permanentemente"}</button>
      </>}
    >
      <p className="text-sm text-slate-600">A diferencia de dar de baja, el proveedor se borra del directorio. Si solo quieres dejar de usarlo, usa «Dar de baja».</p>
      <p className={`rounded-lg p-3 text-sm ${ligados ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
        {ligados
          ? <><b>{plural(ligados, "producto quedará", "productos quedarán")} sin proveedor asignado.</b> Los productos se conservan con todos sus datos.</>
          : "Ningún producto está ligado a este proveedor."}
      </p>
    </Modal>
  );
}

function ModalConfirmarImportacion({ revision, excluidas, onCerrar, onConfirmar }) {
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
        <li>{plural(sinCambios + invalidas + excluidas, "fila se omitirá", "filas se omitirán")} ({sinCambios} sin cambios, {plural(invalidas, "inválida", "inválidas")}, {plural(excluidas, "excluida", "excluidas")}).</li>
      </ul>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Se importan las filas con tus correcciones. Todo el lote se guarda en una sola operación: si algo falla, no se aplica ningún cambio. Importar no reserva ni descuenta existencias.</p>
    </Modal>
  );
}

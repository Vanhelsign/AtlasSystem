import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal.jsx'

const numero = (valor, unidad = '') => valor === null || valor === undefined
  ? 'No registrado'
  : `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(valor)}${unidad}`

const moneda = (valor) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', maximumFractionDigits: 2,
}).format(valor ?? 0)

const fecha = (valor) => valor
  ? new Date(`${valor.replace(' ', 'T')}Z`).toLocaleString('es-MX')
  : 'No registrada'

const estadoRevision = (solicitud) => {
  if (solicitud.revision_tecnica_estado === 'completada') return 'Revisión técnica completada'
  if (solicitud.revision_tecnica_estado === 'en_revision') return 'En revisión técnica'
  return 'Pendiente de revisión técnica'
}

export default function SolicitudesDimensionamiento({ token, inventario }) {
  const [solicitudes, setSolicitudes] = useState([])
  const [tecnico, setTecnico] = useState(null)
  const [seleccionadaId, setSeleccionadaId] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [items, setItems] = useState([])
  const [productoId, setProductoId] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [confirmandoCompletar, setConfirmandoCompletar] = useState(false)
  const [errorCompletar, setErrorCompletar] = useState('')

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.')
    return data
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/tecnico/solicitudes', { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data })
      .then((data) => { setSolicitudes(data.solicitudes); setTecnico(data.tecnico); setError('') })
      .catch((fetchError) => { if (fetchError.name !== 'AbortError') setError(fetchError.message || 'No se pudieron cargar las solicitudes.') })
      .finally(() => { if (!controller.signal.aborted) setCargando(false) })
    return () => controller.abort()
  }, [token])

  useEffect(() => {
    if (!seleccionadaId) return undefined
    const controller = new AbortController()
    fetch(`/api/tecnico/solicitudes/${seleccionadaId}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data })
      .then((data) => { setDetalle(data); setItems(data.revision_items || []); setError('') })
      .catch((fetchError) => { if (fetchError.name !== 'AbortError') setError(fetchError.message || 'No se pudo cargar el detalle.') })
    return () => controller.abort()
  }, [seleccionadaId, token])

  const actualizarLocal = (data) => {
    setDetalle(data)
    setItems(data.revision_items || [])
    setSolicitudes((actuales) => actuales.map((solicitud) => solicitud.id === data.id ? { ...solicitud, ...data } : solicitud))
  }

  const ejecutar = async (accion, mensajeExito) => {
    setProcesando(true); setError(''); setMensaje('')
    try {
      const data = await accion()
      actualizarLocal(data)
      setMensaje(mensajeExito)
      return data
    } catch (apiError) {
      setError(apiError.message)
      return null
    } finally {
      setProcesando(false)
    }
  }

  const tomar = () => ejecutar(
    () => api(`/api/tecnico/solicitudes/${detalle.id}/tomar`, { method: 'POST', body: '{}' }),
    'Solicitud tomada correctamente.',
  )

  const agregar = () => {
    const id = Number(productoId)
    const producto = inventario.find((item) => item.id === id && item.activo)
    const unidades = Number(cantidad)
    if (!producto) return setError('Selecciona un producto activo del catálogo.')
    if (!Number.isInteger(unidades) || unidades < 1) return setError('La cantidad debe ser un entero positivo.')
    setItems((actuales) => {
      const existente = actuales.find((item) => item.producto_id === id)
      if (existente) return actuales.map((item) => item.producto_id === id ? { ...item, cantidad: Number(item.cantidad) + unidades } : item)
      return [...actuales, {
        producto_id: producto.id,
        producto_codigo: producto.codigo,
        tipo_aplicado: producto.tipo,
        modelo_aplicado: producto.modelo,
        clasificacion_aplicada: producto.clasificacion,
        costo_unitario_aplicado: producto.costo_unitario,
        cantidad: unidades,
      }]
    })
    setProductoId(''); setCantidad(1); setError(''); setMensaje('Renglón agregado; guarda el borrador para persistirlo.')
  }

  const cambiarCantidad = (id, valor) => setItems((actuales) => actuales.map((item) => item.producto_id === id ? { ...item, cantidad: valor } : item))
  const quitar = (id) => setItems((actuales) => actuales.filter((item) => item.producto_id !== id))
  const payloadItems = () => items.map((item) => ({ producto_id: item.producto_id, cantidad: Number(item.cantidad) }))

  const guardar = () => ejecutar(
    () => api(`/api/tecnico/solicitudes/${detalle.id}/borrador`, { method: 'PUT', body: JSON.stringify({ items: payloadItems() }) }),
    'Borrador guardado correctamente.',
  )

  const pedirCompletar = () => {
    if (items.length === 0) return setError('Agrega al menos un material o servicio antes de completar.')
    setError(''); setErrorCompletar(''); setConfirmandoCompletar(true)
  }

  const completar = async () => {
    setProcesando(true); setErrorCompletar(''); setMensaje('')
    try {
      const guardado = await api(`/api/tecnico/solicitudes/${detalle.id}/borrador`, { method: 'PUT', body: JSON.stringify({ items: payloadItems() }) })
      const completado = await api(`/api/tecnico/solicitudes/${guardado.id}/completar`, { method: 'POST', body: '{}' })
      actualizarLocal(completado)
      setConfirmandoCompletar(false)
      setMensaje('Revisión técnica completada. Está disponible para preparar la cotización final.')
    } catch (apiError) {
      setErrorCompletar(apiError.message)
    } finally {
      setProcesando(false)
    }
  }

  const puedeEditar = detalle?.revision_tecnica_estado === 'en_revision' && detalle?.tecnico_responsable_id === tecnico?.id
  const total = useMemo(() => items.reduce((suma, item) => suma + (Number(item.costo_unitario_aplicado) || 0) * (Number(item.cantidad) || 0), 0), [items])
  const productosActivos = inventario.filter((item) => item.activo)

  if (cargando) return <p className="p-6 text-sm text-slate-500">Cargando solicitudes…</p>

  return <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold text-slate-900">Solicitudes de dimensionamiento</h1><p className="mt-1 text-sm text-slate-500">Solicitudes de {tecnico?.estado_trabajo_codigo || 'tu estado de trabajo'} disponibles para revisión técnica.</p></div>
    {(error || mensaje) && <p className={`rounded-lg p-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{error || mensaje}</p>}
    <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.65fr)] lg:items-start">
      <section className="space-y-3">
        {solicitudes.map((solicitud) => {
          const propia = solicitud.tecnico_responsable_id === tecnico?.id
          return <button key={solicitud.id} type="button" onClick={() => { setSeleccionadaId(solicitud.id); setMensaje('') }} className={`w-full rounded-xl border p-4 text-left transition ${seleccionadaId === solicitud.id ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100' : 'bg-white hover:border-indigo-300'}`}>
            <div className="flex items-start justify-between gap-3"><p className="font-bold text-slate-900">{solicitud.prospecto_nombre}</p><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${solicitud.revision_tecnica_id ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'}`}>{solicitud.revision_tecnica_id ? propia ? 'Tomada por ti' : 'Tomada' : 'Disponible'}</span></div>
            <p className="mt-2 text-sm text-slate-600">{solicitud.direccion_municipio}, {solicitud.direccion_estado}</p>
            <p className="mt-1 text-xs text-slate-500">{solicitud.modalidad === 'historial_cfe' ? 'Recibo CFE' : 'Por electrodomésticos'} · {fecha(solicitud.created_at)}</p>
            <p className="mt-2 text-xs font-semibold text-indigo-700">{estadoRevision(solicitud)}</p>
          </button>
        })}
        {solicitudes.length === 0 && <p className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500">No hay solicitudes disponibles para tu estado de trabajo.</p>}
      </section>

      <section className="min-w-0 rounded-xl border bg-white p-4 sm:p-6">
        {!detalle ? <p className="py-12 text-center text-sm text-slate-500">Selecciona una solicitud para revisar sus datos.</p> : <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl font-bold">{detalle.prospecto_nombre}</h2><p className="text-sm font-semibold text-indigo-700">{estadoRevision(detalle)}</p></div>{!detalle.revision_tecnica_id && <button disabled={procesando} onClick={tomar} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:bg-indigo-300">Tomar solicitud</button>}</div>
          {detalle.revision_tecnica_id && <p className="rounded-lg bg-slate-50 p-3 text-sm"><b>Técnico responsable:</b> {detalle.tecnico_responsable}<br/><span className="text-slate-500">Tomada: {fecha(detalle.revision_tomada_at)}{detalle.revision_completada_at ? ` · Finalizada: ${fecha(detalle.revision_completada_at)}` : ''}</span></p>}
          {detalle.correccion_motivo && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">Corrección solicitada por el agente</p><p className="mt-1 whitespace-pre-wrap">{detalle.correccion_motivo}</p><p className="mt-2 text-xs text-amber-700">Devuelta: {fecha(detalle.correccion_devuelta_at)}. Corrige la propuesta, guarda el borrador y vuelve a completar la revisión.</p></div>}

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Dato titulo="Método" valor={detalle.modalidad === 'historial_cfe' ? 'Recibo CFE' : 'Estimación por electrodomésticos'} />
            <Dato titulo="Consumo mensual estimado" valor={numero(detalle.consumo_mensual_kwh, ' kWh/mes')} />
            <Dato titulo="Margen o excedente solicitado" valor={numero(detalle.margen_crecimiento_pct, ' %')} />
            <Dato titulo="Consumo objetivo" valor={numero(detalle.consumo_objetivo_kwh, ' kWh/mes')} />
            <Dato titulo="Cobertura nocturna con baterías" valor={detalle.cubrir_baterias ? `Sí · ${numero(detalle.cobertura_nocturna_pct, ' % del consumo nocturno')}` : 'No'} />
            {detalle.cubrir_baterias === 1 && <Dato titulo="Necesidad estimada de batería" valor={numero(detalle.necesidad_bateria_kwh_dia, ' kWh/día')} />}
            {detalle.estimacion_consumo_nocturno_pct != null && <Dato titulo="Consumo total estimado durante la noche" valor={numero(detalle.estimacion_consumo_nocturno_pct, ' %')} />}
            {detalle.potencia_conectada_w != null && <Dato titulo="Potencia conectada estimada" valor={numero(detalle.potencia_conectada_w, ' W')} />}
          </div>

          {detalle.historial_cfe?.map((recibo) => <div key={recibo.id} className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm"><h3 className="font-bold text-blue-900">Recibo CFE</h3><p>{numero(recibo.consumo_kwh, ' kWh')} · Periodo {recibo.periodo}</p><p className="text-blue-700">{recibo.mes_inicio ? `Mes inicial: ${recibo.mes_inicio}` : 'Mes no registrado'}</p></div>)}
          {detalle.electrodomesticos?.length > 0 && <div><h3 className="font-bold">Electrodomésticos capturados</h3><div className="mt-2 overflow-x-auto"><table className="min-w-[560px] w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Aparato</th><th className="p-2">Potencia</th><th className="p-2">Cantidad</th><th className="p-2">Uso</th><th className="p-2">Consumo</th></tr></thead><tbody>{detalle.electrodomesticos.map((equipo) => <tr key={equipo.id} className="border-t"><td className="p-2">{equipo.tipo}</td><td className="p-2 text-center">{numero(equipo.potencia_w, ' W')}</td><td className="p-2 text-center">{equipo.cantidad}</td><td className="p-2 text-center">{numero(equipo.horas_dia, ' h día')} / {numero(equipo.horas_noche, ' h noche')}</td><td className="p-2 text-center">{numero(equipo.consumo_total_kwh, ' kWh/día')}</td></tr>)}</tbody></table></div></div>}

          <div><h3 className="font-bold">Dirección de instalación</h3><p className="mt-1 text-sm text-slate-600">{detalle.direccion_calle} {detalle.direccion_numero_exterior}{detalle.direccion_numero_interior ? `, int. ${detalle.direccion_numero_interior}` : ''}, {detalle.direccion_colonia}, C.P. {detalle.direccion_codigo_postal}, {detalle.direccion_municipio}, {detalle.direccion_estado}.</p></div>

          {detalle.revision_tecnica_id && <div className="space-y-4 border-t pt-5"><div><h3 className="text-lg font-bold">Materiales y servicios propuestos</h3><p className="text-xs text-slate-500">Esta selección no reserva ni descuenta existencias.</p></div>
            {puedeEditar && <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_100px_auto] sm:items-end"><label className="text-sm font-medium">Producto activo<select value={productoId} onChange={(event) => setProductoId(event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 font-normal"><option value="">Selecciona un producto</option>{productosActivos.map((producto) => <option key={producto.id} value={producto.id}>{producto.tipo} · {producto.modelo} · {producto.clasificacion} · {moneda(producto.costo_unitario)}{producto.clasificacion === 'material' ? ` · ${producto.existencias} uds.` : ''}</option>)}</select></label><label className="text-sm font-medium">Cantidad<input type="number" min="1" step="1" value={cantidad} onChange={(event) => setCantidad(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"/></label><button onClick={agregar} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white">Añadir</button></div>}
            <div className="overflow-x-auto"><table className="min-w-[650px] w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Producto</th><th className="p-2">Clase</th><th className="p-2">Cantidad</th><th className="p-2">Costo aplicado</th><th className="p-2">Subtotal</th>{puedeEditar && <th className="p-2">Acción</th>}</tr></thead><tbody>{items.map((item) => {
              const productoActual = inventario.find((producto) => producto.id === item.producto_id)
              const existencias = item.catalogo_existencias ?? productoActual?.existencias
              const excede = item.clasificacion_aplicada === 'material' && Number(item.cantidad) > Number(existencias)
              return <tr key={item.producto_id} className="border-t"><td className="p-2"><b>{item.tipo_aplicado}</b><br/><span className="text-slate-500">{item.modelo_aplicado}</span>{excede && <span className="mt-1 block text-xs font-bold text-amber-700">Aviso: supera las {existencias} unidades disponibles.</span>}</td><td className="p-2 text-center">{item.clasificacion_aplicada === 'servicio' ? 'Servicio' : 'Material'}</td><td className="p-2 text-center">{puedeEditar ? <input type="number" min="1" step="1" value={item.cantidad} onChange={(event) => cambiarCantidad(item.producto_id, event.target.value)} className="w-20 rounded border px-2 py-1"/> : item.cantidad}</td><td className="p-2 text-right">{moneda(item.costo_unitario_aplicado)}</td><td className="p-2 text-right font-semibold">{moneda(Number(item.costo_unitario_aplicado) * Number(item.cantidad))}</td>{puedeEditar && <td className="p-2 text-center"><button onClick={() => quitar(item.producto_id)} className="text-xs font-bold text-red-600">Quitar</button></td>}</tr>
            })}</tbody></table>{items.length === 0 && <p className="p-5 text-center text-sm text-slate-500">Todavía no hay renglones en la propuesta.</p>}</div>
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-lg font-bold">Costo total técnico: {moneda(total)}</p>{puedeEditar && <div className="flex flex-col gap-2 sm:flex-row"><button disabled={procesando} onClick={guardar} className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-bold text-indigo-700 disabled:opacity-50">Guardar borrador</button><button disabled={procesando} onClick={pedirCompletar} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:bg-green-300">Completar revisión técnica</button></div>}</div>
            {!puedeEditar && detalle.revision_tecnica_estado === 'en_revision' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">La revisión está a cargo de {detalle.tecnico_responsable}; solo esa persona puede editarla.</p>}
          </div>}
        </div>}
      </section>
    </div>
    {confirmandoCompletar && <Modal
      titulo="¿Completar la revisión técnica?"
      descripcion={detalle?.prospecto_nombre}
      error={errorCompletar}
      ocupado={procesando}
      onCerrar={() => setConfirmandoCompletar(false)}
      onEnviar={completar}
      acciones={<>
        <button type="button" data-autofocus onClick={() => setConfirmandoCompletar(false)} disabled={procesando} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">Seguir editando</button>
        <button type="submit" disabled={procesando} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:bg-green-300">{procesando ? 'Completando…' : 'Completar revisión'}</button>
      </>}
    >
      <p className="text-sm text-slate-600">Se guardará la propuesta con {items.length} {items.length === 1 ? 'renglón' : 'renglones'} y un costo técnico de <b>{moneda(total)}</b>. Después ya no podrá editarse; el agente podrá aprobarla o devolverla para corrección.</p>
    </Modal>}
  </div>
}

function Dato({ titulo, valor }) {
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{titulo}</p><p className="mt-1 font-semibold text-slate-900">{valor}</p></div>
}

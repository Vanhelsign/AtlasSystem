import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { dineroCompra as dinero, fechaCompra as fecha, pedirCompra } from './compraApi.js'
import { BotonDocumento } from './PortalCompra.jsx'

// La auditoría original permanece en el servidor. Aquí solo se presenta su
// información de negocio, sin volcar el JSON ni metadatos del entorno.
function EventoPago({ evento }) {
  let datos
  try { datos = JSON.parse(evento.detalle) } catch { /* Los eventos antiguos pueden ser texto. */ }
  const estructurado = datos && typeof datos === 'object' && !Array.isArray(datos)
  const titulos = { emitida: 'Orden emitida', vencida: 'Orden vencida', confirmada: 'Confirmación registrada' }
  const actor = estructurado && datos.tipo_actor === 'cuenta_cliente' ? 'Cuenta del cliente' : 'Usuario'
  const campos = estructurado ? [
    ...(typeof datos.importe === 'number' && Number.isFinite(datos.importe) ? [['Importe', `${dinero(datos.importe)} MXN`]] : []),
    ...(datos.fecha_pago ? [['Fecha del pago', fecha(datos.fecha_pago)]] : []),
    ...(datos.referencia ? [['Referencia', datos.referencia]] : []),
    ...(datos.motivo_tardio ? [['Motivo de confirmación fuera de plazo', datos.motivo_tardio]] : []),
  ] : []
  return <li className="rounded-lg border bg-slate-50 p-3">
    <p className="font-semibold text-slate-700">{titulos[evento.evento] || 'Actualización de la orden'}</p>
    <p className="mt-1 text-xs">{fecha(evento.created_at)}{evento.actor_id ? ` · ${actor} #${evento.actor_id}` : ''}</p>
    {estructurado ? <>
      <p className="mt-2 text-sm text-slate-600">{evento.evento === 'confirmada' ? 'La confirmación quedó registrada en el sistema.' : 'Se actualizó la información de la orden.'}</p>
      {!!campos.length && <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">{campos.map(([nombre, valor]) => <div key={nombre}><dt className="text-slate-500">{nombre}</dt><dd className="break-words font-medium text-slate-700">{valor}</dd></div>)}</dl>}
    </> : <p className="mt-2 break-words text-xs">{typeof datos === 'undefined' ? evento.detalle : 'Actualización registrada para esta orden.'}</p>}
  </li>
}

export default function PagosAdmin({ token, onCambio }) {
  const [ordenes, setOrdenes] = useState([])
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [seleccionada, setSeleccionada] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  useEffect(() => {
    let vigente = true
    pedirCompra(token, '/api/admin/pagos').then((datos) => { if (vigente) { setOrdenes(datos); setError('') } }).catch((err) => { if (vigente) setError(err.message) })
    return () => { vigente = false }
  }, [token, version])
  const visibles = ordenes.filter((orden) => filtro === 'todos' || orden.estado === filtro)
  return <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">Verificación de pagos</h1><p className="mt-1 text-sm text-slate-500">Confirma únicamente pagos reales cuyo importe completo hayas verificado.</p></div><button onClick={() => setVersion((actual) => actual + 1)} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold text-indigo-700">Actualizar</button></div>
    {(error || mensaje) && <p role="status" className={`rounded-lg p-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{error || mensaje}</p>}
    <label className="block text-sm font-medium">Estatus<select value={filtro} onChange={(event) => setFiltro(event.target.value)} className="ml-3 rounded-lg border bg-white px-3 py-2"><option value="todos">Todos</option><option value="pendiente">Pendientes</option><option value="vencida">Vencidos</option><option value="pagada">Confirmados</option></select></label>
    <div className="space-y-3">{visibles.map((orden) => <article key={orden.id} className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-bold">{orden.folio} · {orden.nombre}</h2><p className="break-words text-sm text-slate-500">{orden.email} · Límite: {fecha(orden.limite_at)}</p></div><p className="font-bold text-indigo-700">{dinero(orden.importe)} MXN</p></div>
      <p className={`text-sm font-semibold ${orden.estado === 'pagada' ? 'text-green-700' : 'text-amber-800'}`}>{orden.estado === 'pagada' ? 'Pago confirmado' : orden.estado === 'vencida' ? 'Orden vencida; requiere motivo para confirmar' : 'Pago pendiente'}</p>
      {orden.estado === 'pagada' && !orden.pago_simulado && <p className="text-sm text-slate-600">Pago: {fecha(orden.pago_fecha)} · Referencia: {orden.pago_referencia} · Confirmación: {fecha(orden.confirmada_at)}</p>}
      <div className="flex flex-wrap gap-2"><BotonDocumento token={token} ruta={`/api/cotizaciones/${orden.cotizacion_id}/pdf`}>Ver cotización firmada</BotonDocumento>{orden.estado !== 'pagada' && <button onClick={() => setSeleccionada(orden)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Verificar y confirmar pago</button>}</div>
      <details className="text-sm text-slate-500"><summary className="cursor-pointer">Historial de la orden</summary><ul className="mt-3 space-y-2">{orden.auditoria.map(evento => <EventoPago key={evento.id} evento={evento}/>)}</ul></details>
    </article>)}{visibles.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">No hay órdenes de pago con este estatus.</p>}</div>
    {seleccionada && <ConfirmarPago key={seleccionada.id} orden={seleccionada} token={token} onCerrar={() => setSeleccionada(null)} onConfirmada={() => { setSeleccionada(null); setVersion((actual) => actual + 1); setMensaje('Pago confirmado. La cuenta es Cliente y se creó su orden de instalación.'); onCambio() }}/>}</div>
}

function ConfirmarPago({ orden, token, onCerrar, onConfirmada }) {
  const [fechaPago, setFechaPago] = useState('')
  const [referencia, setReferencia] = useState('')
  const [motivo, setMotivo] = useState('')
  const [verificado, setVerificado] = useState(false)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const enviar = async () => {
    setError('')
    if (!fechaPago || Number.isNaN(new Date(fechaPago).getTime())) return setError('Indica la fecha y hora reales del pago.')
    setOcupado(true)
    try {
      await pedirCompra(token, `/api/admin/pagos/${orden.id}/confirmar`, {
        fecha_pago: new Date(fechaPago).toISOString(), referencia, verificado, motivo_tardio: motivo,
      })
      onConfirmada()
    } catch (err) { setError(err.message); setOcupado(false) }
  }
  return <Modal titulo="Confirmar pago verificado" descripcion={orden.folio} ocupado={ocupado} error={error} onCerrar={onCerrar} onEnviar={enviar} confirmarCierre={Boolean(fechaPago || referencia || motivo || verificado)} acciones={<><button type="button" disabled={ocupado} onClick={onCerrar} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="submit" disabled={ocupado || !verificado || !fechaPago || referencia.trim().length < 3} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{ocupado ? 'Confirmando…' : 'Confirmar pago real'}</button></>}><p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Comprueba que recibiste {dinero(orden.importe)} MXN por esta orden. Esta acción confirma la compra y genera una orden de instalación.</p><label className="block text-sm font-medium">Fecha y hora reales del pago<input type="datetime-local" value={fechaPago} onChange={(event) => setFechaPago(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><label className="block text-sm font-medium">Referencia bancaria o identificador del comprobante<input maxLength={250} value={referencia} onChange={(event) => setReferencia(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"/><span className="mt-1 block text-xs text-slate-500">Referencia verificable del pago recibido; se conserva para auditoría.</span></label>{orden.estado === 'vencida' && <label className="block text-sm font-medium">Motivo para admitir un pago fuera de plazo<textarea value={motivo} maxLength={1000} onChange={(event) => setMotivo(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"/></label>}<label className="flex gap-3 text-sm"><input type="checkbox" checked={verificado} onChange={(event) => setVerificado(event.target.checked)} className="mt-1 h-4 w-4 shrink-0"/><span>Verifiqué la recepción real del importe completo y su correspondencia con esta orden.</span></label></Modal>
}

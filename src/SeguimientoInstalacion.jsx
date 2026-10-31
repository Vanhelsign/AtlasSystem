import { useEffect, useState } from 'react'
import { pedirCompra, fechaCompra } from './compraApi.js'

export default function SeguimientoInstalacion({ token, ordenInicialId, cotizacionInicialId, onVolver }) {
  const [ordenes, setOrdenes] = useState([]), [seleccion, setSeleccion] = useState(ordenInicialId ? String(ordenInicialId) : '')
  const [error, setError] = useState(''), [cargando, setCargando] = useState(true), [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    pedirCompra(token, '/api/portal/instalaciones', undefined, { signal: controller.signal })
      .then(datos => { setOrdenes(datos); setError(''); setCargando(false) })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setCargando(false) } })
    return () => controller.abort()
  }, [token, version])
  useEffect(() => {
    const actualizar = () => setVersion(v => v + 1), intervalo = window.setInterval(actualizar, 30000)
    window.addEventListener('focus', actualizar)
    return () => { window.clearInterval(intervalo); window.removeEventListener('focus', actualizar) }
  }, [])
  const orden = seleccion ? ordenes.find(o => String(o.id) === seleccion) : cotizacionInicialId ? ordenes.find(o => o.cotizacion_id === cotizacionInicialId) : ordenes[0]
  return <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-bold text-slate-900">Mi instalación</h1><button onClick={() => setVersion(v => v + 1)} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold text-indigo-700">Actualizar seguimiento</button></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {cargando ? <p className="text-sm text-slate-500">Cargando seguimiento…</p> : !orden ? <p className="rounded-xl border border-dashed bg-white p-6 text-sm text-slate-600">{cotizacionInicialId ? 'El seguimiento de esta cotización todavía no está disponible. Puedes volver a Inicio para consultar el estado de tu proyecto.' : 'Todavía no hay una orden de instalación para tu cuenta. Estará disponible después de confirmar el pago de tu cotización aceptada.'}</p> : <>
      {ordenes.length > 1 && <label className="block text-sm font-semibold">Proyecto<select value={orden.id} onChange={e => setSeleccion(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3">{ordenes.map(o => <option key={o.id} value={o.id}>{o.folio} · Cotización #{o.cotizacion_id} · versión {o.version}</option>)}</select></label>}
      <section className="space-y-4 rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><h2 className="text-xl font-semibold">{orden.folio}</h2><span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">{orden.estado}</span></div><p className="text-sm text-slate-500">Cotización #{orden.cotizacion_id} · versión {orden.version}</p><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Fecha programada de visita</dt><dd className="font-semibold">{orden.fecha_programada ? fechaCompra(orden.fecha_programada) : 'El técnico aún no programa la visita'}</dd></div><div><dt className="text-xs text-slate-500">Técnico responsable</dt><dd className="font-semibold">{orden.tecnico_nombre || 'Pendiente de toma por un técnico'}</dd></div>{orden.fecha_fin_real && <div><dt className="text-xs text-slate-500">Fecha real de finalización</dt><dd className="font-semibold text-green-700">{fechaCompra(orden.fecha_fin_real)}</dd></div>}</dl>{orden.aviso && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{orden.aviso}</p>}</section>
      <section className="space-y-4 rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">Avance de la instalación</h2>{orden.seguimiento_anterior ? <p className="text-sm text-slate-600">Esta instalación finalizó antes del seguimiento por partes. Se conserva su fecha real de finalización; no hay un desglose de actividades registrado.</p> : orden.etapas.map(e => <article key={e.parte} className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{e.parte}. {e.nombre}</h3><span className={`text-sm font-semibold ${e.completa ? 'text-green-700' : 'text-slate-500'}`}>{e.completa ? 'Completada' : 'Pendiente de completar'}</span></div><p className="mt-2 text-sm text-slate-600">{e.parte === 1 ? 'Revisión de materiales, herramientas y condiciones del lugar.' : e.parte === 2 ? 'Montaje y conexiones de los componentes de tu proyecto.' : 'Comprobación del funcionamiento y revisión de la instalación.'}</p><p className="mt-2 text-xs text-slate-500">{e.completadas} de {e.total} verificaciones registradas.</p></article>)}</section>
    </>}
    <div className="flex justify-end"><button onClick={onVolver} className="rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700">Volver a Inicio</button></div>
  </div>
}

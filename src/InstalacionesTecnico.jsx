import { useEffect, useState } from 'react'
import { fechaCompra, pedirCompra } from './compraApi.js'
import EditorInstalacion from './EditorInstalacion.jsx'
import { principalInstalacion as principal, secundarioInstalacion as secundario, direccionInstalacion as direccion } from './instalacionUi.js'

export default function InstalacionesTecnico({ token }) {
  const [ordenes, setOrdenes] = useState([]), [seleccion, setSeleccion] = useState(null)
  const [version, setVersion] = useState(0), [error, setError] = useState(''), [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    if (seleccion) return
    const controller = new AbortController()
    pedirCompra(token, '/api/tecnico/instalaciones', undefined, { signal: controller.signal }).then(setOrdenes)
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [token, version, seleccion])
  useEffect(() => {
    const actualizar = () => setVersion(v => v + 1), intervalo = window.setInterval(actualizar, 30000)
    window.addEventListener('focus', actualizar)
    return () => { window.clearInterval(intervalo); window.removeEventListener('focus', actualizar) }
  }, [])
  const abrir = async orden => {
    setOcupado(true); setError('')
    try { const datos = orden.disponible ? await pedirCompra(token, `/api/tecnico/instalaciones/${orden.id}/tomar`, {}) : await pedirCompra(token, `/api/tecnico/instalaciones/${orden.id}`); setSeleccion(datos) }
    catch (err) { setError(err.message); setVersion(v => v + 1) } finally { setOcupado(false) }
  }
  if (seleccion) return <EditorInstalacion key={seleccion.id} inicial={seleccion} token={token} onSalir={() => { setSeleccion(null); setVersion(v => v + 1) }}/>
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-900">Órdenes de instalación</h2><p className="mt-1 text-sm text-slate-500">Instalaciones de los proyectos que dimensionaste, con pago confirmado y dentro de tu estado de trabajo.</p></div><button onClick={() => { setError(''); setVersion(v => v + 1) }} className={secundario}>Actualizar instalaciones</button></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-4 xl:grid-cols-2">{ordenes.map(o => <article key={o.id} className="space-y-3 rounded-xl border bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{o.folio} · {o.cliente_nombre}</h3><span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{o.estado_visible}</span></div><p className="text-sm text-slate-600">{direccion(o)}</p><p className="text-sm">Cotización #{o.cotizacion_id} · versión {o.version}</p><p className="text-sm">{o.fecha_programada ? `Programada: ${fechaCompra(o.fecha_programada)}` : 'Fecha pendiente de programación por el técnico.'}</p>{!o.disponible && !o.puede_editar && <p className="text-sm text-slate-500">Tomada por otro técnico. Solo su responsable puede abrirla y modificarla.</p>}<div className="flex justify-end">{(o.disponible || o.puede_editar) && <button disabled={ocupado} onClick={() => abrir(o)} className={principal}>{o.disponible ? 'Tomar orden' : o.estatus_obra === 'completada' ? 'Consultar instalación' : 'Continuar instalación'}</button>}</div></article>)}</div>
    {!error && !ordenes.length && <p className="rounded-xl border border-dashed p-6 text-sm text-slate-500">Todavía no tienes órdenes de instalación pagadas de proyectos que hayas dimensionado en tu estado de trabajo.</p>}
  </div>
}

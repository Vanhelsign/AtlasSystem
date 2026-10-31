import { useEffect, useState } from 'react'
import { BotonDocumento } from './PortalCompra.jsx'
import { pedirCompra, dineroCompra, fechaCompra } from './compraApi.js'

// Una fecha de calendario no contiene hora ni zona: no desplazarla al día anterior.
const fechaProyecto = valor => /^\d{4}-\d{2}-\d{2}$/.test(valor)
  ? new Date(`${valor}T12:00:00`).toLocaleDateString('es-MX', { dateStyle: 'long' }) : fechaCompra(valor)

function mensajeProyecto(proyecto) {
  const { progreso, tecnico_nombre: nombre } = proyecto
  if (progreso.estado === 'espera') return 'Tu pago está confirmado. Estamos preparando la información de seguimiento de tu instalación.'
  if (progreso.estado === 'finalizada') return 'Tu instalación ha finalizado. Puedes consultar el seguimiento y la fecha de cierre.'
  if (progreso.estado === 'incidencia') return 'Hay una incidencia que puede afectar el avance de tu instalación. El progreso registrado se conserva.'
  if (progreso.estado === 'postergada') return 'La instalación está postergada. El progreso registrado se conserva y el técnico actualizará la programación.'
  if (progreso.estado === 'en_curso') {
    const fase = progreso.etapas.find(e => e.actual)
    return `Tu instalación está en la fase de ${fase?.nombre.toLowerCase() || 'seguimiento'}. Consulta el detalle para conocer el avance registrado.`
  }
  return nombre ? `Tu compra está confirmada. ${nombre} será responsable de la instalación.` : 'Tu compra está confirmada. Puedes consultar el seguimiento de tu proyecto.'
}

export default function InicioCliente({ token, onInstalacion }) {
  const [proyectos, setProyectos] = useState([]), [seleccion, setSeleccion] = useState('')
  const [version, setVersion] = useState(0), [error, setError] = useState(''), [cargando, setCargando] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    pedirCompra(token, '/api/portal/proyectos', undefined, { signal: controller.signal })
      .then(datos => { setProyectos(datos); setError(''); setCargando(false) })
      .catch(err => { if (!controller.signal.aborted) { setError(err.message); setCargando(false) } })
    return () => controller.abort()
  }, [token, version])
  useEffect(() => {
    const actualizar = () => setVersion(v => v + 1), intervalo = window.setInterval(actualizar, 30000)
    window.addEventListener('focus', actualizar)
    return () => { window.clearInterval(intervalo); window.removeEventListener('focus', actualizar) }
  }, [])
  const proyecto = seleccion ? proyectos.find(p => String(p.cotizacion.id) === seleccion) : proyectos[0]
  const cotizacion = proyecto?.cotizacion, pago = cotizacion?.orden_pago
  return <div className="space-y-5">
    {proyectos.length > 1 && <label className="block text-sm font-semibold text-slate-700">Proyecto<select aria-label="Proyecto" value={seleccion || String(proyectos[0].cotizacion.id)} onChange={e => setSeleccion(e.target.value)} className="mt-2 w-full rounded-lg border bg-white p-3">{proyectos.map(p => <option key={p.cotizacion.id} value={p.cotizacion.id}>{p.cotizacion.folio} · {dineroCompra(p.cotizacion.orden_pago.importe)} MXN</option>)}</select></label>}
    <section className="space-y-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-7" aria-labelledby="estado-instalacion">
      <div className="flex flex-wrap items-start justify-between gap-3"><h2 id="estado-instalacion" className="text-2xl font-bold text-slate-900">Estado de mi instalación</h2><button type="button" onClick={() => setVersion(v => v + 1)} className="text-sm font-semibold text-indigo-700">Actualizar</button></div>
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : cargando ? <p className="text-sm text-slate-500">Cargando el estado de tu proyecto…</p> : !proyecto ? <p className="text-sm text-slate-600">{seleccion ? 'El proyecto seleccionado ya no está disponible para esta cuenta.' : 'Estamos preparando la información de tus proyectos confirmados. El seguimiento aparecerá aquí cuando esté disponible.'}</p> : <>
        <p className={`rounded-xl p-4 text-sm ${['incidencia', 'postergada'].includes(proyecto.progreso.estado) ? 'bg-amber-50 text-amber-900' : 'bg-indigo-50 text-indigo-900'}`}>{mensajeProyecto(proyecto)}</p>
        <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Técnico responsable</dt><dd className="mt-1 font-semibold text-slate-800">{proyecto.tecnico_nombre || 'Información por confirmar'}</dd></div><div><dt className="text-xs text-slate-500">Fecha programada de instalación</dt><dd className="mt-1 font-semibold text-slate-800">{proyecto.orden?.fecha_programada ? fechaProyecto(proyecto.orden.fecha_programada) : 'Fecha por definir'}</dd></div></dl>
        <ol aria-label="Avance del proyecto" className="grid gap-3 sm:grid-cols-4">{proyecto.progreso.etapas.map((etapa, i) => <li key={etapa.nombre} aria-current={etapa.actual ? 'step' : undefined} className={`rounded-xl border p-3 ${etapa.completada ? 'border-green-200 bg-green-50 text-green-800' : etapa.actual ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
          <span className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full font-bold ${etapa.completada ? 'bg-green-600 text-white' : etapa.actual ? 'fase-instalacion-actual bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`} aria-hidden="true">{etapa.completada ? '✓' : i + 1}</span>
          <p className="text-sm font-semibold">{etapa.nombre}</p><p className="mt-1 text-xs">{etapa.completada ? 'Completada' : etapa.actual ? 'En curso' : 'Pendiente'}</p>
        </li>)}</ol>
        {proyecto.progreso.estado === 'finalizada' && <div className="space-y-2 rounded-xl bg-green-50 p-4 text-sm text-green-900">{proyecto.orden?.fecha_fin_real && <p>Fecha real de finalización: <b>{fechaProyecto(proyecto.orden.fecha_fin_real)}</b></p>}{proyecto.orden?.proximo_mantenimiento && <p>Próximo mantenimiento: <b>{fechaProyecto(proyecto.orden.proximo_mantenimiento.fecha_limite)}</b></p>}{proyecto.orden?.seguimiento_anterior && <p>Esta orden finalizó antes del seguimiento por partes; no hay un desglose de verificaciones registrado.</p>}</div>}
      </>}
      <div className="flex justify-end"><button type="button" onClick={() => onInstalacion(proyecto?.orden?.id || null, cotizacion?.id || null)} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Consultar mi instalación</button></div>
    </section>
    {cotizacion && pago && !error && <section className="space-y-4 rounded-2xl border bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold text-slate-900">Resumen de la compra</h2><dl className="grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-xs text-slate-500">Cotización</dt><dd className="mt-1 break-words font-semibold">{cotizacion.folio}</dd></div><div><dt className="text-xs text-slate-500">Importe pagado</dt><dd className="mt-1 font-semibold text-indigo-700">{dineroCompra(pago.importe)} MXN</dd></div>{pago.confirmada_at && <div><dt className="text-xs text-slate-500">Pago confirmado el</dt><dd className="mt-1 font-semibold">{fechaCompra(pago.confirmada_at)}</dd></div>}</dl><details><summary className="cursor-pointer text-sm font-semibold text-indigo-700">Documentos de la compra</summary><div className="mt-3 flex flex-wrap gap-2">{cotizacion.firmada && <BotonDocumento token={token} ruta={`/api/cotizaciones/${cotizacion.id}/pdf`}>Ver cotización firmada</BotonDocumento>}{pago.id && <BotonDocumento token={token} ruta={`/api/portal/ordenes-pago/${pago.id}/pdf`}>Ver orden de pago {pago.folio}</BotonDocumento>}</div></details></section>}
  </div>
}

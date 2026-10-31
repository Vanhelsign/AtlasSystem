import { useState } from 'react'
import { pedirCompra, fechaCompra } from './compraApi.js'
import { PARTES_INSTALACION } from '../shared/instalacion.js'
import { SelectorFotos, FotoGuardada } from './FotosInstalacion.jsx'
import { principalInstalacion as principal, secundarioInstalacion as secundario, direccionInstalacion as direccion, fechaLocalInstalacion as fechaLocal } from './instalacionUi.js'

export default function EditorInstalacion({ inicial, token, onSalir }) {
  const [orden, setOrden] = useState(inicial), [parte, setParte] = useState(inicial.parte_actual)
  const [borrador, setBorrador] = useState(inicial.actividades)
  const [fotos, setFotos] = useState({ 1: [], 2: [], 3: [] })
  const [fecha, setFecha] = useState(fechaLocal(inicial.fecha_programada))
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState(''), [aviso, setAviso] = useState('')
  const [pantalla, setPantalla] = useState('avance'), [incidencia, setIncidencia] = useState({ parte: inicial.parte_actual, actividad_codigo: '', descripcion: '', fecha_ocurrencia: '', fotos: [] })
  const [resoluciones, setResoluciones] = useState({}), [motivo, setMotivo] = useState('')
  const [operacion, setOperacion] = useState(() => crypto.randomUUID())
  const finalizada = orden.estatus_obra === 'completada'
  const editable = !finalizada && orden.iniciada_at && orden.fecha_programada && !orden.postergada_at
  const pendientes = orden.incidencias.filter(i => i.estado === 'pendiente')
  const ejecutar = async fn => {
    setOcupado(true); setError(''); setAviso('')
    try { await fn() } catch (err) { setError(err.message) } finally { setOcupado(false) }
  }
  const post = (ruta, cuerpo) => pedirCompra(token, `/api/tecnico/instalaciones/${orden.id}/${ruta}`, cuerpo)
  const actualizar = nueva => { setOrden(nueva); setOperacion(crypto.randomUUID()); setAviso('Cambios guardados correctamente.') }
  const guardar = async avanzar => {
    const nueva = await post('avance', { operacion_id: operacion, revision_avance: orden.revision_avance, parte,
      actividades: borrador.filter(a => a.parte === parte).map(({ codigo, completado, observaciones }) => ({ codigo, completado, observaciones })), fotos: fotos[parte], avanzar })
    actualizar(nueva); setFotos(actual => ({ ...actual, [parte]: [] }))
    setBorrador(actual => actual.map(a => a.parte === parte ? nueva.actividades.find(n => n.codigo === a.codigo) : a))
    if (avanzar && parte < 3) setParte(parte + 1)
  }
  const cambiarActividad = (codigo, clave, valor) => { setBorrador(actual => actual.map(a => a.codigo === codigo ? { ...a, [clave]: valor } : a)); setOperacion(crypto.randomUUID()) }
  const abrirIncidencia = () => { setIncidencia({ parte, actividad_codigo: '', descripcion: '', fecha_ocurrencia: '', fotos: [] }); setPantalla('incidencia'); setError(''); setOperacion(crypto.randomUUID()) }
  const registrarIncidencia = async event => {
    event.preventDefault()
    await ejecutar(async () => {
      const nueva = await post('incidencias', { ...incidencia, operacion_id: operacion, fecha_ocurrencia: incidencia.fecha_ocurrencia ? new Date(incidencia.fecha_ocurrencia).toISOString() : undefined })
      actualizar(nueva); setPantalla('avance')
    })
  }
  const guardarYFinalizar = () => ejecutar(async () => { await guardar(false); const nueva = await post('finalizar', {}); actualizar(nueva); setBorrador(nueva.actividades) })
  const actividadesParte = borrador.filter(a => a.parte === parte)
  const otrasPartesSinGuardar = borrador.some(a => a.parte !== parte && (a.completado !== orden.actividades.find(o => o.codigo === a.codigo).completado || a.observaciones !== orden.actividades.find(o => o.codigo === a.codigo).observaciones)) || Object.entries(fotos).some(([p, lista]) => Number(p) !== parte && lista.length > 0)
  const puedeFinalizar = editable && borrador.every(a => a.completado) && (orden.fotos.some(f => f.parte === parte) || fotos[parte].length > 0) && orden.etapas.filter(e => e.parte !== parte).every(e => e.completa) && !pendientes.length && !otrasPartesSinGuardar
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 max-w-full"><h2 className="break-words text-2xl font-bold text-slate-900">{orden.folio} · {orden.cliente_nombre}</h2><p className="mt-1 text-sm text-slate-500">Cotización #{orden.cotizacion_id} · versión {orden.version}</p></div><span className="rounded-full bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">{orden.estado_visible}</span></header>
    <section className="space-y-3 rounded-xl border bg-white p-5"><p className="text-sm">{direccion(orden)}</p><p className="text-sm">Fecha programada: {orden.fecha_programada ? fechaCompra(orden.fecha_programada) : 'Sin programar'}</p>{orden.fecha_fin_real && <p className="font-semibold text-green-700">Finalización real: {fechaCompra(orden.fecha_fin_real)}</p>}<p className="text-sm">Progreso guardado: {orden.etapas.filter(e => e.completa).length} de 3 partes completas.</p>
      <details><summary className="cursor-pointer text-sm font-semibold text-indigo-700">Materiales y servicios de la cotización aprobada</summary><ul className="mt-2 space-y-2 text-sm">{orden.materiales.map((m, i) => <li key={i}>{m.cantidad} × {m.tipo} · {m.modelo} <span className="text-xs text-slate-500">({m.clasificacion === 'servicio' ? 'Servicio' : 'Material físico'})</span></li>)}</ul><p className="mt-2 text-xs text-slate-500">El checklist verifica el alcance aprobado; no descuenta ni reserva inventario.</p></details>
      {orden.registros_anteriores.length > 0 && <details><summary className="cursor-pointer text-sm">Registros anteriores conservados</summary>{orden.registros_anteriores.map((r, i) => <p key={i} className="text-xs">{r.etapa}: {r.completado ? 'Marcado' : 'Pendiente'} · {r.observaciones || 'Sin observación'}</p>)}</details>}
    </section>
    <div className="sticky top-0 z-10 flex flex-wrap justify-end gap-2 rounded-lg bg-slate-50/95 p-2"><button disabled={ocupado || finalizada} onClick={abrirIncidencia} className={secundario}>Registrar incidencia</button><button disabled={ocupado} onClick={() => setPantalla(pantalla === 'incidencias' ? 'avance' : 'incidencias')} className={secundario}>{pantalla === 'incidencias' ? 'Volver al avance' : `Incidencias (${pendientes.length} pendientes)`}</button><button disabled={ocupado} onClick={onSalir} className={secundario}>Cancelar</button></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{aviso && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{aviso}</p>}
    {orden.estatus_obra === 'incidencia' && !orden.incidencias.length && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Esta orden conserva una incidencia anterior sin detalle. Regístrala y documenta su resolución antes de finalizar.</p>}
    {!finalizada && (!orden.iniciada_at || !orden.fecha_programada || orden.postergada_at) && <form onSubmit={e => { e.preventDefault(); ejecutar(async () => actualizar(await post('iniciar', { fecha_programada: new Date(fecha).toISOString() }))) }} className="space-y-3 rounded-xl border bg-white p-5">{orden.postergada_at && <p className="text-sm text-amber-800">Postergada: {orden.motivo_postergacion}</p>}{orden.iniciada_at && !orden.fecha_programada && <p className="text-sm text-amber-800">Esta orden ya tiene avances, pero falta registrar la fecha programada. Complétala aquí para continuar; tus actividades y fotografías se conservan.</p>}<label className="block text-sm font-semibold">Fecha y hora programada<input type="datetime-local" required value={fecha} onChange={e => setFecha(e.target.value)} className="mt-1 block max-w-full rounded-lg border p-2"/></label><div className="flex justify-end"><button disabled={ocupado} className={principal}>{orden.postergada_at ? 'Reanudar instalación' : orden.iniciada_at ? 'Registrar fecha y continuar' : 'Iniciar instalación'}</button></div></form>}
    {pantalla === 'incidencia' && <form onSubmit={registrarIncidencia} className="space-y-4 rounded-xl border bg-white p-5">
      <h3 className="text-xl font-semibold">Registrar incidencia</h3>
      <label className="block text-sm">Etapa<select value={incidencia.parte} onChange={e => setIncidencia({ ...incidencia, parte: Number(e.target.value), actividad_codigo: '', fotos: [] })} className="mt-1 w-full rounded border p-2">{PARTES_INSTALACION.map((p, i) => <option key={p} value={i + 1}>{p}</option>)}</select></label>
      <label className="block text-sm">Actividad relacionada (opcional)<select value={incidencia.actividad_codigo} onChange={e => setIncidencia({ ...incidencia, actividad_codigo: e.target.value })} className="mt-1 w-full rounded border p-2"><option value="">Toda la etapa</option>{orden.actividades.filter(a => a.parte === incidencia.parte).map(a => <option key={a.codigo} value={a.codigo}>{a.titulo}</option>)}</select></label>
      <label className="block text-sm">Descripción<textarea required minLength={5} maxLength={2000} value={incidencia.descripcion} onChange={e => setIncidencia({ ...incidencia, descripcion: e.target.value })} className="mt-1 w-full rounded border p-2"/></label>
      <label className="block text-sm">Fecha de lo ocurrido (opcional)<input type="datetime-local" value={incidencia.fecha_ocurrencia} onChange={e => setIncidencia({ ...incidencia, fecha_ocurrencia: e.target.value })} className="mt-1 block max-w-full rounded border p-2"/><span className="text-xs text-slate-500">Si no la indicas, se registra la fecha y hora del servidor.</span></label>
      <SelectorFotos fotos={incidencia.fotos} onCambiar={f => { setIncidencia({ ...incidencia, fotos: f }); setOperacion(crypto.randomUUID()) }} actividades={orden.actividades.filter(a => a.parte === incidencia.parte)} disabled={ocupado}/>
      <p className="text-sm text-amber-800">Permanecerá pendiente hasta registrar su resolución y bloqueará la finalización.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setPantalla('avance')} disabled={ocupado} className={secundario}>Cancelar incidencia</button><button disabled={ocupado} className={principal}>Guardar incidencia</button></div>
    </form>}
    {pantalla === 'incidencias' && <section className="space-y-4 rounded-xl border bg-white p-5"><h3 className="text-xl font-semibold">Incidencias de la orden</h3>{!orden.incidencias.length && <p className="text-sm text-slate-500">No hay incidencias registradas.</p>}{orden.incidencias.map(i => <article key={i.id} className="space-y-2 rounded-lg border p-4">
      <p className="font-semibold">#{i.id} · {PARTES_INSTALACION[i.parte - 1]} · {i.estado === 'pendiente' ? 'Pendiente' : 'Resuelta'}</p><p className="whitespace-pre-wrap text-sm">{i.descripcion}</p><p className="text-xs text-slate-500">{fechaCompra(i.fecha_ocurrencia)} · Técnico #{i.tecnico_id}{i.actividad_codigo ? ` · ${orden.actividades.find(a => a.codigo === i.actividad_codigo)?.titulo || i.actividad_codigo}` : ''}</p>{i.resolucion && <p className="text-sm text-green-800">Resolución: {i.resolucion} · {fechaCompra(i.resuelta_at)}</p>}
      {i.estado === 'pendiente' && !finalizada && <div className="space-y-2"><label className="block text-sm">Cómo se resolvió<textarea maxLength={1000} value={resoluciones[i.id] || ''} onChange={e => setResoluciones({ ...resoluciones, [i.id]: e.target.value })} className="mt-1 w-full rounded border p-2"/></label><div className="flex justify-end"><button disabled={ocupado || (resoluciones[i.id] || '').trim().length < 5} onClick={() => ejecutar(async () => actualizar(await post(`incidencias/${i.id}/resolver`, { resolucion: resoluciones[i.id] })))} className={principal}>Marcar resuelta</button></div></div>}
      <div className="grid gap-3 sm:grid-cols-2">{orden.fotos.filter(f => f.incidencia_id === i.id).map(f => <FotoGuardada key={f.id} foto={f} ordenId={orden.id} token={token}/>)}</div>
    </article>)}</section>}
    {pantalla === 'avance' && <>
      <nav className="flex flex-wrap gap-2" aria-label="Partes de la instalación">{PARTES_INSTALACION.map((nombre, i) => <button key={nombre} disabled={ocupado || (i + 1 > orden.parte_actual && !finalizada)} onClick={() => { setParte(i + 1); setError(''); setOperacion(crypto.randomUUID()) }} aria-current={parte === i + 1 ? 'step' : undefined} className={`${parte === i + 1 ? 'bg-indigo-600 text-white' : 'border bg-white text-slate-600'} rounded-lg px-3 py-2 text-sm disabled:opacity-40`}>{i + 1}. {nombre}{orden.etapas[i].completa ? ' ✓' : ''}</button>)}</nav>
      <section className="space-y-4 rounded-xl border bg-white p-5"><h3 className="text-xl font-semibold">Parte {parte} de 3 · {PARTES_INSTALACION[parte - 1]}</h3>{actividadesParte.map(a => <article key={a.codigo} className="space-y-2 border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><label className="flex gap-3 text-sm font-semibold"><input type="checkbox" checked={a.completado} disabled={ocupado || !editable} onChange={e => cambiarActividad(a.codigo, 'completado', e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0"/>{a.titulo}</label><details className="text-xs text-indigo-700"><summary className="cursor-pointer font-semibold">Detalles</summary><p className="mt-2 max-w-md text-slate-600">{a.detalle}</p></details></div>
        <label className="block text-xs text-slate-500">Observación breve<input value={a.observaciones} maxLength={500} disabled={ocupado || !editable} onChange={e => cambiarActividad(a.codigo, 'observaciones', e.target.value)} className="mt-1 w-full rounded border p-2 text-sm text-slate-800"/></label>
      </article>)}</section>
      <section className="space-y-4 rounded-xl border bg-white p-5"><h3 className="font-semibold">Evidencia fotográfica · {PARTES_INSTALACION[parte - 1]}</h3><div className="grid gap-3 sm:grid-cols-2">{orden.fotos.filter(f => f.parte === parte).map(f => <FotoGuardada key={f.id} foto={f} ordenId={orden.id} token={token}/>)}</div>{!finalizada && <SelectorFotos fotos={fotos[parte]} onCambiar={f => { setFotos({ ...fotos, [parte]: f }); setOperacion(crypto.randomUUID()) }} actividades={actividadesParte} disabled={ocupado || !editable}/>}</section>
      {!finalizada && <>
        <p className="text-xs text-slate-500">Cancelar descarta lo que aún no has guardado. Volver a otra parte conserva lo escrito durante esta sesión; guarda un borrador antes de salir para retomarlo después.</p>
        {pendientes.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Resuelve las {pendientes.length} incidencia(s) pendiente(s) para finalizar la instalación.</p>}
        <div className="flex flex-wrap justify-end gap-2"><button disabled={ocupado || !editable} onClick={() => ejecutar(() => guardar(false))} className={secundario}>Guardar borrador</button>{parte < 3 ? <button disabled={ocupado || !editable} onClick={() => ejecutar(() => guardar(true))} className={principal}>Siguiente avance</button> : <button disabled={ocupado || !puedeFinalizar} onClick={guardarYFinalizar} className={principal}>Finalizar instalación</button>}</div>
        {parte === 3 && !puedeFinalizar && <p className="text-right text-xs text-slate-500">Para finalizar: completa las tres partes, guarda los cambios de partes anteriores, incluye una foto por parte y resuelve las incidencias pendientes.</p>}
        <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-600">Postergar instalación</summary><label className="mt-3 block text-sm">Motivo<textarea maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} className="mt-1 w-full rounded border p-2"/></label><div className="mt-3 flex justify-end"><button disabled={ocupado || motivo.trim().length < 5} onClick={() => ejecutar(async () => actualizar(await post('postergar', { motivo })))} className={secundario}>Confirmar postergación</button></div></details>
      </>}
    </>}
  </div>
}

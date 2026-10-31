import { useEffect, useState } from 'react'

export function SelectorFotos({ fotos, onCambiar, actividades = [], disabled }) {
  const [error, setError] = useState('')
  const seleccionar = async event => {
    setError('')
    const archivos = [...event.target.files]; event.target.value = ''
    if (archivos.length + fotos.length > 3) { setError('Puedes adjuntar hasta tres fotos por guardado.'); return }
    if (archivos.some(a => !['image/png', 'image/jpeg'].includes(a.type) || a.size > 5 * 1024 * 1024)) { setError('Selecciona fotos PNG o JPEG de máximo 5 MB.'); return }
    try {
      const nuevas = await Promise.all(archivos.map(archivo => new Promise((resolve, reject) => {
        const lector = new FileReader()
        lector.onload = () => resolve({ clave_carga: crypto.randomUUID(), imagen: lector.result, descripcion: '', actividad_codigo: '' })
        lector.onerror = () => reject(new Error('No se pudo leer una fotografía.'))
        lector.readAsDataURL(archivo)
      })))
      onCambiar([...fotos, ...nuevas])
    } catch (err) { setError(err.message) }
  }
  const editar = (i, clave, valor) => onCambiar(fotos.map((f, indice) => indice === i ? { ...f, [clave]: valor } : f))
  return <div className="space-y-3">
    <label className="block text-sm font-medium">Seleccionar fotografías<input type="file" accept="image/png,image/jpeg" multiple disabled={disabled} onChange={seleccionar} className="mt-2 block w-full text-sm"/></label>
    <p className="text-xs text-slate-500">PNG/JPEG, máximo 5 MB por foto y tres fotos por guardado. Se guardan al confirmar el avance o la incidencia. Cada parte requiere al menos una foto.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{fotos.map((f, i) => <div key={f.clave_carga} className="space-y-2 rounded-lg border p-3">
      <img src={f.imagen} alt={`Vista previa ${i + 1}`} className="h-36 w-full rounded object-contain"/>
      <label className="block text-xs">Descripción opcional<input disabled={disabled} value={f.descripcion} maxLength={500} onChange={e => editar(i, 'descripcion', e.target.value)} className="mt-1 w-full rounded border p-2"/></label>
      <label className="block text-xs">Actividad relacionada<select disabled={disabled} value={f.actividad_codigo} onChange={e => editar(i, 'actividad_codigo', e.target.value)} className="mt-1 w-full rounded border p-2"><option value="">Evidencia general de la etapa</option>{actividades.map(a => <option key={a.codigo} value={a.codigo}>{a.titulo}</option>)}</select></label>
      <button disabled={disabled} type="button" onClick={() => onCambiar(fotos.filter((_, indice) => indice !== i))} className="text-xs font-semibold text-red-700">Quitar foto sin guardar</button>
    </div>)}</div>
  </div>
}

export function FotoGuardada({ foto, ordenId, token }) {
  const [url, setUrl] = useState(''), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); let local
    fetch(`/api/instalaciones/${ordenId}/fotos/${foto.id}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error('No se pudo consultar la foto'); return r.blob() })
      .then(blob => { if (!controller.signal.aborted) { local = URL.createObjectURL(blob); setUrl(local) } })
      .catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => { controller.abort(); if (local) URL.revokeObjectURL(local) }
  }, [ordenId, foto.id, token])
  return <figure className="space-y-2 rounded-lg border bg-white p-3">{url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={foto.descripcion || `Evidencia guardada de la parte ${foto.parte}`} className="h-36 w-full rounded object-contain"/></a> : <p className="text-xs text-slate-500">{error || 'Cargando fotografía…'}</p>}<figcaption className="text-xs text-slate-600">{foto.descripcion || 'Sin descripción'}{foto.incidencia_id ? ` · Incidencia #${foto.incidencia_id}` : ''}<span className="block">{new Date(foto.created_at.replace(' ', 'T') + 'Z').toLocaleString('es-MX')} · Técnico #{foto.tecnico_id}</span></figcaption></figure>
}

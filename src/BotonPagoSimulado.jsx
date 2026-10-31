import { useEffect, useRef, useState } from 'react'
import { pedirCompra } from './compraApi.js'
import { pagoPruebaFrontend } from './pagoPrueba.js'

function esperar(signal) {
  return new Promise((resolve, reject) => {
    const cancelar = () => { clearTimeout(timer); reject(new DOMException('Prueba cancelada', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancelar); resolve() }, 5000)
    signal.addEventListener('abort', cancelar, { once: true })
  })
}

export default function BotonPagoSimulado({ orden, token, prospectoId, onActualizada }) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const bloqueado = useRef(false)
  const peticion = useRef(null)
  useEffect(() => () => peticion.current?.abort(), [])
  const simular = async () => {
    if (bloqueado.current) return
    bloqueado.current = true; setOcupado(true); setError('')
    const controller = new AbortController(); peticion.current = controller
    try {
      await esperar(controller.signal)
      await pedirCompra(token, `/api/portal/ordenes-pago/${orden.id}/simular`, {}, { signal: controller.signal })
      // El temporizador no cambia ningún dato de la cuenta: refrescar desde el servidor.
      const datos = await pedirCompra(token, `/api/portal/prospectos/${prospectoId}`, undefined, { signal: controller.signal })
      onActualizada(datos)
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      bloqueado.current = false
      if (!controller.signal.aborted) setOcupado(false)
    }
  }
  if (!pagoPruebaFrontend(import.meta.env) || !orden.permite_pago_simulado || orden.estado !== 'pendiente') return null
  return <div className="flex flex-col items-end gap-2 pt-2"><button type="button" aria-label="Simular pago (desarrollo)" aria-busy={ocupado} disabled={ocupado} onClick={simular} className={`h-5 w-5 shrink-0 rounded-full border border-indigo-300 bg-indigo-100 hover:bg-indigo-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60 ${ocupado ? 'animate-pulse' : ''}`}/><span role="status" className="sr-only">{ocupado ? 'Procesando durante cinco segundos y consultando al servidor' : ''}</span>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>
}

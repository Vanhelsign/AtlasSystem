import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ENFOCABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
// Modales abiertos, del más antiguo al más reciente: Escape y Tab solo afectan al de arriba.
const pilaModales = []

// Ventana emergente reutilizable. Se cierra con Escape, con clic fuera del panel o con el botón ✕,
// salvo mientras `ocupado` es verdadero. Si recibe `onEnviar`, el contenido funciona como formulario.
// Con `confirmarCierre`, cualquier intento de cierre pide confirmar antes de descartar los cambios.
// `acciones` puede ser una función que recibe { cerrar } para que sus botones usen el mismo cierre.
export default function Modal({
  titulo, descripcion, children, acciones, error, onCerrar, onEnviar, ocupado = false, ancho = 'max-w-lg',
  confirmarCierre = false, mensajeCambios = 'Tienes cambios sin guardar. Si cierras, se perderán.',
}) {
  const panel = useRef(null)
  const presionFuera = useRef(false)
  const idTitulo = useId()
  const [confirmandoCierre, setConfirmandoCierre] = useState(false)

  const intentarCerrar = () => {
    if (ocupado) return
    if (confirmarCierre) setConfirmandoCierre(true)
    else onCerrar()
  }
  const cerrarConTecla = useEffectEvent(() => intentarCerrar())

  useEffect(() => {
    const identificador = Symbol('modal')
    pilaModales.push(identificador)
    const enfocadoAntes = document.activeElement
    const inicial = panel.current.querySelector('[data-autofocus]') ?? panel.current.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
    ;(inicial ?? panel.current).focus()
    const desbordeAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const alPresionarTecla = (event) => {
      if (pilaModales[pilaModales.length - 1] !== identificador) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cerrarConTecla()
        return
      }
      if (event.key !== 'Tab') return
      // Mantiene el foco dentro del modal mientras está abierto.
      const enfocables = [...panel.current.querySelectorAll(ENFOCABLES)]
      if (!enfocables.length) return event.preventDefault()
      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]
      if (event.shiftKey && (document.activeElement === primero || document.activeElement === panel.current)) {
        event.preventDefault()
        ultimo.focus()
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alPresionarTecla)
    return () => {
      pilaModales.splice(pilaModales.indexOf(identificador), 1)
      document.removeEventListener('keydown', alPresionarTecla)
      document.body.style.overflow = desbordeAnterior
      enfocadoAntes?.focus?.()
    }
  }, [])

  const Contenedor = onEnviar ? 'form' : 'div'
  const propsContenedor = onEnviar ? { onSubmit: (event) => { event.preventDefault(); if (!ocupado) onEnviar() }, noValidate: true } : {}

  // Se monta en <body> para que los márgenes, el desbordamiento o el apilamiento de la página no lo afecten.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(event) => { presionFuera.current = event.target === event.currentTarget }}
      onClick={(event) => { if (presionFuera.current && event.target === event.currentTarget) intentarCerrar() }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1} className={`flex max-h-[90vh] w-full ${ancho} flex-col overflow-hidden rounded-xl bg-white shadow-xl outline-none`}>
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 id={idTitulo} className="text-lg font-semibold text-slate-900">{titulo}</h2>
            {descripcion && <p className="mt-1 text-sm text-slate-500">{descripcion}</p>}
          </div>
          <button type="button" onClick={intentarCerrar} disabled={ocupado} aria-label="Cerrar" className="rounded p-1 leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40">✕</button>
        </div>
        <Contenedor {...propsContenedor} className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-4 overflow-y-auto px-5 py-4">
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {children}
          </div>
          {acciones && <div className="flex flex-col-reverse gap-2 border-t bg-slate-50 px-5 py-3 sm:flex-row sm:justify-end">{typeof acciones === 'function' ? acciones({ cerrar: intentarCerrar }) : acciones}</div>}
        </Contenedor>
      </div>
      {confirmandoCierre && (
        <Modal
          titulo="¿Descartar los cambios?"
          onCerrar={() => setConfirmandoCierre(false)}
          acciones={<>
            <button type="button" data-autofocus onClick={() => setConfirmandoCierre(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">Seguir editando</button>
            <button type="button" onClick={() => { setConfirmandoCierre(false); onCerrar() }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Descartar y cerrar</button>
          </>}
        >
          <p className="text-sm text-slate-600">{mensajeCambios}</p>
        </Modal>
      )}
    </div>,
    document.body,
  )
}

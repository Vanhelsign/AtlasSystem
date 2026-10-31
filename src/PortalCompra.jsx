import { useRef, useState } from 'react'
import BotonPagoSimulado from './BotonPagoSimulado.jsx'
import { dineroCompra as dinero, fechaCompra as fecha, pedirCompra } from './compraApi.js'

const primario = 'rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50'
const secundario = 'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50'

export function BotonDocumento({ token, ruta, children, descargar = false, nombre = 'documento.pdf' }) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const abrir = async () => {
    setOcupado(true); setError('')
    const ventana = descargar ? null : window.open('about:blank', '_blank')
    if (ventana) ventana.opener = null
    try {
      const respuesta = await fetch(ruta, { headers: { Authorization: `Bearer ${token}` } })
      if (!respuesta.ok) throw new Error((await respuesta.json()).error || 'No se pudo obtener el documento')
      const url = URL.createObjectURL(await respuesta.blob())
      if (ventana) ventana.location.replace(url)
      else {
        const enlace = document.createElement('a'); enlace.href = url; enlace.download = nombre
        enlace.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) { ventana?.close(); setError(err.message) } finally { setOcupado(false) }
  }
  return <span className="inline-flex flex-col items-start gap-1"><button type="button" onClick={abrir} disabled={ocupado} className={secundario}>{ocupado ? 'Generando documento…' : children}</button>{error && <span role="alert" className="text-xs text-red-700">{error}</span>}</span>
}

function Pasos({ pago = false }) {
  return <div aria-label="Pasos de aceptación" className="grid grid-cols-2 gap-2 text-sm font-semibold"><div className={`rounded-lg border px-3 py-3 ${!pago ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'bg-white text-slate-500'}`}>Paso 1 de 2 · Firma</div><div className={`rounded-lg border px-3 py-3 ${pago ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'bg-white text-slate-500'}`}>Paso 2 de 2 · Pago</div></div>
}

function Conceptos({ cotizacion }) {
  return <div className="space-y-4"><div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2"><div><p className="text-xs text-slate-500">Folio de cotización</p><p className="font-bold">{cotizacion.folio}</p></div><div><p className="text-xs text-slate-500">Precio final de venta</p><p className="text-xl font-bold text-indigo-700">{dinero(cotizacion.precio_venta)} MXN</p></div></div><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="border-b bg-slate-50"><tr><th className="p-2 text-left">Concepto</th><th className="p-2">Cantidad</th><th className="p-2 text-right">Precio unitario</th><th className="p-2 text-right">Subtotal</th></tr></thead><tbody>{cotizacion.items.map((item, indice) => <tr key={`${item.producto_codigo}-${indice}`} className="border-b"><td className="p-2"><b>{item.tipo}</b><br/>{item.modelo}<span className="block text-xs text-slate-500">{item.clasificacion === 'servicio' ? 'Servicio' : 'Material físico'}</span></td><td className="p-2 text-center">{item.cantidad}</td><td className="p-2 text-right">{dinero(item.precio_unitario_venta, 6)}</td><td className="p-2 text-right font-semibold">{dinero(item.subtotal_venta)}</td></tr>)}</tbody></table></div><p className="text-right font-bold">Total: {dinero(cotizacion.precio_venta)} MXN</p><p className="text-xs text-slate-500">{cotizacion.nota_precios}</p></div>
}

export function FirmarCotizacion({ cotizacion, token, onFirmada, onVolver }) {
  const canvas = useRef(null)
  const trazo = useRef({ dibujando: false, puntos: 0 })
  const [nombre, setNombre] = useState('')
  const [firma, setFirma] = useState(false)
  const [conforme, setConforme] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const posicion = (event) => {
    const rect = canvas.current.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * canvas.current.width / rect.width, y: (event.clientY - rect.top) * canvas.current.height / rect.height }
  }
  const comenzar = (event) => {
    if (ocupado) return
    event.preventDefault(); canvas.current.setPointerCapture(event.pointerId)
    trazo.current.dibujando = true
    const { x, y } = posicion(event), ctx = canvas.current.getContext('2d')
    ctx.beginPath(); ctx.moveTo(x, y); ctx.strokeStyle = '#18213a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  }
  const dibujar = (event) => {
    if (!trazo.current.dibujando || ocupado) return
    const { x, y } = posicion(event), ctx = canvas.current.getContext('2d')
    ctx.lineTo(x, y); ctx.stroke(); trazo.current.puntos++
  }
  const terminar = () => { trazo.current.dibujando = false; setFirma(trazo.current.puntos >= 3) }
  const limpiar = () => { canvas.current.getContext('2d').clearRect(0, 0, 760, 240); trazo.current = { dibujando: false, puntos: 0 }; setFirma(false) }
  const aceptar = async (event) => {
    event.preventDefault(); setOcupado(true); setError('')
    try {
      const datos = await pedirCompra(token, `/api/portal/cotizaciones/${cotizacion.id}/firmar`, { nombre, conforme, firma: canvas.current.toDataURL('image/png') })
      onFirmada(datos.cotizacion)
    } catch (err) { setError(err.message) } finally { setOcupado(false) }
  }
  if (!cotizacion || cotizacion.firmada) return <div className="p-6"><p className="mb-4">Esta cotización ya fue aceptada o no está disponible.</p><button onClick={onVolver} className={secundario}>Volver a Inicio</button></div>
  return <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6"><div><h1 className="text-2xl font-bold">Aceptar y firmar cotización</h1><p className="mt-1 text-sm text-slate-500">Revisa la propuesta completa antes de dejar constancia de tu aceptación.</p></div><Pasos/><div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]"><section className="min-w-0 space-y-5 rounded-xl border bg-white p-4 sm:p-5"><h2 className="font-bold">Propuesta económica</h2><Conceptos cotizacion={cotizacion}/><BotonDocumento token={token} ruta={`/api/cotizaciones/${cotizacion.id}/pdf`}>Ver cotización en PDF</BotonDocumento><p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">La firma acepta esta propuesta y genera la orden de pago. La compra se confirma al verificar el pago.</p></section><form onSubmit={aceptar} className="space-y-4 rounded-xl border bg-white p-5"><h2 className="font-bold">Firma del prospecto</h2><label className="block text-sm font-medium">Nombre completo<input required minLength={3} maxLength={180} value={nombre} onChange={(event) => setNombre(event.target.value)} disabled={ocupado} className="mt-1 w-full rounded-lg border px-3 py-2" autoComplete="name"/></label><div><p id="firma-etiqueta" className="mb-2 text-sm font-medium">Traza tu firma</p><canvas ref={canvas} width="760" height="240" aria-labelledby="firma-etiqueta" aria-describedby="firma-ayuda" onPointerDown={comenzar} onPointerMove={dibujar} onPointerUp={terminar} onPointerCancel={terminar} className="w-full touch-none rounded-lg border-2 border-dashed bg-slate-50"/><p id="firma-ayuda" className="mt-1 text-xs text-slate-500">Firma con el ratón, lápiz o dedo dentro del recuadro.</p></div><button type="button" disabled={ocupado} onClick={limpiar} className={secundario}>Limpiar firma</button><label className="flex gap-3 text-sm"><input type="checkbox" checked={conforme} onChange={(event) => setConforme(event.target.checked)} disabled={ocupado} className="mt-1 h-4 w-4 shrink-0"/><span>{cotizacion.conformidad}</span></label><p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Firmar no registra un pago. Recibirás la orden para realizarlo.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<button disabled={ocupado || !firma || !conforme || nombre.trim().length < 3} className={`${primario} w-full`}>{ocupado ? 'Guardando aceptación…' : 'Firmar y aceptar'}</button><button type="button" disabled={ocupado} onClick={onVolver} className={`${secundario} w-full`}>Volver a Inicio</button><p className="text-xs text-slate-500">Se registran fecha y hora del servidor y metadatos técnicos de la aceptación.</p></form></div></div>
}

export function OrdenPago({ cotizacion, token, onVolver }) {
  const orden = cotizacion?.orden_pago
  if (!orden) return <p className="p-6">Todavía no hay una orden de pago para esta cotización.</p>
  return <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6"><div><h1 className="text-2xl font-bold">Orden de pago</h1><p className="mt-1 text-sm text-slate-500">Tu cotización fue aceptada. Consulta el importe y la fecha límite.</p></div><Pasos pago/><AvisoPagoSimulado orden={orden}/><section className="space-y-5 rounded-xl border bg-white p-5 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{orden.folio}</h2><span className={`rounded-full px-3 py-1 text-sm font-semibold ${orden.estado === 'pagada' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>{orden.pago_simulado ? 'Pago simulado (prueba)' : orden.estado === 'pagada' ? 'Pago confirmado' : orden.estado === 'vencida' ? 'Pago vencido' : 'Pendiente de pago'}</span></div><dl className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-3"><Dato nombre="Cotización aceptada" valor={cotizacion.folio}/><Dato nombre="Importe total" valor={`${dinero(orden.importe)} MXN`}/><Dato nombre="Fecha límite" valor={fecha(orden.limite_at)}/></dl><div><h3 className="font-bold">Datos para realizar el pago</h3><DatosBancarios datos={orden.datos_pago}/><p className={`mt-2 whitespace-pre-wrap rounded-lg p-4 text-sm ${orden.instrucciones_pendientes ? 'bg-amber-50 text-amber-900' : 'bg-slate-50'}`}>{orden.instrucciones || (orden.instrucciones_pendientes ? 'Instrucciones de pago pendientes. Contacta a tu agente antes de transferir dinero.' : 'Utiliza los datos de cobro y la referencia indicados en esta orden.')}</p><p className="mt-2 text-sm">Concepto para identificar tu pago: <b>{orden.folio}</b></p></div>{orden.estado === 'vencida' && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">El plazo venció. Contacta a tu agente antes de pagar. La orden conserva su historial y sigue pendiente de verificación administrativa.</p>}<p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">Conserva tu comprobante. El estado de la compra cambiará cuando ATLAS confirme el pago.</p><div className="flex flex-wrap gap-3"><BotonDocumento descargar nombre={`${orden.folio}.pdf`} token={token} ruta={`/api/portal/ordenes-pago/${orden.id}/pdf`}>Descargar orden</BotonDocumento><BotonDocumento token={token} ruta={`/api/cotizaciones/${cotizacion.id}/pdf`}>Ver cotización firmada</BotonDocumento><BotonDocumento descargar nombre={`${cotizacion.folio}-firmada.pdf`} token={token} ruta={`/api/cotizaciones/${cotizacion.id}/pdf`}>Descargar cotización firmada</BotonDocumento><button onClick={onVolver} className={primario}>Volver a Inicio</button></div><p className="text-xs text-slate-500">La emisión de esta orden no es comprobante de un pago realizado.</p></section></div>
}

export function ResumenEstadoCompra({ cotizacion, token, onOrden, onInstalacion, prospectoId, onActualizada }) {
  const orden = cotizacion.orden_pago
  const pagada = orden.estado === 'pagada'
  return <section className="space-y-5">
    <div className={`rounded-xl border p-5 ${pagada ? 'border-green-200 bg-green-50 text-green-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <h2 className="text-xl font-bold">{pagada ? 'Compra confirmada' : orden.estado === 'vencida' ? 'Pago vencido' : 'Pago pendiente'}</h2>
      <p className="mt-2 text-sm">{pagada ? 'Tu compra quedó confirmada. Tu cuenta ahora es Cliente y tu proyecto puede continuar hacia la instalación.' : 'Tu firma quedó registrada. La compra está pendiente de la verificación del pago.'}</p>
    </div>
    <div className="space-y-5 rounded-xl border bg-white p-5">
      <h3 className="font-bold">Resumen de la compra</h3>
      <dl className="grid gap-4 sm:grid-cols-3"><Dato nombre="Cotización firmada" valor={cotizacion.folio}/><Dato nombre="Orden de pago" valor={orden.folio}/><Dato nombre="Importe" valor={`${dinero(orden.importe)} MXN`}/><Dato nombre={pagada ? 'Confirmado el' : 'Fecha límite'} valor={fecha(pagada ? orden.confirmada_at : orden.limite_at)}/></dl>
      {!pagada && <div className="flex flex-wrap gap-3"><button onClick={onOrden} className={primario}>Consultar orden de pago</button><BotonDocumento token={token} ruta={`/api/cotizaciones/${cotizacion.id}/pdf`}>Ver cotización firmada</BotonDocumento><BotonDocumento descargar nombre={`${cotizacion.folio}-firmada.pdf`} token={token} ruta={`/api/cotizaciones/${cotizacion.id}/pdf`}>Descargar cotización firmada</BotonDocumento></div>}
      {pagada ? <div className="rounded-lg bg-indigo-50 p-4 text-sm text-indigo-900"><p>Se generó la orden de instalación <b>{cotizacion.instalacion?.folio}</b>. {cotizacion.instalacion?.tecnico_nombre ? `Técnico responsable: ${cotizacion.instalacion.tecnico_nombre}.` : "Técnico pendiente de asignación."} {cotizacion.instalacion?.iniciada_at ? `Instalación iniciada: ${fecha(cotizacion.instalacion.iniciada_at)}.` : "Pendiente de iniciar y programar visita."}</p><button onClick={onInstalacion} className={`${primario} mt-3`}>Consultar mi instalación</button></div> : <p className="text-sm text-slate-500">Tu cuenta permanece como Prospecto. La orden de instalación se generará después de confirmar el pago.{orden.estado === 'vencida' ? ' Contacta a tu agente antes de pagar.' : ''}</p>}
      <BotonPagoSimulado orden={orden} token={token} prospectoId={prospectoId} onActualizada={onActualizada}/>
    </div>
  </section>
}

function AvisoPagoSimulado({ orden }) {
  return orden.pago_simulado ? <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Pago simulado · Prueba de desarrollo. No se recibió dinero ni se verificó una transferencia bancaria.</p> : null
}

function DatosBancarios({ datos }) {
  if (!datos) return null
  const etiquetas = { beneficiario: 'Beneficiario', banco: 'Banco', clabe: 'CLABE', cuenta: 'Cuenta', referencia: 'Referencia' }
  return <dl className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">{Object.entries(etiquetas).filter(([campo]) => datos[campo]).map(([campo, nombre]) => <Dato key={campo} nombre={nombre} valor={datos[campo]}/>)}</dl>
}

function Dato({ nombre, valor }) { return <div><dt className="text-xs text-slate-500">{nombre}</dt><dd className="mt-1 break-words font-semibold">{valor}</dd></div> }

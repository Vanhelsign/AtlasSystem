import { Buffer } from 'node:buffer'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const A4 = [595.28, 841.89]
const MARGEN = 42, ANCHO = A4[0] - MARGEN * 2
const C = {
  violeta: rgb(0.31, 0.23, 0.88), tinta: rgb(0.11, 0.14, 0.22), gris: rgb(0.40, 0.44, 0.51),
  linea: rgb(0.86, 0.88, 0.92), fondo: rgb(0.96, 0.97, 0.99), lila: rgb(0.94, 0.93, 1),
  ambar: rgb(0.48, 0.31, 0.08), crema: rgb(1, 0.97, 0.87), blanco: rgb(1, 1, 1),
}
const dinero = (valor, max = 2) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: max }).format(valor)
const textoPdf = (valor) => String(valor ?? '').normalize('NFC').replace(/\s/g, ' ').replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '?')
const fecha = (valor) => {
  if (!valor) return 'No registrada'
  const date = new Date(valor.includes('T') ? valor : `${valor.replace(' ', 'T')}Z`)
  return Number.isFinite(date.getTime()) ? `${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC` : textoPdf(valor)
}

async function documento(titulo, folio, fechaEmision, clase) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${titulo} ${folio}`); pdf.setAuthor('ATLAS CRM'); pdf.setSubject(clase)
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  let pagina, y
  function escribir(texto, x, posY, size = 9, fuerte = false, color = C.tinta) {
    pagina.drawText(textoPdf(texto), { x, y: posY, size, font: fuerte ? bold : font, color })
  }
  function envolver(texto, ancho, size = 9, fuerte = false) {
    const fuente = fuerte ? bold : font, lineas = []
    let actual = ''
    for (const palabra of textoPdf(texto).split(' ')) {
      if (!palabra) continue
      let trozo = ''
      for (const letra of palabra) {
        if (fuente.widthOfTextAtSize(trozo + letra, size) > ancho && trozo) {
          if (actual) { lineas.push(actual); actual = '' }
          lineas.push(trozo); trozo = letra
        } else trozo += letra
      }
      const intento = actual ? `${actual} ${trozo}` : trozo
      if (fuente.widthOfTextAtSize(intento, size) > ancho && actual) { lineas.push(actual); actual = trozo } else actual = intento
    }
    if (actual) lineas.push(actual)
    return lineas.length ? lineas : ['']
  }
  function nuevaPagina() {
    pagina = pdf.addPage(A4)
    pagina.drawRectangle({ x: 0, y: A4[1] - 9, width: A4[0], height: 9, color: C.violeta })
    escribir('ATLAS CRM', MARGEN, 794, 22, true, C.violeta)
    escribir('SOLUCIONES DE ENERGÍA SOLAR', MARGEN, 778, 7.5, true, C.gris)
    escribir(clase.toUpperCase(), 359, 802, 8, true, C.gris)
    envolver(folio, 193, 9, true).forEach((linea, i) => escribir(linea, 359, 786 - i * 12, 9, true, C.violeta))
    pagina.drawLine({ start: { x: MARGEN, y: 758 }, end: { x: A4[0] - MARGEN, y: 758 }, thickness: 0.7, color: C.linea })
    escribir(titulo, MARGEN, 733, 20, true)
    escribir(`Emisión: ${fecha(fechaEmision)}`, MARGEN, 715, 8, false, C.gris)
    y = 690
  }
  const espacio = (alto) => { if (y - alto < 58) nuevaPagina() }
  function parrafo(texto, { size = 9, fuerte = false, color = C.tinta, sangria = 0, despues = 7 } = {}) {
    for (const linea of envolver(texto, ANCHO - sangria, size, fuerte)) {
      espacio(size + 5); escribir(linea, MARGEN + sangria, y, size, fuerte, color); y -= size + 5
    }
    y -= despues
  }
  function seccion(texto) {
    espacio(52); y -= 5; escribir(texto, MARGEN, y, 10, true, C.violeta); y -= 18
  }
  function campos(pares) {
    const col = (ANCHO - 20) / 2
    for (let i = 0; i < pares.length; i += 2) {
      const fila = pares.slice(i, i + 2).map(([etiqueta, valor]) => ({ etiqueta, lineas: envolver(valor || 'No registrado', col - 24, 9) }))
      const alto = Math.max(...fila.map((item) => item.lineas.length)) * 13 + 32
      if (alto > 180) {
        for (const [etiqueta, valor] of pares.slice(i, i + 2)) { parrafo(etiqueta, { size: 8, fuerte: true, color: C.gris, despues: 0 }); parrafo(valor || 'No registrado') }
        continue
      }
      espacio(alto + 8)
      fila.forEach((item, indice) => {
        const x = MARGEN + indice * (col + 20)
        pagina.drawRectangle({ x, y: y - alto + 5, width: col, height: alto, color: C.fondo })
        escribir(item.etiqueta.toUpperCase(), x + 12, y - 9, 7.5, true, C.gris)
        item.lineas.forEach((linea, j) => escribir(linea, x + 12, y - 25 - j * 13, 9))
      })
      y -= alto + 6
    }
    y -= 5
  }
  function aviso(texto, ambar = false) {
    const lineas = envolver(texto, ANCHO - 26, 9)
    for (let offset = 0; offset < lineas.length; offset += 12) {
      const grupo = lineas.slice(offset, offset + 12), alto = grupo.length * 14 + 22
      espacio(alto + 9)
      pagina.drawRectangle({ x: MARGEN, y: y - alto + 9, width: ANCHO, height: alto, color: ambar ? C.crema : C.lila })
      grupo.forEach((linea, indice) => escribir(linea, MARGEN + 13, y - 6 - indice * 14, 9, false, ambar ? C.ambar : C.tinta))
      y -= alto + 6
    }
  }
  function tabla(items) {
    const anchos = [257, 40, 110, ANCHO - 407]
    const posiciones = anchos.map((_, i) => MARGEN + anchos.slice(0, i).reduce((a, b) => a + b, 0))
    function cabecera() {
      espacio(40)
      pagina.drawRectangle({ x: MARGEN, y: y - 18, width: ANCHO, height: 26, color: C.violeta })
      ;['Material o servicio', 'Cant.', 'Precio unitario', 'Subtotal'].forEach((nombre, i) => escribir(nombre, posiciones[i] + 8, y - 8, 8, true, C.blanco))
      y -= 27
    }
    cabecera()
    for (const [indice, item] of items.entries()) {
      const celdas = [`${item.tipo} · ${item.modelo} (${item.clasificacion === 'servicio' ? 'Servicio' : 'Material'})`, String(item.cantidad), dinero(item.precio_unitario_venta, 6), dinero(item.subtotal_venta)]
        .map((valor, i) => envolver(valor, anchos[i] - 16, 8.5, i === 3))
      const cantidadLineas = Math.max(...celdas.map((celda) => celda.length))
      let desde = 0
      while (desde < cantidadLineas) {
        if (y < 96) { nuevaPagina(); cabecera() }
        const disponibles = Math.max(1, Math.floor((y - 78) / 12))
        const usadas = Math.min(cantidadLineas - desde, disponibles), alto = usadas * 12 + 16
        pagina.drawRectangle({ x: MARGEN, y: y - alto, width: ANCHO, height: alto, color: indice % 2 ? C.blanco : C.fondo })
        celdas.forEach((lineas, columna) => lineas.slice(desde, desde + usadas).forEach((linea, j) => {
          const fuente = columna === 3 ? bold : font
          const x = columna >= 2 ? posiciones[columna] + anchos[columna] - 8 - fuente.widthOfTextAtSize(linea, 8.5) : posiciones[columna] + 8
          escribir(linea, x, y - 13 - j * 12, 8.5, columna === 3)
        }))
        y -= alto
        pagina.drawLine({ start: { x: MARGEN, y }, end: { x: MARGEN + ANCHO, y }, thickness: 0.4, color: C.linea })
        desde += usadas
        if (desde < cantidadLineas) { nuevaPagina(); cabecera() }
      }
    }
    y -= 13
  }
  function total(importe, moneda = 'MXN', grande = false) {
    const alto = grande ? 94 : 61
    espacio(alto + 16)
    pagina.drawRectangle({ x: MARGEN, y: y - alto, width: ANCHO, height: alto, color: C.violeta })
    escribir(grande ? 'IMPORTE TOTAL A PAGAR' : 'TOTAL FINAL DE LA PROPUESTA', MARGEN + 17, y - 20, 8, true, C.blanco)
    escribir(`${dinero(importe)} ${moneda}`, MARGEN + 17, y - (grande ? 59 : 44), grande ? 28 : 20, true, C.blanco)
    y -= alto + 20
  }
  async function firmaRegistrada(firma, cotizacion) {
    espacio(250); seccion('Conformidad y firma registrada')
    parrafo(`Esta aceptación corresponde a ${cotizacion.folio}, versión ${cotizacion.version}.`, { fuerte: true })
    parrafo(`Nombre del firmante: ${firma.nombre_firmante || 'No registrado en la aceptación anterior'}`)
    parrafo(`Fecha y hora registradas por el servidor: ${fecha(firma.firmada_at)}`)
    const png = await pdf.embedPng(Buffer.from(firma.firma_png_b64, 'base64'))
    const escala = Math.min((ANCHO - 36) / png.width, 82 / png.height)
    espacio(130)
    pagina.drawRectangle({ x: MARGEN, y: y - 100, width: ANCHO, height: 100, color: C.fondo, borderColor: C.linea, borderWidth: 0.6 })
    pagina.drawImage(png, { x: MARGEN + 18, y: y - 90, width: png.width * escala, height: png.height * escala })
    y -= 119
    if (firma.snapshot_sha256) parrafo(`Huella SHA-256 de la propuesta aceptada: ${firma.snapshot_sha256}`, { size: 7.5, color: C.gris })
    parrafo('Aceptación registrada por el titular de la cuenta autenticada en ATLAS. Firma trazada; no corresponde a una firma con certificado digital.', { size: 8, color: C.gris })
  }
  function talon(orden) {
    const referencia = orden.datos_pago?.referencia
    const identificacion = referencia ? `${orden.folio} · ${referencia}` : orden.folio
    const lineas = envolver(identificacion, (ANCHO - 20) / 2 - 24, 9).length
    espacio(100 + lineas * 13); y -= 10
    for (let x = MARGEN; x < MARGEN + ANCHO; x += 8) pagina.drawLine({ start: { x, y }, end: { x: Math.min(x + 4, MARGEN + ANCHO), y }, thickness: 0.7, color: C.gris })
    y -= 25
    parrafo('TALÓN DE REFERENCIA · ORDEN PARA PAGAR', { fuerte: true, size: 9, color: C.violeta })
    campos([['Folio / referencia de pago', identificacion], ['Importe', `${dinero(orden.importe)} ${orden.moneda}`]])
  }
  function finalizar() {
    const paginas = pdf.getPages()
    paginas.forEach((p, i) => {
      p.drawLine({ start: { x: MARGEN, y: 42 }, end: { x: MARGEN + ANCHO, y: 42 }, thickness: 0.5, color: C.linea })
      p.drawText(textoPdf(`ATLAS CRM · ${folio}`), { x: MARGEN, y: 27, size: 7, font, color: C.gris })
      p.drawText(`${i + 1} / ${paginas.length}`, { x: A4[0] - MARGEN - 30, y: 27, size: 7, font, color: C.gris })
    })
    return pdf.save()
  }
  nuevaPagina()
  return { parrafo, seccion, campos, aviso, tabla, total, firmaRegistrada, talon, finalizar }
}

export async function generarCotizacionPdf(cotizacion, firma) {
  const doc = await documento(firma ? 'Cotización aceptada' : 'Cotización', cotizacion.folio, cotizacion.emitida_at, 'Propuesta económica')
  doc.seccion('Datos del prospecto')
  doc.campos([['Nombre', cotizacion.destinatario.nombre], ['Folio y versión', `${cotizacion.folio} · V${cotizacion.version}`], ['Correo electrónico', cotizacion.destinatario.email], ['Teléfono', cotizacion.destinatario.telefono]])
  if (cotizacion.direccion) doc.parrafo(`Ubicación del proyecto: ${cotizacion.direccion}`)
  doc.seccion('Resumen del proyecto')
  const materiales = cotizacion.items.filter((item) => item.clasificacion === 'material'), servicios = cotizacion.items.filter((item) => item.clasificacion === 'servicio')
  doc.parrafo(`Propuesta de ${materiales.length} conceptos de materiales y ${servicios.length} ${servicios.length === 1 ? 'concepto de servicio' : 'conceptos de servicios'}, según el desglose aprobado.`)
  const proyecto = cotizacion.proyecto
  if (proyecto?.consumo_mensual_kwh != null) doc.parrafo(`Consumo mensual estimado: ${proyecto.consumo_mensual_kwh} kWh/mes${proyecto.consumo_objetivo_kwh != null ? ` · Consumo objetivo: ${proyecto.consumo_objetivo_kwh} kWh/mes` : ''}.`)
  doc.seccion('Desglose de materiales y servicios · Precios de venta en MXN')
  doc.tabla(cotizacion.items); doc.total(cotizacion.precio_venta)
  doc.parrafo(cotizacion.nota_precios || 'Importes correspondientes a la versión aprobada.', { size: 8, color: C.gris })
  // Este flujo no persiste importes fiscales desglosados: no se inventa IVA.
  doc.seccion('Alcance e inclusiones')
  doc.parrafo('La propuesta comprende exclusivamente los materiales, servicios y cantidades del desglose anterior.')
  for (const servicio of servicios) doc.parrafo(`Servicio incluido: ${servicio.cantidad} × ${servicio.modelo}.`)
  if (!servicios.length) doc.parrafo('No se registraron servicios adicionales en esta versión de la propuesta.')
  if (cotizacion.notas) { doc.seccion('Notas de la propuesta'); doc.parrafo(cotizacion.notas) }
  doc.seccion('Condiciones y conformidad'); doc.parrafo(cotizacion.conformidad)
  doc.aviso('La aceptación genera una orden de pago. La confirmación del pago permite continuar con la orden de instalación; no establece una fecha de instalación.')
  if (firma) await doc.firmaRegistrada(firma, cotizacion)
  return doc.finalizar()
}

export async function generarOrdenPdf(cotizacion) {
  const orden = cotizacion.orden_pago
  const doc = await documento('Orden de pago', orden.folio, orden.emitida_at, 'Boleta para pagar')
  if (orden.pago_simulado) doc.parrafo('PAGO SIMULADO · PRUEBA DE DESARROLLO. No se recibió dinero ni se verificó una transferencia.', { size: 8, fuerte: true, color: C.ambar })
  doc.parrafo(`ESTATUS: ${orden.pago_simulado ? 'Simulado' : orden.estado === 'pagada' ? 'Confirmado administrativamente' : orden.estado === 'vencida' ? 'Vencido' : 'Pendiente de pago'}`, { fuerte: true, color: C.violeta })
  doc.total(orden.importe, orden.moneda, true)
  doc.campos([['Titular', cotizacion.destinatario.nombre], ['Cotización relacionada', cotizacion.folio], ['Fecha de emisión', fecha(orden.emitida_at)], ['Fecha límite de pago', fecha(orden.limite_at)]])
  doc.parrafo(`Concepto del pago: cotización aceptada ${cotizacion.folio}.`, { fuerte: true })
  doc.seccion('Datos para realizar el pago')
  const bancarios = orden.datos_pago || {}, etiquetas = { beneficiario: 'Beneficiario', banco: 'Banco', clabe: 'CLABE', cuenta: 'Cuenta', referencia: 'Referencia configurada' }
  const campos = Object.entries(etiquetas).filter(([clave]) => bancarios[clave]).map(([clave, etiqueta]) => [etiqueta, bancarios[clave]])
  if (campos.length) doc.campos(campos)
  if (orden.instrucciones_pendientes) doc.aviso('Instrucciones de pago pendientes. Contacta a tu agente antes de transferir dinero.', true)
  if (orden.instrucciones) doc.aviso(orden.instrucciones)
  doc.parrafo(`Referencia de la orden: ${bancarios.referencia || orden.folio}`, { fuerte: true })
  if (orden.estado === 'vencida') doc.aviso('El plazo de esta orden venció. Contacta a tu agente antes de realizar el pago.', true)
  doc.parrafo('Conserva el comprobante de tu operación e identifica el pago con la referencia indicada. ATLAS actualizará tu compra después de verificar el pago recibido.')
  if (orden.confirmada_at) doc.parrafo(`${orden.pago_simulado ? 'Simulación registrada' : 'Confirmación administrativa registrada'}: ${fecha(orden.confirmada_at)}.`, { size: 8 })
  doc.aviso('Esta orden no es un comprobante de pago realizado', true)
  doc.talon(orden)
  return doc.finalizar()
}

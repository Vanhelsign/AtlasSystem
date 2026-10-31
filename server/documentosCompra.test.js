import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { PDFDocument, decodePDFRawStream } from 'pdf-lib'
import { PNG } from 'pngjs'
import { generarCotizacionPdf, generarOrdenPdf } from './documentosCompra.js'

const ejemplo = () => ({
  folio: 'COT-000020-V1', version: 1, emitida_at: '2026-10-29 12:00:00', precio_venta: 20000,
  destinatario: { nombre: 'Persona de prueba', email: 'prueba@ejemplo.invalid', telefono: '8100000000' },
  direccion: 'Dirección registrada de prueba', conformidad: 'Acepto los conceptos y el precio final de esta propuesta.',
  items: [{ tipo: 'Panel', modelo: 'MODELO-PANEL', clasificacion: 'material', cantidad: 4, precio_unitario_venta: 3000, subtotal_venta: 12000 },
    { tipo: 'Mano de obra', modelo: 'SERVICIO-INSTALACION', clasificacion: 'servicio', cantidad: 1, precio_unitario_venta: 8000, subtotal_venta: 8000 }],
  orden_pago: { folio: 'PAG-20-REFERENCIA', importe: 20000, moneda: 'MXN', emitida_at: '2026-10-29 12:05:00', limite_at: '2026-11-05 12:05:00', estado: 'pendiente', instrucciones_pendientes: true },
})
function textoPaginas(doc) {
  return doc.getPages().map((pagina) => {
    const contenidos = pagina.node.Contents()
    return contenidos.asArray().map((ref) => {
      const crudo = Buffer.from(decodePDFRawStream(doc.context.lookup(ref)).decode()).toString('latin1')
      return [...crudo.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('\n')
    }).join('\n')
  })
}
function firmaEjemplo() {
  const png = new PNG({ width: 400, height: 150 })
  return { firma_png_b64: PNG.sync.write(png).toString('base64'), nombre_firmante: 'Firmante de prueba', firmada_at: '2026-10-29 12:05:00', snapshot_sha256: 'a'.repeat(64) }
}

test('cotización formal A4 con materiales, servicios, precios y aceptación; sin IVA inventado ni impresión del navegador', async () => {
  const doc = await PDFDocument.load(await generarCotizacionPdf(ejemplo(), firmaEjemplo()))
  const paginas = textoPaginas(doc), texto = paginas.join('\n')
  assert.match(doc.getTitle(), /Cotización aceptada/)
  assert.match(texto, /MODELO-PANEL/); assert.match(texto, /SERVICIO-INSTALACION/)
  assert.match(texto, /20,000\.00/); assert.match(texto, /Firmante de prueba/); assert.match(texto, /2026.*UTC/)
  assert.doesNotMatch(texto, /localhost|IVA|window\.print/)
  assert.ok(doc.getPages().every((p) => p.getWidth() === 595.28 && p.getHeight() === 841.89))
  assert.ok(paginas.every((p) => p.split('\n').length > 12))
})

test('tabla multipágina conserva todos los conceptos y notas largas sin páginas vacías', async () => {
  const datos = ejemplo()
  datos.items = Array.from({ length: 90 }, (_, i) => ({ ...datos.items[i % 2], modelo: `ITEM-${String(i).padStart(3, '0')} ${'Modelo largo con datos de la propuesta '.repeat(7)}` }))
  datos.notas = 'Nota registrada extensa. '.repeat(150)
  const doc = await PDFDocument.load(await generarCotizacionPdf(datos, firmaEjemplo()))
  const paginas = textoPaginas(doc), todo = paginas.join('\n')
  for (let i = 0; i < 90; i++) assert.ok(todo.includes(`ITEM-${String(i).padStart(3, '0')}`))
  assert.ok(doc.getPageCount() > 3)
  assert.ok(paginas.every((p) => p.split('\n').length > 12))
})

test('orden diferenciada con talón, datos configurados o aviso pendiente, sin QR ni cuentas inventadas', async () => {
  const pendiente = textoPaginas(await PDFDocument.load(await generarOrdenPdf(ejemplo()))).join('\n')
  assert.match(pendiente, /Instrucciones de pago pendientes/)
  assert.match(pendiente, /Esta orden no es un comprobante de pago realizado/)
  assert.match(pendiente, /PAG-20-REFERENCIA/); assert.match(pendiente, /20,000\.00/)
  assert.doesNotMatch(pendiente, /Beneficiario|CLABE|localhost/)
  const datos = ejemplo()
  datos.orden_pago = { ...datos.orden_pago, instrucciones_pendientes: false, pago_simulado: true,
    datos_pago: { beneficiario: 'DATOS-DE-PRUEBA-NO-TRANSFERIR', banco: 'BANCO-CONFIGURADO-DE-PRUEBA', cuenta: 'CUENTA-DE-PRUEBA', referencia: 'REFERENCIA-CONFIGURADA' }, instrucciones: 'Instrucción registrada.' }
  const configurada = textoPaginas(await PDFDocument.load(await generarOrdenPdf(datos))).join('\n')
  assert.match(configurada, /DATOS-DE-PRUEBA-NO-TRANSFERIR/); assert.match(configurada, /REFERENCIA-CONFIGURADA/)
  assert.match(configurada, /PAGO SIMULADO/); assert.doesNotMatch(configurada, /Instrucciones de pago pendientes/)
})

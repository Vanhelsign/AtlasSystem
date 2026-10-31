import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { PDFDocument, PDFName } from 'pdf-lib'
import { aprobarSolicitudPrueba, iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'

function firmaPng(vacia = false) {
  const png = new PNG({ width: 760, height: 240 })
  if (!vacia) for (let x = 30; x < 300; x++) {
    const y = Math.floor(100 + Math.sin(x / 18) * 35)
    for (let alto = 0; alto < 3; alto++) {
      const i = ((y + alto) * png.width + x) * 4
      png.data[i] = 24; png.data[i + 1] = 33; png.data[i + 2] = 58; png.data[i + 3] = 255
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

test('compra: propiedad, firma, vencimiento, PDF, reinicio y confirmación única', async (t) => {
  const servidor = await iniciarServidorPrueba()
  t.after(() => servidor.detener())
  let clienteA, clienteB, admin, agente, cotizacionA, cotizacionB, ordenA
  const login = async (email) => (await servidor.iniciarSesion(email)).datos
  const post = (ruta, token, cuerpo) => servidor.pedir(ruta, { metodo: 'POST', token, cuerpo })
  const firmar = (id, token, campos = {}) => post(`/portal/cotizaciones/${id}/firmar`, token, {
    nombre: 'Persona que acepta', firma: firmaPng(), conforme: true, ...campos,
  })
  const uno = (sql, ...args) => servidor.sqlTodas(sql, ...args)[0]
  const portal = (cliente) => servidor.pedir(`/portal/prospectos/${cliente.prospecto_id}`, { token: cliente.token })

  await t.test('prepara dos cotizaciones con cuentas reales y confirma desglose comercial sin costos internos', async () => {
    admin = await login('admin@atlas.com'); agente = await login('ventas@atlas.com')
    for (const email of ['compra.a@prueba.local', 'compra.b@prueba.local']) {
      const solicitud = await registrarSolicitudPrueba(servidor, email)
      assert.equal((await aprobarSolicitudPrueba(servidor, solicitud.solicitud.id)).estado, 200)
    }
    clienteA = await login('compra.a@prueba.local'); clienteB = await login('compra.b@prueba.local')
    cotizacionA = (await portal(clienteA)).datos.cotizacion_emitida
    cotizacionB = (await portal(clienteB)).datos.cotizacion_emitida
    assert.equal(cotizacionA.items.reduce((s, item) => s + Math.round(item.subtotal_venta * 100), 0), 15000000)
    assert.ok(cotizacionA.items.every((item) => item.precio_unitario_venta >= 0))
    assert.equal((await portal(clienteA)).datos.prospecto.rol_visible, 'Prospecto')
    assert.doesNotMatch(JSON.stringify(cotizacionA), /costo_unitario_interno|subtotal_interno|firma_png_b64/)
  })

  await t.test('rechaza identidad ajena, personal, falta de conformidad, imagen inválida y firma vacía', async () => {
    assert.equal((await firmar(cotizacionA.id, clienteB.token)).estado, 404)
    assert.equal((await firmar(cotizacionA.id, agente.token)).estado, 403)
    assert.equal((await firmar(cotizacionA.id, clienteA.token, { conforme: false })).estado, 400)
    assert.equal((await firmar(cotizacionA.id, clienteA.token, { firma: 'data:image/png;base64,AAAA' })).estado, 400)
    assert.equal((await firmar(cotizacionA.id, clienteA.token, { firma: firmaPng(true) })).estado, 400)
    assert.equal(uno('SELECT COUNT(*) AS n FROM firmas_cotizacion').n, 0)
  })

  await t.test('PDF previo generado en servidor y descarga ajena protegida', async () => {
    const ajeno = await fetch(`${servidor.url}/cotizaciones/${cotizacionA.id}/pdf`, { headers: { Authorization: `Bearer ${clienteB.token}` } })
    assert.equal(ajeno.status, 404)
    const respuesta = await fetch(`${servidor.url}/cotizaciones/${cotizacionA.id}/pdf`, { headers: { Authorization: `Bearer ${clienteA.token}` } })
    assert.equal(respuesta.status, 200); assert.match(respuesta.headers.get('content-type'), /application\/pdf/)
    const doc = await PDFDocument.load(await respuesta.arrayBuffer())
    assert.ok(doc.getPageCount() >= 1)
    assert.match(doc.getTitle(), new RegExp(cotizacionA.folio))
  })

  await t.test('dos peticiones de firma crean una aceptación y una orden; no convierten a Cliente ni descuentan stock', async () => {
    const intentos = await Promise.all([firmar(cotizacionA.id, clienteA.token), firmar(cotizacionA.id, clienteA.token)])
    assert.deepEqual(intentos.map((r) => r.estado).sort(), [201, 409])
    ordenA = intentos.find((r) => r.estado === 201).datos.cotizacion.orden_pago
    assert.equal(ordenA.estado, 'pendiente'); assert.equal(ordenA.instrucciones_pendientes, true)
    assert.equal(uno('SELECT COUNT(*) AS n FROM firmas_cotizacion WHERE cotizacion_id = ?', cotizacionA.id).n, 1)
    assert.equal(uno('SELECT COUNT(*) AS n FROM ordenes_pago WHERE cotizacion_id = ?', cotizacionA.id).n, 1)
    assert.equal(uno('SELECT COUNT(*) AS n FROM ordenes_instalacion').n, 0)
    assert.equal((await portal(clienteA)).datos.prospecto.rol_visible, 'Prospecto')
    const aceptada = uno('SELECT * FROM firmas_cotizacion WHERE cotizacion_id = ?', cotizacionA.id)
    assert.ok(aceptada.firmada_at && aceptada.direccion_ip && aceptada.user_agent)
    assert.equal(aceptada.snapshot_sha256.length, 64)
    assert.equal(uno("SELECT existencias FROM productos_catalogo WHERE tipo = 'Panel'").existencias, 80)
  })

  await t.test('PDF firmado incluye la imagen y precio/conceptos aceptados sobreviven a cambios del catálogo y reinicio real', async () => {
    servidor.sql("UPDATE productos_catalogo SET modelo = 'Modelo posterior', costo_unitario = 999999 WHERE tipo = 'Panel'")
    await servidor.reiniciar()
    clienteA = await login('compra.a@prueba.local'); clienteB = await login('compra.b@prueba.local')
    admin = await login('admin@atlas.com'); agente = await login('ventas@atlas.com')
    const compra = (await portal(clienteA)).datos.cotizacion_emitida
    assert.equal(compra.orden_pago.id, ordenA.id); assert.equal(compra.precio_venta, 150000)
    assert.equal(compra.items[0].modelo, cotizacionA.items[0].modelo)
    assert.equal(compra.items[0].subtotal_venta, cotizacionA.items[0].subtotal_venta)
    const respuesta = await fetch(`${servidor.url}/cotizaciones/${cotizacionA.id}/pdf`, { headers: { Authorization: `Bearer ${clienteA.token}` } })
    const documento = await PDFDocument.load(await respuesta.arrayBuffer())
    assert.ok(documento.context.enumerateIndirectObjects().some(([, objeto]) => objeto.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image'))
    const ordenPdf = await fetch(`${servidor.url}/portal/ordenes-pago/${ordenA.id}/pdf`, { headers: { Authorization: `Bearer ${clienteA.token}` } })
    assert.equal(ordenPdf.status, 200); assert.ok((await PDFDocument.load(await ordenPdf.arrayBuffer())).getPageCount() >= 1)
    assert.equal((await fetch(`${servidor.url}/portal/ordenes-pago/${ordenA.id}/pdf`, { headers: { Authorization: `Bearer ${clienteB.token}` } })).status, 404)
  })

  await t.test('solo administrador verifica importe completo, fecha y referencia; confirma una sola instalación y conversión', async () => {
    const cuerpo = { fecha_pago: new Date().toISOString(), referencia: 'TRANSFERENCIA-REAL-123', verificado: true }
    assert.equal((await post(`/admin/pagos/${ordenA.id}/confirmar`, clienteA.token, cuerpo)).estado, 403)
    assert.equal((await post(`/admin/pagos/${ordenA.id}/confirmar`, agente.token, cuerpo)).estado, 403)
    assert.equal((await post(`/admin/pagos/${ordenA.id}/confirmar`, admin.token, { ...cuerpo, verificado: false })).estado, 400)
    assert.equal((await post(`/admin/pagos/${ordenA.id}/confirmar`, admin.token, { ...cuerpo, referencia: '' })).estado, 400)
    assert.equal((await post(`/admin/pagos/${ordenA.id}/confirmar`, admin.token, { ...cuerpo, fecha_pago: '2099-01-01T00:00:00Z' })).estado, 400)
    const respuestas = await Promise.all([post(`/admin/pagos/${ordenA.id}/confirmar`, admin.token, cuerpo), post(`/admin/pagos/${ordenA.id}/confirmar`, admin.token, cuerpo)])
    assert.deepEqual(respuestas.map((r) => r.estado).sort(), [200, 409])
    const datos = (await portal(clienteA)).datos
    assert.equal(datos.prospecto.rol_visible, 'Cliente'); assert.equal(datos.cotizacion_emitida.estado, 'Compra confirmada')
    assert.equal(datos.cotizacion_emitida.orden_pago.estado, 'pagada'); assert.ok(datos.cotizacion_emitida.instalacion.folio)
    assert.equal(uno('SELECT COUNT(*) AS n FROM ordenes_instalacion WHERE cotizacion_id = ?', cotizacionA.id).n, 1)
    assert.equal(uno('SELECT COUNT(*) AS n FROM cuentas_cliente WHERE prospecto_id = ?', clienteA.prospecto_id).n, 1)
    assert.equal(uno("SELECT existencias FROM productos_catalogo WHERE tipo = 'Panel'").existencias, 80)
  })

  await t.test('orden vencida conserva auditoría, no confirma automáticamente y exige motivo para admitir pago tardío', async () => {
    const firmada = await firmar(cotizacionB.id, clienteB.token)
    assert.equal(firmada.estado, 201)
    const orden = firmada.datos.cotizacion.orden_pago
    servidor.sql("UPDATE ordenes_pago SET limite_at = datetime('now', '-1 day') WHERE id = ?", orden.id)
    const vencida = (await portal(clienteB)).datos
    assert.equal(vencida.cotizacion_emitida.orden_pago.estado, 'vencida'); assert.equal(vencida.prospecto.rol_visible, 'Prospecto')
    assert.equal(vencida.cotizacion_emitida.instalacion, null)
    await portal(clienteB)
    assert.equal(uno("SELECT COUNT(*) AS n FROM pagos_auditoria WHERE orden_pago_id = ? AND evento = 'vencida'", orden.id).n, 1)
    const cuerpo = { fecha_pago: new Date().toISOString(), referencia: 'PAGO-TARDIO-REAL', verificado: true }
    assert.equal((await post(`/admin/pagos/${orden.id}/confirmar`, admin.token, cuerpo)).estado, 400)
    assert.equal((await post(`/admin/pagos/${orden.id}/confirmar`, admin.token, { ...cuerpo, motivo_tardio: 'Pago recibido y validado después del plazo por el responsable.' })).estado, 200)
    assert.equal(uno('SELECT estatus_respuesta FROM cotizaciones_versiones WHERE id = ?', cotizacionB.id).estatus_respuesta, 'aprobada')
    assert.ok(uno('SELECT vencida_at FROM ordenes_pago WHERE id = ?', orden.id).vencida_at)
    await servidor.reiniciar()
    clienteA = await login('compra.a@prueba.local')
    const compra = (await portal(clienteA)).datos
    assert.equal(compra.prospecto.rol_visible, 'Cliente'); assert.equal(compra.cotizacion_emitida.orden_pago.estado, 'pagada')
    assert.equal(uno('SELECT COUNT(*) AS n FROM ordenes_instalacion WHERE cotizacion_id = ?', cotizacionA.id).n, 1)
  })

  await t.test('migración de cotizaciones anteriores sin precios de venta conserva total, renglones y aceptación existente', async () => {
    const snapshot = uno('SELECT snapshot_json FROM firmas_cotizacion WHERE cotizacion_id = ?', cotizacionA.id).snapshot_json
    servidor.sql('ALTER TABLE cotizacion_version_items DROP COLUMN precio_unitario_venta')
    servidor.sql('ALTER TABLE cotizacion_version_items DROP COLUMN subtotal_venta')
    await servidor.reiniciar()
    const items = servidor.sqlTodas('SELECT * FROM cotizacion_version_items WHERE cotizacion_id = ?', cotizacionA.id)
    assert.equal(items.reduce((s, item) => s + Math.round(item.subtotal_venta * 100), 0), 15000000)
    assert.equal(uno('SELECT snapshot_json FROM firmas_cotizacion WHERE cotizacion_id = ?', cotizacionA.id).snapshot_json, snapshot)
    assert.equal(uno('SELECT COUNT(*) AS n FROM ordenes_instalacion WHERE cotizacion_id = ?', cotizacionA.id).n, 1)
  })
})

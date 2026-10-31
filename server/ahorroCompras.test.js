import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { iniciarServidorPrueba, registrarSolicitudPrueba, aprobarSolicitudPrueba } from './pruebas/servidorPrueba.js'

function firma() {
  const png = new PNG({ width: 400, height: 150 })
  for (let x = 20; x < 300; x++) {
    const i = (Math.floor(70 + 25 * Math.sin(x / 10)) * 400 + x) * 4
    png.data[i + 3] = 255
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

test('ahorro de compras: permisos, efectivo y prueba, snapshot, aislamiento y reinicio', async (t) => {
  const s = await iniciarServidorPrueba({ NODE_ENV: 'development', ATLAS_PAGO_SIMULADO: 'true' })
  t.after(() => s.detener())
  // Valores exclusivos de esta base temporal: no son tarifas oficiales.
  s.sql('UPDATE tarifas_cfe SET cargo_fijo_mensual = 50')
  s.sql('UPDATE tarifas_bloques SET precio_kwh = 2')
  const clientes = []
  for (const email of ['ahorro.a@prueba.local', 'ahorro.b@prueba.local', 'ahorro.antiguo@prueba.local']) {
    const solicitud = await registrarSolicitudPrueba(s, email)
    assert.equal((await aprobarSolicitudPrueba(s, solicitud.solicitud.id)).estado, 200)
    const cuenta = (await s.iniciarSesion(email)).datos
    const portal = (await s.pedir(`/portal/prospectos/${cuenta.prospecto_id}`, { token: cuenta.token })).datos
    const id = portal.cotizacion_emitida.id
    assert.equal(portal.prospecto.rol_visible, 'Prospecto')
    assert.equal(portal.cotizacion_emitida.ahorro, undefined, 'el portal genérico no filtra la proyección al prospecto')
    assert.equal((await s.pedir('/portal/ahorro', { token: cuenta.token })).estado, 403)
    assert.equal((await s.pedir(`/portal/ahorro/${id}`, { token: cuenta.token })).estado, 403)
    const firmada = await s.pedir(`/portal/cotizaciones/${id}/firmar`, { metodo: 'POST', token: cuenta.token,
      cuerpo: { nombre: 'Persona de prueba', firma: firma(), conforme: true } })
    assert.equal(firmada.estado, 201, firmada.texto)
    assert.equal((await s.pedir('/portal/ahorro', { token: cuenta.token })).estado, 403, 'firmar no equivale a pagar')
    clientes.push({ ...cuenta, id, email, orden: firmada.datos.cotizacion.orden_pago })
  }
  const [a, b, antigua] = clientes
  assert.equal((await s.pedir('/portal/ahorro')).estado, 401)
  const admin = (await s.iniciarSesion('admin@atlas.com')).datos
  assert.equal((await s.pedir('/portal/ahorro', { token: admin.token })).estado, 403)
  const simular = (c) => s.pedir(`/portal/ordenes-pago/${c.orden.id}/simular`, { metodo: 'POST', token: c.token, cuerpo: {} })
  assert.equal((await simular(a)).estado, 200)
  assert.equal((await s.pedir(`/admin/pagos/${b.orden.id}/confirmar`, { metodo: 'POST', token: admin.token,
    cuerpo: { fecha_pago: new Date().toISOString(), referencia: 'REFERENCIA-PRUEBA-AISLADA', verificado: true } })).estado, 200)
  s.sql('UPDATE cotizaciones_versiones SET supuestos_ahorro = NULL WHERE id = ?', antigua.id)
  assert.equal((await simular(antigua)).estado, 200)
  const consultar = (c) => s.pedir(`/portal/ahorro/${c.id}`, { token: c.token })
  const primera = await consultar(a)
  assert.equal(primera.estado, 200)
  assert.equal(primera.datos.ahorro.estado, 'calculada')
  assert.equal(primera.datos.precio_venta, 150000)
  const r = primera.datos.ahorro.resultado
  assert.ok(Math.abs((r.gasto_mensual_sin_sistema - r.gasto_mensual_con_sistema) - r.ahorro_mensual) < 0.02)
  assert.ok(Math.abs(r.ahorro_mensual * 12 - r.ahorro_anual) < 0.07)
  assert.ok(r.serie.every((fila, i) => Math.abs(fila.acumulado - r.serie.slice(0, i + 1).reduce((total, anio) => total + anio.ahorro, 0)) < 0.1))
  assert.equal((await consultar(b)).datos.ahorro.estado, 'calculada', 'el pago real habilita el mismo flujo')
  const faltante = (await consultar(antigua)).datos
  assert.equal(faltante.ahorro.estado, 'no_disponible'); assert.equal(faltante.ahorro.resultado, null)
  assert.equal((await s.pedir(`/portal/ahorro/${b.id}`, { token: a.token })).estado, 404)
  const lista = (await s.pedir('/portal/ahorro', { token: a.token })).datos
  assert.deepEqual(lista.map((c) => c.cotizacion_id), [a.id])
  // Una cuenta puede tener otra compra: se comprueba la lista y cada ID, no "la última".
  s.sql('UPDATE solicitudes_cotizacion SET prospecto_id = ? WHERE id = (SELECT solicitud_id FROM cotizaciones_versiones WHERE id = ?)', a.prospecto_id, b.id)
  assert.equal((await s.pedir('/portal/ahorro', { token: a.token })).datos.length, 2)
  assert.equal((await s.pedir(`/portal/ahorro/${b.id}`, { token: a.token })).datos.id, b.id)
  s.sql('UPDATE productos_catalogo SET potencia_w = 10 WHERE tipo = ?', 'Panel')
  s.sql('UPDATE tarifas_bloques SET precio_kwh = 100')
  s.sql('UPDATE parametros_ahorro SET valor = 0.2 WHERE clave = ?', 'eficiencia')
  assert.equal((await simular(a)).estado, 200)
  assert.deepEqual((await consultar(a)).datos, primera.datos)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM proyecciones_compra')[0].n, 3)
  // Emula una compra previa a la migración: solo se recuperan los supuestos de su emisión.
  s.sql('DELETE FROM proyecciones_compra WHERE cotizacion_id = ?', a.id)
  assert.deepEqual((await consultar(a)).datos.ahorro.resultado, r)
  const antes = (await consultar(a)).datos
  await s.reiniciar()
  a.token = (await s.iniciarSesion(a.email)).datos.token
  assert.deepEqual((await consultar(a)).datos, antes)
})

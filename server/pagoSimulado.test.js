import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { DatabaseSync } from 'node:sqlite'
import { PDFDocument } from 'pdf-lib'
import { iniciarServidorPrueba, registrarSolicitudPrueba, aprobarSolicitudPrueba } from './pruebas/servidorPrueba.js'

function firma() {
  const png = new PNG({ width: 400, height: 150 })
  for (let x = 20; x < 300; x++) {
    const i = (Math.floor(70 + 25 * Math.sin(x / 10)) * 400 + x) * 4
    png.data[i + 3] = 255
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}
async function preparar(s, email) {
  const solicitud = await registrarSolicitudPrueba(s, email)
  assert.equal((await aprobarSolicitudPrueba(s, solicitud.solicitud.id)).estado, 200)
  const cuenta = (await s.iniciarSesion(email)).datos
  const cotizacion = (await s.pedir(`/portal/prospectos/${cuenta.prospecto_id}`, { token: cuenta.token })).datos.cotizacion_emitida
  const aceptada = await s.pedir(`/portal/cotizaciones/${cotizacion.id}/firmar`, { metodo: 'POST', token: cuenta.token, cuerpo: { nombre: 'Titular de prueba', firma: firma(), conforme: true } })
  assert.equal(aceptada.estado, 201, aceptada.texto)
  return { cuenta, cotizacion: aceptada.datos.cotizacion, orden: aceptada.datos.cotizacion.orden_pago }
}

for (const entorno of [{ NODE_ENV: 'production', ATLAS_PAGO_SIMULADO: 'true' }, { NODE_ENV: 'development', ATLAS_PAGO_SIMULADO: 'false' }, { NODE_ENV: '', ATLAS_PAGO_SIMULADO: 'true' }]) {
  test(`pago de prueba bloqueado con NODE_ENV=${entorno.NODE_ENV || 'sin definir'} y flag=${entorno.ATLAS_PAGO_SIMULADO}`, async (t) => {
    const s = await iniciarServidorPrueba(entorno); t.after(() => s.detener())
    const { cuenta, orden } = await preparar(s, 'bloqueado@prueba.local')
    assert.equal(orden.permite_pago_simulado, false)
    const respuesta = await s.pedir(`/portal/ordenes-pago/${orden.id}/simular`, { metodo: 'POST', token: cuenta.token, cuerpo: { NODE_ENV: 'development', ATLAS_PAGO_SIMULADO: true } })
    assert.equal(respuesta.estado, 403)
    assert.equal(s.sqlTodas('SELECT estado FROM ordenes_pago')[0].estado, 'pendiente')
    assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM ordenes_instalacion')[0].n, 0)
  })
}

test('simulación explícita: titular, idempotencia, auditoría y coexistencia con confirmación real', async (t) => {
  const s = await iniciarServidorPrueba({ NODE_ENV: 'development', ATLAS_PAGO_SIMULADO: 'true' }); t.after(() => s.detener())
  const a = await preparar(s, 'simulada@prueba.local'), b = await preparar(s, 'real@prueba.local')
  const simular = (id, token) => s.pedir(`/portal/ordenes-pago/${id}/simular`, { metodo: 'POST', token, cuerpo: {} })
  const admin = (await s.iniciarSesion('admin@atlas.com')).datos
  assert.equal((await simular(a.orden.id)).estado, 401)
  assert.equal((await simular(a.orden.id, admin.token)).estado, 403)
  assert.equal((await simular(a.orden.id, b.cuenta.token)).estado, 404)
  const repeticiones = await Promise.all([simular(a.orden.id, a.cuenta.token), simular(a.orden.id, a.cuenta.token)])
  assert.deepEqual(repeticiones.map((r) => r.estado), [200, 200])
  assert.deepEqual(repeticiones.map((r) => r.datos.repetida).sort(), [false, true])
  const fila = s.sqlTodas('SELECT * FROM ordenes_pago WHERE id = ?', a.orden.id)[0]
  assert.equal(fila.pago_simulado, 1); assert.equal(fila.simulada_por, a.cuenta.cuenta_id)
  assert.equal(fila.confirmada_por, null); assert.equal(fila.pago_fecha, null); assert.equal(fila.pago_referencia, null)
  const eventos = s.sqlTodas("SELECT * FROM pagos_auditoria WHERE orden_pago_id = ? AND evento = 'confirmada'", a.orden.id)
  assert.equal(eventos.length, 1); assert.equal(JSON.parse(eventos[0].detalle).pago_simulado, true)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM ordenes_instalacion WHERE cotizacion_id = ?', a.cotizacion.id)[0].n, 1)
  const portal = (await s.pedir(`/portal/prospectos/${a.cuenta.prospecto_id}`, { token: a.cuenta.token })).datos
  assert.equal(portal.prospecto.rol_visible, 'Cliente'); assert.equal(portal.cotizacion_emitida.orden_pago.pago_simulado, true)
  const lista = (await s.pedir('/prospectos', { token: admin.token })).datos
  assert.equal(lista.find((p) => p.id === a.cuenta.prospecto_id).pago_simulado, 1)
  const tecnico = (await s.iniciarSesion('tecnico@atlas.com')).datos
  const agente = (await s.iniciarSesion('ventas@atlas.com')).datos
  for (const token of [admin.token, agente.token]) {
    assert.deepEqual((await s.pedir('/ventas/resumen', { token })).datos, { total: 150000, reales: 0, simulados: 150000, compras: 1 })
  }
  assert.equal((await s.pedir('/ventas/resumen', { token: a.cuenta.token })).estado, 403)
  const otroAgente = await s.pedir('/personal', { metodo: 'POST', token: admin.token, cuerpo: { nombre: 'Otro agente', email: 'otro.agente@prueba.local', telefono: '8100000000', rol: 'Agente', estado_trabajo_codigo: 'MX-NLE' } })
  assert.equal(otroAgente.estado, 201)
  const ajeno = (await s.iniciarSesion('otro.agente@prueba.local')).datos
  assert.equal((await s.pedir(`/ventas/resumen?agente_id=${agente.usuario_id}`, { token: ajeno.token })).datos.total, 0)
  let instalaciones = (await s.pedir('/tecnico/instalaciones', { token: tecnico.token })).datos
  assert.equal(instalaciones.length, 1)
  const instalacionId = instalaciones[0].id
  assert.equal(instalaciones[0].tecnico_id, tecnico.usuario_id, 'la compra asigna la instalación al autor del dimensionamiento')
  for (const estado of ['MX-JAL', 'MX-NLE']) {
    const correo = `otro.tecnico.${estado}@prueba.local`
    await s.pedir('/personal', { metodo: 'POST', token: admin.token, cuerpo: { nombre: 'Otro técnico', email: correo, telefono: '8100000000', rol: 'Técnico', estado_trabajo_codigo: estado } })
    const otro = (await s.iniciarSesion(correo)).datos
    assert.equal((await s.pedir('/tecnico/instalaciones', { token: otro.token })).datos.length, 0)
    assert.equal((await s.pedir(`/tecnico/instalaciones/${instalacionId}/iniciar`, { metodo: 'POST', token: otro.token, cuerpo: {} })).estado, 404)
  }
  assert.equal((await s.pedir(`/tecnico/instalaciones/${instalacionId}/iniciar`, { metodo: 'POST', token: a.cuenta.token, cuerpo: {} })).estado, 403)
  // El técnico debe tomar la orden y programarla antes de iniciar.
  assert.equal((await s.pedir(`/tecnico/instalaciones/${instalacionId}/tomar`, { metodo: 'POST', token: tecnico.token, cuerpo: {} })).estado, 200)
  instalaciones = (await s.pedir('/tecnico/instalaciones', { token: tecnico.token })).datos
  assert.equal(instalaciones.length, 1)
  const inicios = await Promise.all([1, 2].map(() => s.pedir(`/tecnico/instalaciones/${instalacionId}/iniciar`, { metodo: 'POST', token: tecnico.token, cuerpo: { fecha_programada: new Date().toISOString() } })))
  assert.ok(inicios.every((r) => r.estado === 200 && r.datos.estatus_obra === 'en_progreso'))
  assert.ok(inicios[0].datos.iniciada_at)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM ordenes_instalacion WHERE cotizacion_id = ?', a.cotizacion.id)[0].n, 1)
  s.sql('UPDATE usuarios_personal SET activo = 0 WHERE id = ?', tecnico.usuario_id)
  assert.equal((await s.pedir('/tecnico/instalaciones', { token: tecnico.token })).estado, 403)
  s.sql("UPDATE usuarios_personal SET activo = 1, estado_trabajo_codigo = 'NO-VALIDO' WHERE id = ?", tecnico.usuario_id)
  assert.equal((await s.pedir('/tecnico/instalaciones', { token: tecnico.token })).estado, 403)
  s.sql("UPDATE usuarios_personal SET estado_trabajo_codigo = 'MX-NLE' WHERE id = ?", tecnico.usuario_id)
  const confirmar = (id) => s.pedir(`/admin/pagos/${id}/confirmar`, { metodo: 'POST', token: admin.token, cuerpo: { fecha_pago: new Date().toISOString(), referencia: 'VERIFICADA-EN-PRUEBA', verificado: true } })
  assert.equal((await confirmar(a.orden.id)).estado, 409)
  assert.equal((await confirmar(b.orden.id)).estado, 200)
  const real = s.sqlTodas('SELECT * FROM ordenes_pago WHERE id = ?', b.orden.id)[0]
  assert.equal(s.sqlTodas('SELECT tecnico_id FROM ordenes_instalacion WHERE cotizacion_id = ?', b.cotizacion.id)[0].tecnico_id, tecnico.usuario_id, 'el pago real también conserva al dimensionador como instalador')
  assert.equal(real.pago_simulado, 0); assert.equal(real.confirmada_por, admin.usuario_id); assert.ok(real.pago_referencia)
  assert.deepEqual((await s.pedir('/ventas/resumen', { token: admin.token })).datos, { total: 300000, reales: 150000, simulados: 150000, compras: 2 })
  assert.deepEqual((await s.pedir('/ventas/resumen', { token: agente.token })).datos, { total: 300000, reales: 150000, simulados: 150000, compras: 2 })
  assert.equal((await simular(b.orden.id, b.cuenta.token)).estado, 409)
  assert.equal(s.sqlTodas("SELECT existencias FROM productos_catalogo WHERE tipo = 'Panel'")[0].existencias, 80)
  const pdf = await fetch(`${s.url}/portal/ordenes-pago/${a.orden.id}/pdf`, { headers: { Authorization: `Bearer ${a.cuenta.token}` } })
  assert.equal(pdf.status, 200)
  const documento = await PDFDocument.load(await pdf.arrayBuffer()); assert.equal(documento.getPage(0).getWidth(), 595.28)
  await s.reiniciar()
  const nuevaSesion = (await s.iniciarSesion('simulada@prueba.local')).datos
  assert.equal((await simular(a.orden.id, nuevaSesion.token)).estado, 200)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM ordenes_instalacion WHERE cotizacion_id = ?', a.cotizacion.id)[0].n, 1)
  await s.reiniciar({ NODE_ENV: 'production' })
  const enProduccion = (await s.iniciarSesion('simulada@prueba.local')).datos
  assert.equal((await simular(a.orden.id, enProduccion.token)).estado, 403)
  const historica = (await s.pedir(`/portal/prospectos/${enProduccion.prospecto_id}`, { token: enProduccion.token })).datos.cotizacion_emitida
  assert.equal(historica.orden_pago.pago_simulado, true)
  assert.equal(historica.orden_pago.permite_pago_simulado, false)
  assert.equal(historica.instalacion.estatus_obra, 'en_progreso')
  assert.ok(historica.instalacion.iniciada_at)
})

test('sin variables de activación el sistema local permite simular y convierte desde el servidor', async (t) => {
  const s = await iniciarServidorPrueba(); t.after(() => s.detener())
  const a = await preparar(s, 'simulada.por.defecto@prueba.local')
  assert.equal(a.orden.permite_pago_simulado, true)
  const respuesta = await s.pedir(`/portal/ordenes-pago/${a.orden.id}/simular`, { metodo: 'POST', token: a.cuenta.token, cuerpo: {} })
  assert.equal(respuesta.estado, 200)
  assert.equal(respuesta.datos.cotizacion.orden_pago.pago_simulado, true)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM ordenes_instalacion')[0].n, 1)
})

test('datos bancarios configurados se guardan con la orden y no cambian al modificar la configuración', async (t) => {
  const s = await iniciarServidorPrueba({ ATLAS_PAGO_BENEFICIARIO: 'BENEFICIARIO DE PRUEBA - NO TRANSFERIR', ATLAS_PAGO_BANCO: 'BANCO DE PRUEBA', ATLAS_PAGO_CUENTA: 'CUENTA-PRUEBA', ATLAS_PAGO_REFERENCIA: 'REFERENCIA-PRUEBA', ATLAS_PAGO_INSTRUCCIONES: 'Instrucción de prueba' })
  t.after(() => s.detener())
  const a = await preparar(s, 'bancarios@prueba.local')
  assert.equal(a.orden.datos_pago.beneficiario, 'BENEFICIARIO DE PRUEBA - NO TRANSFERIR')
  assert.equal(a.orden.instrucciones_pendientes, false)
  await s.reiniciar({ ATLAS_PAGO_BENEFICIARIO: 'CONFIGURACION POSTERIOR', ATLAS_PAGO_INSTRUCCIONES: 'Otra instrucción' })
  const cuenta = (await s.iniciarSesion('bancarios@prueba.local')).datos
  const consulta = (await s.pedir(`/portal/prospectos/${cuenta.prospecto_id}`, { token: cuenta.token })).datos.cotizacion_emitida
  assert.equal(consulta.orden_pago.datos_pago.beneficiario, a.orden.datos_pago.beneficiario)
  assert.equal(consulta.orden_pago.instrucciones, 'Instrucción de prueba')
})

test('una orden vencida no puede pagarse con simulación', async (t) => {
  const s = await iniciarServidorPrueba({ NODE_ENV: 'development', ATLAS_PAGO_SIMULADO: 'true' }); t.after(() => s.detener())
  const a = await preparar(s, 'vencida.simulada@prueba.local')
  s.sql("UPDATE ordenes_pago SET limite_at = datetime('now', '-1 day') WHERE id = ?", a.orden.id)
  assert.equal((await s.pedir(`/portal/ordenes-pago/${a.orden.id}/simular`, { metodo: 'POST', token: a.cuenta.token, cuerpo: {} })).estado, 409)
  assert.equal(s.sqlTodas('SELECT estado FROM ordenes_pago WHERE id = ?', a.orden.id)[0].estado, 'vencida')
})

test('migración del CHECK conserva órdenes reales, firmas, auditoría y autoincremento anteriores', async (t) => {
  const s = await iniciarServidorPrueba(); t.after(() => s.detener())
  const a = await preparar(s, 'migracion.pago@prueba.local')
  const admin = (await s.iniciarSesion('admin@atlas.com')).datos
  assert.equal((await s.pedir(`/admin/pagos/${a.orden.id}/confirmar`, { metodo: 'POST', token: admin.token, cuerpo: { fecha_pago: new Date().toISOString(), referencia: 'REAL-ANTERIOR', verificado: true } })).estado, 200)
  const antes = s.sqlTodas('SELECT * FROM firmas_cotizacion')[0]
  // Solo la base temporal del ayudante; reproducir el esquema previo al pago simulado.
  const db = new DatabaseSync(s.base)
  try {
    db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;')
    db.exec(`CREATE TABLE ordenes_pago_anterior (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cotizacion_id INTEGER NOT NULL UNIQUE REFERENCES cotizaciones_versiones(id) ON DELETE RESTRICT,
      firma_id INTEGER NOT NULL UNIQUE REFERENCES firmas_cotizacion(id) ON DELETE RESTRICT, folio TEXT NOT NULL UNIQUE,
      importe REAL NOT NULL CHECK(importe > 0), moneda TEXT NOT NULL DEFAULT 'MXN', instrucciones TEXT,
      emitida_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, limite_at TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente', vencida_at TEXT, pago_fecha TEXT, pago_referencia TEXT,
      confirmada_at TEXT, confirmada_por INTEGER REFERENCES usuarios_personal(id) ON DELETE RESTRICT, motivo_pago_tardio TEXT,
      CHECK (estado <> 'pagada' OR (pago_fecha IS NOT NULL AND pago_referencia IS NOT NULL AND confirmada_por IS NOT NULL)))`)
    const columnas = db.prepare('PRAGMA table_info(ordenes_pago_anterior)').all().map((c) => c.name).join(', ')
    db.exec(`INSERT INTO ordenes_pago_anterior (${columnas}) SELECT ${columnas} FROM ordenes_pago;
      DROP TABLE ordenes_pago; ALTER TABLE ordenes_pago_anterior RENAME TO ordenes_pago; COMMIT;`)
  } finally { db.close() }
  await s.reiniciar()
  const despues = s.sqlTodas('SELECT * FROM ordenes_pago')[0]
  assert.equal(despues.id, a.orden.id); assert.equal(despues.pago_referencia, 'REAL-ANTERIOR'); assert.equal(despues.pago_simulado, 0)
  assert.equal(s.sqlTodas('SELECT * FROM firmas_cotizacion')[0].snapshot_sha256, antes.snapshot_sha256)
  assert.equal(s.sqlTodas('PRAGMA foreign_key_check').length, 0)
  assert.equal(s.sqlTodas("SELECT COUNT(*) AS n FROM pagos_auditoria WHERE evento = 'confirmada'")[0].n, 1)
})

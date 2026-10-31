import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { iniciarServidorPrueba, registrarSolicitudPrueba, aprobarSolicitudPrueba } from './pruebas/servidorPrueba.js'

function foto() {
  const png = new PNG({ width: 64, height: 64 })
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 70; png.data[i + 1] = 40; png.data[i + 3] = 255 }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}
function firma() {
  const png = new PNG({ width: 400, height: 150 })
  for (let x = 20; x < 300; x++) png.data[(Math.floor(70 + 25 * Math.sin(x / 10)) * 400 + x) * 4 + 3] = 255
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}
async function compra(s, email) {
  const registro = await registrarSolicitudPrueba(s, email)
  assert.equal((await aprobarSolicitudPrueba(s, registro.solicitud.id)).estado, 200)
  const cuenta = (await s.iniciarSesion(email)).datos
  const cotizacion = (await s.pedir(`/portal/prospectos/${cuenta.prospecto_id}`, { token: cuenta.token })).datos.cotizacion_emitida
  const aceptada = await s.pedir(`/portal/cotizaciones/${cotizacion.id}/firmar`, { metodo: 'POST', token: cuenta.token, cuerpo: { nombre: 'Titular de prueba', firma: firma(), conforme: true } })
  assert.equal(aceptada.estado, 201, aceptada.texto)
  return { cuenta, cotizacion, pago: aceptada.datos.cotizacion.orden_pago }
}

test('instalación: zona, toma concurrente, avances, fotos privadas, incidencias, reinicio y cierre único', async t => {
  const s = await iniciarServidorPrueba({ NODE_ENV: 'development', ATLAS_PAGO_SIMULADO: 'true' }); t.after(() => s.detener())
  const admin = (await s.iniciarSesion('admin@atlas.com')).datos
  const a = await compra(s, 'instala.a@prueba.local'), b = await compra(s, 'instala.b@prueba.local')
  const tecnicoInicial = (await s.iniciarSesion('tecnico@atlas.com')).datos
  assert.deepEqual((await s.pedir('/tecnico/instalaciones', { token: tecnicoInicial.token })).datos, [], 'una firma sin pago no crea instalación')
  assert.deepEqual((await s.pedir('/portal/instalaciones', { token: a.cuenta.token })).datos, [])
  assert.deepEqual((await s.pedir('/portal/proyectos', { token: a.cuenta.token })).datos, [])
  for (const c of [a, b]) assert.equal((await s.pedir(`/portal/ordenes-pago/${c.pago.id}/simular`, { metodo: 'POST', token: c.cuenta.token, cuerpo: {} })).estado, 200)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM ordenes_instalacion')[0].n, 2)
  const ordenId = s.sqlTodas('SELECT id FROM ordenes_instalacion WHERE cotizacion_id=?', a.cotizacion.id)[0].id
  assert.equal(s.sqlTodas('SELECT tecnico_id FROM ordenes_instalacion WHERE id=?', ordenId)[0].tecnico_id, tecnicoInicial.usuario_id)
  const proyectos = async (sesion) => (await s.pedir('/portal/proyectos', { token: sesion })).datos
  let inicio = (await proyectos(a.cuenta.token))[0]
  assert.equal(inicio.cotizacion.id, a.cotizacion.id)
  assert.equal(inicio.tecnico_nombre, tecnicoInicial.nombre)
  assert.equal(inicio.progreso.estado, 'sin_iniciar'); assert.equal(inicio.progreso.fase_actual, null)
  assert.deepEqual(inicio.progreso.etapas.map(e => e.completada), [true, false, false, false])
  const cuentas = {}
  for (const [email, estado] of [['competidor@prueba.local', 'MX-NLE'], ['ajeno@prueba.local', 'MX-JAL']]) {
    assert.equal((await s.pedir('/personal', { metodo: 'POST', token: admin.token, cuerpo: { nombre: 'Técnico de prueba', email, telefono: '8100000000', rol: 'Técnico', estado_trabajo_codigo: estado } })).estado, 201)
    cuentas[email] = (await s.iniciarSesion(email)).datos
  }
  const competidor = cuentas['competidor@prueba.local'], ajeno = cuentas['ajeno@prueba.local']
  assert.deepEqual((await s.pedir('/tecnico/instalaciones', { token: competidor.token })).datos, [], 'otro técnico del mismo estado no ve proyectos que no dimensionó')
  assert.equal((await s.pedir('/tecnico/instalaciones')).estado, 401)
  assert.equal((await s.pedir('/tecnico/instalaciones', { token: a.cuenta.token })).estado, 403)
  assert.deepEqual((await s.pedir('/tecnico/instalaciones?estado=MX-NLE', { token: ajeno.token })).datos, [])
  const post = (ruta, token, cuerpo = {}) => s.pedir(ruta, { metodo: 'POST', token, cuerpo })
  const ruta = `/tecnico/instalaciones/${ordenId}`
  assert.equal((await s.pedir(ruta, { token: ajeno.token })).estado, 404)
  assert.equal((await post(`${ruta}/tomar`, ajeno.token, { estado: 'MX-NLE', tecnico_id: tecnicoInicial.usuario_id })).estado, 404)
  // Las órdenes antiguas sin asignar también están restringidas al dimensionador.
  s.sql('UPDATE ordenes_instalacion SET tecnico_id=NULL WHERE id=?', ordenId)
  assert.deepEqual((await s.pedir('/tecnico/instalaciones', { token: competidor.token })).datos, [])
  assert.equal((await post(`${ruta}/iniciar`, tecnicoInicial.token, { fecha_programada: new Date().toISOString() })).estado, 409)
  const carrera = await Promise.all([tecnicoInicial, competidor].map(c => post(`${ruta}/tomar`, c.token)))
  assert.deepEqual(carrera.map(r => r.estado).sort(), [200, 404])
  const ganador = carrera[0].estado === 200 ? tecnicoInicial : competidor, perdedor = ganador === tecnicoInicial ? competidor : tecnicoInicial
  assert.equal(ganador.usuario_id, tecnicoInicial.usuario_id, 'solo el autor del dimensionamiento puede tomar la orden anterior')
  let token = ganador.token, detalle = carrera.find(r => r.estado === 200).datos
  assert.ok(detalle.tomada_at); assert.equal(detalle.estado_visible, 'Tomada, pendiente de inicio')
  assert.equal((await post(`${ruta}/tomar`, token)).estado, 200)
  assert.equal((await s.pedir(ruta, { token: perdedor.token })).estado, 404)
  assert.equal((await post(`${ruta}/finalizar`, perdedor.token)).estado, 404)
  assert.equal((await post(`${ruta}/iniciar`, token)).estado, 400)
  const programada = '2026-11-01T14:00:00.000Z'
  const inicios = await Promise.all([1, 2].map(() => post(`${ruta}/iniciar`, token, { fecha_programada: programada })))
  assert.ok(inicios.every(r => r.estado === 200)); assert.equal(inicios[0].datos.iniciada_at, inicios[1].datos.iniciada_at)
  detalle = inicios[0].datos
  assert.equal((await proyectos(a.cuenta.token))[0].progreso.fase_actual, 1)
  assert.equal(detalle.fecha_programada, programada)
  assert.equal(detalle.actividades.some(a => a.codigo === 'montaje_baterias'), false, 'sin batería cotizada no se declara una instalada')
  assert.equal((await post(`${ruta}/finalizar`, token)).estado, 409)
  const stock = s.sqlTodas('SELECT id,existencias FROM productos_catalogo ORDER BY id')
  const datosParte = (parte, completado, fotos = [], avanzar = false) => ({ operacion_id: randomUUID(), revision_avance: detalle.revision_avance, parte, avanzar, fotos,
    actividades: detalle.actividades.filter(a => a.parte === parte).map(a => ({ codigo: a.codigo, completado, observaciones: 'Observación interna de instalación' })) })
  let cuerpo = datosParte(2, true)
  assert.equal((await post(`${ruta}/avance`, token, cuerpo)).estado, 409, 'no salta a una parte posterior')
  cuerpo = datosParte(1, false)
  const borrador = await post(`${ruta}/avance`, token, cuerpo)
  assert.equal(borrador.estado, 200, borrador.texto); detalle = borrador.datos
  const sinFoto = await post(`${ruta}/avance`, token, datosParte(1, true, [], true))
  assert.equal(sinFoto.estado, 409)
  assert.ok((await s.pedir(ruta, { token })).datos.actividades.filter(a => a.parte === 1).every(a => !a.completado), 'el fallo no aplica parte del paso')
  const directorio = join(s.carpeta, 'evidencias')
  const mala = { clave_carga: randomUUID(), imagen: 'data:image/png;base64,' + Buffer.from('<svg>no es PNG</svg>').toString('base64') }
  assert.equal((await post(`${ruta}/avance`, token, datosParte(1, true, [mala]))).estado, 400)
  const fotoValida = { clave_carga: randomUUID(), imagen: foto(), descripcion: 'Preparación real de prueba', actividad_codigo: 'materiales' }
  assert.equal((await post(`${ruta}/avance`, token, datosParte(1, true, [fotoValida, mala]))).estado, 400)
  assert.equal(existsSync(directorio) ? readdirSync(directorio).length : 0, 0, 'rollback limpia los archivos nuevos')
  const enorme = { clave_carga: randomUUID(), imagen: `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')}` }
  assert.equal((await post(`${ruta}/avance`, token, datosParte(1, true, [enorme]))).estado, 400)
  cuerpo = datosParte(1, true, [fotoValida], true)
  const repetidas = await Promise.all([1, 2].map(() => post(`${ruta}/avance`, token, cuerpo)))
  assert.ok(repetidas.every(r => r.estado === 200), JSON.stringify(repetidas.map(r => r.datos)))
  detalle = repetidas[0].datos
  assert.equal(detalle.parte_actual, 2); assert.equal(detalle.fotos.length, 1); assert.equal(readdirSync(directorio).length, 1)
  assert.equal((await proyectos(a.cuenta.token))[0].progreso.fase_actual, 2)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM checklist_evidencias WHERE orden_id=?', ordenId)[0].n, detalle.actividades.filter(a => a.parte === 1).length)
  const fotoId = detalle.fotos[0].id, endpointFoto = `${s.url}/instalaciones/${ordenId}/fotos/${fotoId}`
  const imagen = await fetch(endpointFoto, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(imagen.status, 200); assert.equal(imagen.headers.get('content-type'), 'image/png')
  assert.equal(Buffer.from(await imagen.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  for (const [cuenta, estado] of [[a.cuenta, 403], [b.cuenta, 403], [perdedor, 404], [ajeno, 404]]) assert.equal((await fetch(endpointFoto, { headers: { Authorization: `Bearer ${cuenta.token}` } })).status, estado)
  assert.equal((await fetch(endpointFoto, { headers: { Authorization: `Bearer ${admin.token}` } })).status, 200)
  assert.ok(!JSON.stringify((await s.pedir('/portal/instalaciones', { token: a.cuenta.token })).datos).includes('Observación interna'))
  await s.reiniciar()
  token = (await s.iniciarSesion(ganador.email)).datos.token
  const recuperado = await s.pedir(ruta, { token }); assert.equal(recuperado.estado, 200)
  detalle = recuperado.datos
  assert.equal(detalle.parte_actual, 2); assert.equal(detalle.fotos[0].id, fotoId)
  assert.ok(detalle.actividades.filter(a => a.parte === 1).every(a => a.completado))
  assert.equal((await fetch(endpointFoto, { headers: { Authorization: `Bearer ${token}` } })).status, 200)
  let r = await post(`${ruta}/postergar`, token, { motivo: 'Lluvia en el lugar de instalación' })
  assert.equal(r.estado, 200); assert.equal(r.datos.estado_visible, 'Postergada')
  assert.equal((await proyectos((await s.iniciarSesion(a.cuenta.email)).datos.token))[0].progreso.estado, 'postergada')
  assert.equal((await post(`${ruta}/avance`, token, datosParte(2, false))).estado, 409)
  r = await post(`${ruta}/iniciar`, token, { fecha_programada: '2026-11-02T14:00:00.000Z' }); detalle = r.datos
  assert.equal(r.estado, 200); assert.equal(detalle.postergada_at, null)
  for (const parte of [2, 3]) {
    cuerpo = datosParte(parte, true, [{ clave_carga: randomUUID(), imagen: foto(), descripcion: `Foto parte ${parte}` }], parte < 3)
    r = await post(`${ruta}/avance`, token, cuerpo); assert.equal(r.estado, 200, r.texto); detalle = r.datos
    const consultaInicio = (await proyectos((await s.iniciarSesion(a.cuenta.email)).datos.token))[0]
    assert.equal(consultaInicio.progreso.fase_actual, 3)
    assert.equal(consultaInicio.progreso.etapas[3].completada, false)
  }
  const incidencia = { operacion_id: randomUUID(), parte: 3, actividad_codigo: 'final_conexiones', descripcion: 'Detalle interno que no debe exponerse al cliente', fotos: [{ clave_carga: randomUUID(), imagen: foto(), descripcion: 'Evidencia interna de incidencia' }] }
  const incidencias = await Promise.all([1, 2].map(() => post(`${ruta}/incidencias`, token, incidencia)))
  assert.ok(incidencias.every(i => i.estado === 201)); detalle = incidencias[0].datos
  assert.equal(detalle.incidencias.length, 1); assert.equal(detalle.estado_visible, 'Con incidencia')
  assert.equal((await post(`${ruta}/finalizar`, token)).estado, 409)
  const loginA = (await s.iniciarSesion('instala.a@prueba.local')).datos, loginB = (await s.iniciarSesion('instala.b@prueba.local')).datos
  const publico = (await s.pedir('/portal/instalaciones', { token: loginA.token })).datos
  inicio = (await proyectos(loginA.token))[0]
  assert.equal(inicio.progreso.estado, 'incidencia'); assert.equal(inicio.progreso.fase_actual, null)
  assert.ok(!JSON.stringify(inicio).includes('Detalle interno'))
  assert.deepEqual((await proyectos(loginB.token)).map(p => p.cotizacion.id), [b.cotizacion.id])
  assert.deepEqual(publico.map(o => o.id), [ordenId]); assert.equal(publico[0].incidencias_pendientes, 1)
  assert.ok(publico[0].aviso); assert.ok(!JSON.stringify(publico).includes('Detalle interno')); assert.ok(!JSON.stringify(publico).includes('observaciones')); assert.ok(!JSON.stringify(publico).includes('fotos'))
  assert.equal((await s.pedir(`/portal/instalaciones?orden_id=${ordenId}`, { token: loginB.token })).datos.some(o => o.id === ordenId), false)
  const incidenciaId = detalle.incidencias[0].id
  r = await post(`${ruta}/incidencias/${incidenciaId}/resolver`, token, { resolucion: 'Conexión revisada y condición corregida' })
  assert.equal(r.estado, 200); assert.equal(r.datos.incidencias[0].estado, 'resuelta')
  // Compatibilidad: el flujo antiguo podía dejar un inicio sin fecha programada.
  const antesDeCompletarFecha = (await s.pedir(ruta, { token })).datos
  s.sql('UPDATE ordenes_instalacion SET fecha_programada=NULL WHERE id=?', ordenId)
  const bloqueoFecha = await post(`${ruta}/finalizar`, token)
  assert.equal(bloqueoFecha.estado, 409); assert.match(bloqueoFecha.datos.error, /Falta la fecha programada/)
  const completarFecha = await post(`${ruta}/iniciar`, token, { fecha_programada: programada })
  assert.equal(completarFecha.estado, 200)
  assert.equal(completarFecha.datos.fecha_programada, programada)
  assert.equal(completarFecha.datos.iniciada_at, antesDeCompletarFecha.iniciada_at)
  assert.deepEqual(completarFecha.datos.actividades, antesDeCompletarFecha.actividades)
  assert.deepEqual(completarFecha.datos.fotos, antesDeCompletarFecha.fotos)
  const cierres = await Promise.all([1, 2].map(() => post(`${ruta}/finalizar`, token)))
  assert.ok(cierres.every(c => c.estado === 200)); assert.equal(cierres[0].datos.fecha_fin_real, cierres[1].datos.fecha_fin_real)
  assert.equal(cierres[0].datos.estado_visible, 'Finalizada'); assert.notEqual(cierres[0].datos.fecha_fin_real, programada)
  inicio = (await proyectos(loginA.token))[0]
  assert.ok(inicio.progreso.etapas.every(e => e.completada && !e.actual))
  assert.equal(inicio.orden.fecha_fin_real, cierres[0].datos.fecha_fin_real)
  assert.equal(inicio.orden.proximo_mantenimiento, null, 'no inventa un mantenimiento')
  s.sql("INSERT INTO mantenimientos_programados (orden_id,tipo_servicio,fecha_limite) VALUES (?,'semestral','2099-01-01')", ordenId)
  assert.equal((await proyectos(loginA.token))[0].orden.proximo_mantenimiento.fecha_limite, '2099-01-01')
  s.sql('DELETE FROM mantenimientos_programados WHERE orden_id=?', ordenId)
  assert.equal((await post(`${ruta}/avance`, token, datosParte(3, true))).estado, 409)
  assert.deepEqual(s.sqlTodas('SELECT id,existencias FROM productos_catalogo ORDER BY id'), stock)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM ordenes_instalacion')[0].n, 2)
  assert.equal(s.sqlTodas('SELECT COUNT(*) AS n FROM mantenimientos_programados')[0].n, 0, 'solo se prepara la fecha para integración 7')
  assert.deepEqual(s.sqlTodas('PRAGMA foreign_key_check'), [])
})

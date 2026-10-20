// Pruebas de la papelera de clientes y estimaciones con la API real. La base, data/correos/ y data/backups/
// viven en una carpeta temporal (los respaldos van junto a la base temporal). Antes y después se compara la
// metadata (no el contenido) de la carpeta data/ real para demostrar que no se tocó. Ejecutar con: npm test
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aprobarSolicitudPrueba, completarRevisionPrueba, iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'

const dataReal = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data')
// Nombres, tamaños y fechas de data/backups/ y data/correos/ reales, las carpetas que esta función podría tocar
// (sin abrir ningún archivo). data/atlas.sqlite no se compara porque un servidor de desarrollo abierto lo
// modifica por su cuenta; que la base de prueba no esté en data/ lo comprueban las aserciones de rutas.
const fotoDataReal = () => ['backups', 'correos'].flatMap((nombre) => {
  const carpeta = join(dataReal, nombre)
  if (!existsSync(carpeta)) return [`${nombre}: no existe`]
  return readdirSync(carpeta).map((archivo) => {
    const { size, mtimeMs } = statSync(join(carpeta, archivo))
    return `${nombre}/${archivo}|${size}|${mtimeMs}`
  })
}).sort()

describe('papelera de clientes y estimaciones', () => {
  let servidor
  let fotoAntes
  const tokens = {}
  const pedir = (ruta, opciones = {}) => servidor.pedir(ruta, { token: tokens.admin, ...opciones })
  const post = (ruta, cuerpo = {}, token = tokens.admin) => servidor.pedir(ruta, { metodo: 'POST', token, cuerpo })
  const uno = (consulta, ...parametros) => servidor.sqlTodas(consulta, ...parametros)[0]
  const idCliente = (email) => uno('SELECT id FROM prospectos WHERE email = ?', email).id
  const idSolicitud = (email) => uno('SELECT s.id FROM solicitudes_cotizacion s JOIN prospectos p ON p.id = s.prospecto_id WHERE p.email = ? ORDER BY s.id LIMIT 1', email).id
  // Segunda solicitud del mismo cliente (la interfaz solo crea una por cliente; aquí se copia la primera).
  const duplicarSolicitud = (solicitudId) => {
    const columnas = servidor.sqlTodas('PRAGMA table_info(solicitudes_cotizacion)').map((columna) => columna.name).filter((nombre) => nombre !== 'id' && nombre !== 'created_at')
    servidor.sql(`INSERT INTO solicitudes_cotizacion (${columnas.join(', ')}) SELECT ${columnas.join(', ')} FROM solicitudes_cotizacion WHERE id = ?`, solicitudId)
    return uno('SELECT MAX(id) AS id FROM solicitudes_cotizacion').id
  }

  before(async () => {
    fotoAntes = fotoDataReal()
    servidor = await iniciarServidorPrueba()
    for (const ruta of [servidor.base, servidor.carpetaCorreos, join(dirname(servidor.base), 'backups')]) {
      assert.ok(resolve(ruta).startsWith(resolve(tmpdir())), `${ruta} debe estar en la carpeta temporal`)
    }
    for (const [clave, email] of [['admin', 'admin@atlas.com'], ['agente', 'ventas@atlas.com'], ['tecnico', 'tecnico@atlas.com']]) {
      tokens[clave] = (await servidor.iniciarSesion(email)).datos.token
    }
  })
  after(async () => {
    await servidor?.detener()
    assert.deepEqual(fotoDataReal(), fotoAntes, 'ningún archivo de data/ real cambió')
  })

  test('solo el administrador: 401 sin sesión, 403 para agente y técnico', async () => {
    const { registro } = await registrarSolicitudPrueba(servidor, 'roles@ejemplo.com')
    const rutas = [
      ['GET', '/admin/clientes'], ['GET', `/admin/clientes/${registro.id}`],
      ['POST', `/admin/clientes/${registro.id}/eliminar`], ['POST', `/admin/clientes/${registro.id}/restaurar`],
      ['POST', `/admin/clientes/${registro.id}/eliminar-definitivamente`],
      ['POST', `/admin/solicitudes/${registro.solicitud_id}/eliminar`], ['POST', `/admin/solicitudes/${registro.solicitud_id}/restaurar`],
      ['POST', `/admin/solicitudes/${registro.solicitud_id}/eliminar-definitivamente`],
    ]
    for (const [metodo, ruta] of rutas) {
      const cuerpo = metodo === 'GET' ? undefined : {}
      assert.equal((await servidor.pedir(ruta, { metodo, cuerpo })).estado, 401, ruta)
      for (const token of [tokens.agente, tokens.tecnico]) assert.equal((await servidor.pedir(ruta, { metodo, token, cuerpo })).estado, 403, ruta)
    }
    assert.equal(uno('SELECT eliminado_at FROM prospectos WHERE id = ?', registro.id).eliminado_at, null)
  })

  test('ids: 400 si no es válido y 404 si no existe', async () => {
    assert.equal((await pedir('/admin/clientes/abc')).estado, 400)
    for (const ruta of ['/admin/clientes/999999', '/admin/solicitudes/999999']) {
      for (const accion of ['eliminar', 'restaurar', 'eliminar-definitivamente']) {
        assert.equal((await post(`${ruta}/${accion}`, { entiendo: true })).estado, 404, `${ruta}/${accion}`)
      }
    }
    assert.equal((await pedir('/admin/clientes/999999')).estado, 404)
  })

  test('eliminar y restaurar un cliente: conteos, listas, motivo y 409 al repetir', async () => {
    const { registro, solicitud } = await registrarSolicitudPrueba(servidor, 'lista@ejemplo.com')
    assert.equal((await aprobarSolicitudPrueba(servidor, solicitud.id)).estado, 200)
    const detalle = (await pedir(`/admin/clientes/${registro.id}`)).datos
    assert.deepEqual(detalle.impacto.eliminar, { solicitudes: 1, cotizaciones: 1 })
    assert.equal((await post(`/admin/clientes/${registro.id}/eliminar`, { motivo: 'x'.repeat(501) })).estado, 400)
    const eliminado = await post(`/admin/clientes/${registro.id}/eliminar`, { motivo: '  Registro de prueba  ' })
    assert.deepEqual(eliminado.datos, { eliminado: true, solicitudes: 1, cotizaciones: 1 })
    assert.equal(uno('SELECT motivo_eliminacion FROM prospectos WHERE id = ?', registro.id).motivo_eliminacion, 'Registro de prueba')
    assert.equal((await post(`/admin/clientes/${registro.id}/eliminar`)).estado, 409)
    const activos = (await pedir('/admin/clientes?estado=activos')).datos
    const eliminados = (await pedir('/admin/clientes?estado=eliminados&q=LISTA@')).datos
    assert.ok(!activos.some((cliente) => cliente.id === registro.id))
    assert.deepEqual(eliminados.map((cliente) => [cliente.id, cliente.motivo_eliminacion, cliente.total_solicitudes]), [[registro.id, 'Registro de prueba', 1]])
    // Las cotizaciones emitidas y sus copias no se tocan con el borrado lógico.
    assert.equal(uno('SELECT COUNT(*) AS total FROM cotizacion_version_items i JOIN cotizaciones_versiones c ON c.id = i.cotizacion_id WHERE c.solicitud_id = ?', solicitud.id).total, 2)
    const restaurado = await post(`/admin/clientes/${registro.id}/restaurar`)
    assert.deepEqual(restaurado.datos, { restaurado: true, solicitudes: 1, cotizaciones: 1 })
    assert.equal((await post(`/admin/clientes/${registro.id}/restaurar`)).estado, 409)
    assert.ok((await pedir('/admin/clientes')).datos.some((cliente) => cliente.id === registro.id))
  })

  test('lote: restaurar al cliente no restaura la estimación eliminada aparte', async () => {
    const { registro, solicitud } = await registrarSolicitudPrueba(servidor, 'lote@ejemplo.com')
    const aparte = duplicarSolicitud(solicitud.id)
    assert.equal((await post(`/admin/solicitudes/${aparte}/eliminar`)).estado, 200)
    assert.equal((await post(`/admin/solicitudes/${aparte}/eliminar`)).estado, 409)
    assert.equal(uno('SELECT eliminado_at FROM prospectos WHERE id = ?', registro.id).eliminado_at, null, 'eliminar una estimación no toca al cliente')
    assert.equal((await pedir(`/prospectos/${registro.id}`)).datos.solicitud_id, solicitud.id, 'la estimación eliminada deja de ser la más reciente')
    assert.equal((await post(`/admin/clientes/${registro.id}/eliminar`)).datos.solicitudes, 1)
    const restaurarSola = await post(`/admin/solicitudes/${aparte}/restaurar`)
    assert.equal(restaurarSola.estado, 409)
    assert.match(restaurarSola.datos.error, /restaura primero al cliente/)
    assert.equal((await post(`/admin/clientes/${registro.id}/restaurar`)).datos.solicitudes, 1)
    assert.ok(uno('SELECT eliminado_at FROM solicitudes_cotizacion WHERE id = ?', aparte).eliminado_at, 'sigue en la papelera')
    assert.equal(uno('SELECT eliminado_at FROM solicitudes_cotizacion WHERE id = ?', solicitud.id).eliminado_at, null)
    assert.equal((await post(`/admin/solicitudes/${aparte}/restaurar`)).estado, 200)
    assert.equal((await post(`/admin/solicitudes/${aparte}/restaurar`)).estado, 409)
  })

  test('cliente eliminado: login con el mensaje genérico, sesiones cerradas y enlaces pendientes invalidados', async () => {
    await registrarSolicitudPrueba(servidor, 'sesion@ejemplo.com')
    const sesion = (await servidor.iniciarSesion('sesion@ejemplo.com')).datos
    const { correo } = await registrarSolicitudPrueba(servidor, 'enlace@ejemplo.com', 'Nuevo León', { contrasena: null })
    const token = /#crear-contrasena=([A-Za-z0-9_-]{43})/.exec(servidor.leerCorreo(correo.archivo).texto)[1]
    assert.equal((await post('/portal/validar-enlace', { token }, undefined)).estado, 200)
    for (const email of ['sesion@ejemplo.com', 'enlace@ejemplo.com']) assert.equal((await post(`/admin/clientes/${idCliente(email)}/eliminar`)).estado, 200)
    const portal = await servidor.pedir(`/portal/prospectos/${sesion.prospecto_id}`, { token: sesion.token })
    assert.equal(portal.estado, 401)
    const login = await servidor.iniciarSesion('sesion@ejemplo.com')
    assert.equal(login.estado, 401)
    assert.deepEqual(login.datos, { error: 'Credenciales incorrectas' })
    assert.equal((await post('/portal/validar-enlace', { token }, undefined)).datos.codigo, 'enlace_invalido')
    // Al restaurar vuelve a entrar con su contraseña, pero el enlace pendiente no revive.
    for (const email of ['sesion@ejemplo.com', 'enlace@ejemplo.com']) await post(`/admin/clientes/${idCliente(email)}/restaurar`)
    assert.equal((await servidor.iniciarSesion('sesion@ejemplo.com')).estado, 200)
    assert.equal((await post('/portal/validar-enlace', { token }, undefined)).datos.codigo, 'enlace_invalido')
  })

  test('los registros eliminados no aparecen en ninguna pantalla y sus rutas responden 404', async () => {
    // Pendiente de revisión técnica: cola del técnico.
    const pendiente = await registrarSolicitudPrueba(servidor, 'cola@ejemplo.com')
    servidor.sql("UPDATE usuarios_personal SET estado_trabajo_codigo = 'MX-NLE' WHERE email = 'tecnico@atlas.com'")
    tokens.tecnico = (await servidor.iniciarSesion('tecnico@atlas.com')).datos.token
    const enCola = async () => (await servidor.pedir('/tecnico/solicitudes', { token: tokens.tecnico })).datos.solicitudes.some((fila) => fila.id === pendiente.solicitud.id)
    assert.equal(await enCola(), true)
    await post(`/admin/solicitudes/${pendiente.solicitud.id}/eliminar`)
    assert.equal(await enCola(), false)
    assert.equal((await servidor.pedir(`/tecnico/solicitudes/${pendiente.solicitud.id}`, { token: tokens.tecnico })).estado, 404)
    assert.notEqual((await servidor.pedir(`/tecnico/solicitudes/${pendiente.solicitud.id}/tomar`, { metodo: 'POST', token: tokens.tecnico, cuerpo: {} })).estado, 201)

    // Lista para el agente (revisión completada): estimación previa, aprobar, devolver, detalle y listas.
    const lista = await registrarSolicitudPrueba(servidor, 'oculto@ejemplo.com')
    await completarRevisionPrueba(servidor, lista.solicitud.id)
    const agente = (await servidor.iniciarSesion('ventas@atlas.com')).datos.token
    const visibles = async (token) => (await servidor.pedir('/prospectos', { token })).datos.map((fila) => fila.id)
    assert.ok((await visibles(agente)).includes(lista.registro.id))
    await post(`/admin/clientes/${lista.registro.id}/eliminar`)
    for (const token of [agente, tokens.admin]) assert.ok(!(await visibles(token)).includes(lista.registro.id), 'Cotizaciones Emitidas y dashboard')
    const s = lista.solicitud.id
    for (const [metodo, ruta, token, cuerpo] of [
      ['GET', `/prospectos/${lista.registro.id}`, agente],
      ['GET', `/prospectos/${lista.registro.id}`, tokens.admin],
      ['GET', `/solicitudes/${s}`, agente],
      ['GET', `/solicitudes/${s}`, tokens.admin],
      ['GET', `/agente/solicitudes/${s}/estimacion?precio_venta=150000`, agente],
      ['POST', `/agente/solicitudes/${s}/aprobar`, agente, { precio_venta: 150000 }],
      ['POST', `/agente/solicitudes/${s}/devolver`, agente, { motivo: 'Corregir' }],
      ['PATCH', `/prospectos/${lista.registro.id}`, agente, { nombre: 'Otro' }],
      ['PUT', `/prospectos/${lista.registro.id}/consumo`, agente, { consumo_kwh: 300, ciudad: 'Monterrey', eficiencia: 80 }],
    ]) {
      assert.equal((await servidor.pedir(ruta, { metodo, token, cuerpo })).estado, 404, `${metodo} ${ruta}`)
    }
    assert.equal(uno('SELECT COUNT(*) AS total FROM cotizaciones_versiones WHERE solicitud_id = ?', s).total, 0, 'no se aprobó')
    assert.equal(uno('SELECT estado_flujo FROM solicitudes_cotizacion WHERE id = ?', s).estado_flujo, 'en_preparacion', 'no se devolvió')
  })

  test('correo reservado en la papelera y liberado tras la eliminación definitiva', async () => {
    await registrarSolicitudPrueba(servidor, 'reservado@ejemplo.com')
    const id = idCliente('reservado@ejemplo.com')
    await post(`/admin/clientes/${id}/eliminar`)
    const agente = await servidor.pedir('/solicitudes', {
      metodo: 'POST',
      token: tokens.agente,
      cuerpo: {
        cliente: { nombre: 'Otro', telefono: '8100000000', email: 'reservado@ejemplo.com' },
        direccion: { estado: 'Nuevo León', municipio: 'Monterrey', colonia: 'Centro', codigo_postal: '64000', calle: 'Zaragoza', numero_exterior: '1' },
        modalidad: 'historial_cfe',
        historial_cfe: [{ consumo_kwh: 300, periodo: 'mensual', mes_inicio: '2026-08' }],
        configuracion: { margen_crecimiento_pct: 10, cubrir_baterias: false },
      },
    })
    assert.equal(agente.estado, 409)
    assert.equal(agente.datos.error, 'Ya existe un cliente con ese correo electrónico')
    const personal = await post('/personal', { nombre: 'Persona', email: 'reservado@ejemplo.com', telefono: '8100000000', rol: 'Agente', estado_trabajo_codigo: 'MX-NLE' })
    assert.equal(personal.estado, 409)
    assert.equal(personal.datos.codigo, 'correo_en_papelera')
    assert.match(personal.datos.error, /papelera/)
    assert.equal((await post(`/admin/clientes/${id}/eliminar-definitivamente`, { entiendo: true, confirmacion: 'RESERVADO@ejemplo.com ' })).estado, 200)
    await registrarSolicitudPrueba(servidor, 'reservado@ejemplo.com')
    assert.notEqual(idCliente('reservado@ejemplo.com'), id)
  })

  test('eliminar definitivamente exige la papelera (409), la casilla y el correo', async () => {
    const { registro, solicitud } = await registrarSolicitudPrueba(servidor, 'exige@ejemplo.com')
    assert.equal((await post(`/admin/clientes/${registro.id}/eliminar-definitivamente`, { entiendo: true, confirmacion: 'exige@ejemplo.com' })).estado, 409)
    assert.equal((await post(`/admin/solicitudes/${solicitud.id}/eliminar-definitivamente`, { entiendo: true })).estado, 409)
    await post(`/admin/clientes/${registro.id}/eliminar`)
    assert.equal((await post(`/admin/clientes/${registro.id}/eliminar-definitivamente`, { confirmacion: 'exige@ejemplo.com' })).estado, 400)
    assert.equal((await post(`/admin/clientes/${registro.id}/eliminar-definitivamente`, { entiendo: true, confirmacion: 'otro@ejemplo.com' })).estado, 400)
    assert.ok(uno('SELECT id FROM prospectos WHERE id = ?', registro.id), 'sigue existiendo')
    const respaldos = join(dirname(servidor.base), 'backups')
    const delCliente = existsSync(respaldos) ? readdirSync(respaldos).filter((archivo) => archivo.includes(`cliente-${registro.id}-`)) : []
    assert.equal(delCliente.length, 0, 'sin respaldo si no se confirmó')
  })

  test('eliminación definitiva de un cliente: orden con firmas y órdenes, integridad, respaldo, notificaciones anonimizadas y sus .eml', async () => {
    const { registro, solicitud, correo } = await registrarSolicitudPrueba(servidor, 'definitivo@ejemplo.com', 'Nuevo León', { contrasena: null })
    const aprobacion = await aprobarSolicitudPrueba(servidor, solicitud.id)
    assert.equal(aprobacion.estado, 200)
    const cotizacionId = uno('SELECT id FROM cotizaciones_versiones WHERE solicitud_id = ?', solicitud.id).id
    const cuentaId = uno('SELECT id FROM cuentas_cliente WHERE prospecto_id = ?', registro.id).id
    const revisionId = uno('SELECT id FROM revisiones_tecnicas WHERE solicitud_id = ?', solicitud.id).id
    // Tablas que todavía no usa ninguna ruta, llenadas a mano para probar el orden (hay llaves RESTRICT).
    servidor.sql('INSERT INTO firmas_cotizacion (cotizacion_id, cuenta_cliente_id, firma_png_b64) VALUES (?, ?, ?)', cotizacionId, cuentaId, 'iVBORw0KGgo=')
    servidor.sql("INSERT INTO ordenes_instalacion (cotizacion_id, estatus_obra) VALUES (?, 'asignada')", cotizacionId)
    const ordenId = uno('SELECT id FROM ordenes_instalacion WHERE cotizacion_id = ?', cotizacionId).id
    servidor.sql("INSERT INTO checklist_evidencias (orden_id, etapa) VALUES (?, 'paneles')", ordenId)
    servidor.sql("INSERT INTO mantenimientos_programados (orden_id, tipo_servicio, fecha_limite) VALUES (?, 'anual', '2027-10-01')", ordenId)
    servidor.sql("INSERT INTO revision_tecnica_devoluciones (revision_id, agente_id, motivo) VALUES (?, (SELECT id FROM usuarios_personal WHERE email = 'ventas@atlas.com'), 'Prueba')", revisionId)
    // Un nombre de archivo que intenta salir de data/correos/ se rechaza y el archivo de afuera no se toca.
    const fuera = join(servidor.carpeta, 'fuera.eml')
    writeFileSync(fuera, 'no borrar')
    servidor.sql("INSERT INTO registro_notificaciones (prospecto_id, destinatario_email, tipo_correo, estado_envio, archivo, detalle_error) VALUES (?, 'definitivo@ejemplo.com', 'recordatorio', 'fallido', '../fuera.eml', '550 definitivo@ejemplo.com no existe')", registro.id)
    // Otro cliente con su propio .eml, que debe quedar intacto.
    const otro = await registrarSolicitudPrueba(servidor, 'intacto@ejemplo.com', 'Nuevo León', { contrasena: null })
    const notificacionesCliente = servidor.sqlTodas('SELECT id, tipo_correo, estado_envio, created_at, intentos FROM registro_notificaciones WHERE prospecto_id = ? ORDER BY id', registro.id)
    assert.equal(notificacionesCliente.length, 3)
    const emlCliente = servidor.correos().filter((archivo) => archivo === correo.archivo || archivo === aprobacion.datos.correo.archivo)
    assert.equal(emlCliente.length, 2)

    await post(`/admin/clientes/${registro.id}/eliminar`)
    const vista = (await pedir(`/admin/clientes/${registro.id}`)).datos.impacto.definitivo
    const porTabla = Object.fromEntries(vista.tablas.map((fila) => [fila.tabla, fila.total]))
    assert.deepEqual(porTabla, {
      firmas_cotizacion: 1, checklist_evidencias: 1, mantenimientos_programados: 1, ordenes_instalacion: 1,
      cotizacion_version_items: 2, cotizaciones_versiones: 1, revision_tecnica_items: 2, revision_tecnica_devoluciones: 1,
      revisiones_tecnicas: 1, historial_cfe: 1, solicitudes_cotizacion: 1,
      tokens_cuenta: 1, cuentas_cliente: 1, direcciones_cliente: 1, consumos_prospecto: 1, prospectos: 1,
    })
    assert.equal(vista.notificaciones, 3)

    const respuesta = await post(`/admin/clientes/${registro.id}/eliminar-definitivamente`, { entiendo: true, confirmacion: 'definitivo@ejemplo.com' })
    assert.equal(respuesta.estado, 200, respuesta.texto)
    assert.deepEqual(respuesta.datos.conteo, vista)
    assert.deepEqual(respuesta.datos.correos, { borrados: 2, no_encontrados: 0, rechazados: 1, fallidos: [] })
    assert.ok(existsSync(fuera), 'el archivo fuera de data/correos/ sigue ahí')
    assert.ok(!servidor.correos().some((archivo) => emlCliente.includes(archivo)))
    assert.ok(servidor.correos().includes(otro.correo.archivo), 'el .eml de otro cliente no se toca')

    // Integridad: no queda nada del cliente y no hay llaves huérfanas.
    for (const [tabla, condicion, valor] of [
      ['prospectos', 'id', registro.id], ['cuentas_cliente', 'prospecto_id', registro.id], ['tokens_cuenta', 'cuenta_id', cuentaId],
      ['direcciones_cliente', 'prospecto_id', registro.id], ['consumos_prospecto', 'prospecto_id', registro.id],
      ['solicitudes_cotizacion', 'prospecto_id', registro.id], ['historial_cfe', 'solicitud_id', solicitud.id],
      ['revisiones_tecnicas', 'solicitud_id', solicitud.id], ['revision_tecnica_items', 'revision_id', revisionId],
      ['revision_tecnica_devoluciones', 'revision_id', revisionId], ['cotizaciones_versiones', 'solicitud_id', solicitud.id],
      ['cotizacion_version_items', 'cotizacion_id', cotizacionId], ['firmas_cotizacion', 'cotizacion_id', cotizacionId],
      ['ordenes_instalacion', 'cotizacion_id', cotizacionId], ['checklist_evidencias', 'orden_id', ordenId],
      ['mantenimientos_programados', 'orden_id', ordenId],
    ]) assert.equal(uno(`SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion} = ?`, valor).total, 0, tabla)
    assert.deepEqual(servidor.sqlTodas('PRAGMA foreign_key_check'), [])

    // registro_notificaciones se conserva: sin ids, destinatario anónimo, sin detalle; tipo, estado, fechas e intentos iguales.
    const conservadas = servidor.sqlTodas(`SELECT * FROM registro_notificaciones WHERE id IN (${notificacionesCliente.map((fila) => fila.id).join(',')}) ORDER BY id`)
    assert.equal(conservadas.length, 3)
    conservadas.forEach((fila, indice) => {
      assert.equal(fila.prospecto_id, null)
      assert.equal(fila.solicitud_id, null)
      assert.equal(fila.destinatario_email, `eliminado-${fila.id}@anonimo.invalid`)
      assert.equal(fila.detalle_error, null)
      for (const campo of ['tipo_correo', 'estado_envio', 'created_at', 'intentos']) assert.equal(fila[campo], notificacionesCliente[indice][campo])
    })
    assert.ok(!JSON.stringify(servidor.sqlTodas('SELECT * FROM registro_notificaciones')).includes('definitivo@ejemplo.com'))

    // Respaldo creado antes de borrar, en la carpeta temporal.
    const respaldo = join(dirname(servidor.base), 'backups', respuesta.datos.respaldo)
    assert.ok(existsSync(respaldo) && statSync(respaldo).size > 0)
    assert.equal((await pedir(`/admin/clientes/${registro.id}`)).estado, 404)
  })

  test('si algo falla a mitad de la eliminación definitiva, se deshace todo y no se borra ningún .eml', async () => {
    const { registro, solicitud, correo } = await registrarSolicitudPrueba(servidor, 'rollback@ejemplo.com', 'Nuevo León', { contrasena: null })
    await post(`/admin/clientes/${registro.id}/eliminar`)
    // Falla simulada en el último paso (borrar el prospecto), solo en esta base temporal.
    servidor.sql("CREATE TRIGGER falla_simulada BEFORE DELETE ON prospectos WHEN OLD.email = 'rollback@ejemplo.com' BEGIN SELECT RAISE(ABORT, 'falla simulada'); END")
    const respuesta = await post(`/admin/clientes/${registro.id}/eliminar-definitivamente`, { entiendo: true, confirmacion: 'rollback@ejemplo.com' })
    servidor.sql('DROP TRIGGER falla_simulada')
    assert.equal(respuesta.estado, 500)
    assert.equal(respuesta.datos.error, 'No se pudo completar la eliminación. Se deshizo todo y no se eliminó nada.')
    assert.ok(!respuesta.texto.includes('rollback@ejemplo.com'))
    assert.ok(uno('SELECT id FROM prospectos WHERE id = ? AND eliminado_at IS NOT NULL', registro.id), 'el cliente sigue en la papelera')
    for (const [tabla, condicion, valor] of [['solicitudes_cotizacion', 'id', solicitud.id], ['historial_cfe', 'solicitud_id', solicitud.id], ['cuentas_cliente', 'prospecto_id', registro.id]]) {
      assert.equal(uno(`SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion} = ?`, valor).total, 1, tabla)
    }
    const notificacion = uno('SELECT * FROM registro_notificaciones WHERE prospecto_id = ?', registro.id)
    assert.equal(notificacion.destinatario_email, 'rollback@ejemplo.com', 'no se anonimizó')
    assert.ok(servidor.correos().includes(correo.archivo), 'el .eml no se borró')
    // Con la falla corregida, la misma operación termina bien.
    assert.equal((await post(`/admin/clientes/${registro.id}/eliminar-definitivamente`, { entiendo: true, confirmacion: 'rollback@ejemplo.com' })).estado, 200)
  })

  test('eliminación definitiva de una estimación: el cliente y su otra estimación quedan', async () => {
    const { registro, solicitud } = await registrarSolicitudPrueba(servidor, 'parcial@ejemplo.com')
    const aparte = duplicarSolicitud(solicitud.id)
    servidor.sql("INSERT INTO registro_notificaciones (prospecto_id, solicitud_id, destinatario_email, tipo_correo) VALUES (?, ?, 'parcial@ejemplo.com', 'cotizacion_lista')", registro.id, aparte)
    await post(`/admin/solicitudes/${aparte}/eliminar`)
    const respuesta = await post(`/admin/solicitudes/${aparte}/eliminar-definitivamente`, { entiendo: true })
    assert.equal(respuesta.estado, 200, respuesta.texto)
    assert.equal(uno('SELECT COUNT(*) AS total FROM solicitudes_cotizacion WHERE id = ?', aparte).total, 0)
    assert.ok(uno('SELECT id FROM solicitudes_cotizacion WHERE id = ?', solicitud.id))
    assert.ok(uno('SELECT id FROM prospectos WHERE id = ? AND eliminado_at IS NULL', registro.id))
    const notificacion = uno("SELECT * FROM registro_notificaciones WHERE prospecto_id = ? AND tipo_correo = 'cotizacion_lista'", registro.id)
    assert.equal(notificacion.solicitud_id, null)
    assert.equal(notificacion.destinatario_email, 'parcial@ejemplo.com', 'el cliente sigue existiendo: no se anonimiza')
    assert.deepEqual(servidor.sqlTodas('PRAGMA foreign_key_check'), [])
    assert.equal(idSolicitud('parcial@ejemplo.com'), solicitud.id)
  })
})

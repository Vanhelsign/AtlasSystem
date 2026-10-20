// Pruebas de la desactivación de correos de enlace de acceso ('reemplazado' y 'usado'), independiente del estado de
// envío, y de la migración sobre una base anterior. Base, correos y respaldos temporales. Ejecutar con: npm test
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'

const tokenDe = (correo) => /#crear-contrasena=([A-Za-z0-9_-]{43})/.exec(correo.texto)?.[1]
const CLAVE = 'ClavePropia2026'

describe('correos de enlace desactivados', () => {
  let servidor
  const sesion = {}
  const respuestas = []
  const tokens = []
  const pedir = async (ruta, opciones) => {
    const respuesta = await servidor.pedir(ruta, opciones)
    respuestas.push(respuesta.texto)
    return respuesta
  }
  const leerToken = (archivo) => {
    const token = tokenDe(servidor.leerCorreo(archivo))
    tokens.push(token)
    return token
  }
  const filas = (solicitudId) => servidor.sqlTodas("SELECT id, estado_envio, desactivado_at, desactivado_motivo FROM registro_notificaciones WHERE solicitud_id = ? AND tipo_correo = 'credenciales' ORDER BY id", solicitudId)
  const reenviar = (solicitudId) => pedir(`/solicitudes/${solicitudId}/reenviar-credenciales`, { metodo: 'POST', token: sesion.agente, cuerpo: {} })
  const reintentar = (id) => pedir(`/notificaciones/${id}/reintentar`, { metodo: 'POST', token: sesion.admin, cuerpo: {} })
  const listar = async (consulta = '') => (await pedir(`/notificaciones${consulta}`, { token: sesion.admin })).datos

  before(async () => {
    servidor = await iniciarServidorPrueba()
    assert.ok(resolve(servidor.base).startsWith(resolve(tmpdir())))
    sesion.admin = (await servidor.iniciarSesion('admin@atlas.com')).datos.token
    sesion.agente = (await servidor.iniciarSesion('ventas@atlas.com')).datos.token
  })
  after(() => servidor?.detener())

  test('reenviar desactiva el correo anterior como "reemplazado" sin cambiar su estado de envío', async () => {
    const { solicitud, correo } = await registrarSolicitudPrueba(servidor, 'reenvio@ejemplo.com', 'Nuevo León', { contrasena: null })
    leerToken(correo.archivo)
    assert.deepEqual(filas(solicitud.id).map((fila) => fila.desactivado_motivo), [null])
    const respuesta = await reenviar(solicitud.id)
    leerToken(respuesta.datos.correo.archivo)
    const [anterior, nueva] = filas(solicitud.id)
    assert.equal(anterior.desactivado_motivo, 'reemplazado')
    assert.ok(anterior.desactivado_at)
    assert.equal(anterior.estado_envio, 'pendiente', 'el estado de envío no cambia')
    assert.equal(nueva.desactivado_motivo, null)
    // Lo devuelven ambas rutas: el detalle del agente y la pantalla del administrador.
    const detalle = (await pedir(`/solicitudes/${solicitud.id}/notificaciones`, { token: sesion.agente })).datos.notificaciones
    assert.deepEqual(detalle.map((fila) => [fila.id, fila.desactivado, fila.motivo_desactivacion]), [[nueva.id, false, null], [anterior.id, true, 'reemplazado']])
    assert.ok(detalle.every((fila) => !('desactivado_at' in fila)))
    const lista = (await listar()).notificaciones.find((fila) => fila.id === anterior.id)
    assert.deepEqual([lista.desactivado, lista.motivo_desactivacion, lista.estado], [true, 'reemplazado', 'pendiente'])
  })

  test('reintentar una de credenciales reutiliza su fila y desactiva las demás vigentes', async () => {
    const { solicitud, correo } = await registrarSolicitudPrueba(servidor, 'reintento@ejemplo.com', 'Nuevo León', { contrasena: null })
    leerToken(correo.archivo)
    leerToken((await reenviar(solicitud.id)).datos.correo.archivo)
    const [, segunda] = filas(solicitud.id)
    // La vigente falla; al reintentarla queda vigente con el enlace nuevo y la anterior sigue reemplazada.
    servidor.sql("UPDATE registro_notificaciones SET estado_envio = 'fallido', detalle_error = 'Falla simulada' WHERE id = ?", segunda.id)
    // Una más antigua marcada a mano como vigente (caso de datos previos) debe quedar reemplazada al reintentar.
    servidor.sql('UPDATE registro_notificaciones SET desactivado_at = NULL, desactivado_motivo = NULL WHERE id = ?', filas(solicitud.id)[0].id)
    const respuesta = await reintentar(segunda.id)
    assert.equal(respuesta.estado, 200, respuesta.texto)
    leerToken(respuesta.datos.correo.archivo)
    const [primera, reintentada] = filas(solicitud.id)
    assert.equal(primera.desactivado_motivo, 'reemplazado')
    assert.equal(reintentada.desactivado_motivo, null)
    assert.equal(respuesta.datos.notificacion.desactivado, false)
  })

  test('crear la contraseña con el enlace marca "usado" el correo vigente', async () => {
    const { solicitud, correo } = await registrarSolicitudPrueba(servidor, 'usado@ejemplo.com', 'Nuevo León', { contrasena: null })
    leerToken(correo.archivo)
    const token = leerToken((await reenviar(solicitud.id)).datos.correo.archivo)
    assert.equal((await servidor.pedir('/portal/crear-contrasena', { metodo: 'POST', cuerpo: { token, nueva: CLAVE, confirmacion: CLAVE } })).estado, 200)
    assert.deepEqual(filas(solicitud.id).map((fila) => fila.desactivado_motivo), ['reemplazado', 'usado'])
  })

  test('cambiar la contraseña por cualquier vía invalida el enlace pendiente y marca "usado" su correo', async () => {
    // registrarSolicitudPrueba deja la contraseña 123 (como las cuentas anteriores a la 4a), pero el registro ya
    // emitió un enlace y su correo; ese enlace pendiente es el que debe dejar de servir.
    for (const [email, cambioObligatorio] of [['crea-nueva@ejemplo.com', true], ['cambiar@ejemplo.com', false]]) {
      const { solicitud, correo } = await registrarSolicitudPrueba(servidor, email)
      const token = leerToken(correo.archivo)
      // true: pantalla "Crea tu nueva contraseña" (marca activa); false: "Cambiar contraseña" en Datos personales.
      if (cambioObligatorio) servidor.sql('UPDATE cuentas_cliente SET debe_cambiar_password = 1 WHERE email = ?', email)
      assert.deepEqual((await servidor.pedir('/portal/validar-enlace', { metodo: 'POST', cuerpo: { token } })).datos, { valido: true })
      const sesionCliente = (await servidor.iniciarSesion(email)).datos
      assert.equal(sesionCliente.debe_cambiar_password, cambioObligatorio)
      const cambio = await pedir('/portal/cambiar-contrasena', { metodo: 'POST', token: sesionCliente.token, cuerpo: { actual: '123', nueva: CLAVE, confirmacion: CLAVE } })
      assert.equal(cambio.estado, 200, cambio.texto)
      assert.equal((await servidor.pedir('/portal/validar-enlace', { metodo: 'POST', cuerpo: { token } })).datos.codigo, 'enlace_invalido', email)
      const usarEnlace = await servidor.pedir('/portal/crear-contrasena', { metodo: 'POST', cuerpo: { token, nueva: 'OtraClave2026', confirmacion: 'OtraClave2026' } })
      assert.equal(usarEnlace.datos.codigo, 'enlace_invalido')
      assert.equal((await servidor.iniciarSesion(email, CLAVE)).estado, 200, 'la contraseña elegida sigue siendo la válida')
      assert.deepEqual(filas(solicitud.id).map((fila) => fila.desactivado_motivo), ['usado'], email)
      const tokenGuardado = servidor.sqlTodas('SELECT usado_at, expira_at <= datetime(\'now\') AS vencido FROM tokens_cuenta t JOIN cuentas_cliente c ON c.id = t.cuenta_id WHERE c.email = ?', email)
      assert.deepEqual(tokenGuardado.map((fila) => ({ ...fila })), [{ usado_at: null, vencido: 1 }], 'se invalida sin borrarlo')
    }
  })

  test('409 al reintentar un correo desactivado aunque esté fallido; sin botón en la lista', async () => {
    const { solicitud, correo } = await registrarSolicitudPrueba(servidor, 'desactivado@ejemplo.com', 'Nuevo León', { contrasena: null })
    leerToken(correo.archivo)
    leerToken((await reenviar(solicitud.id)).datos.correo.archivo)
    const [reemplazada, vigente] = filas(solicitud.id)
    servidor.sql("UPDATE registro_notificaciones SET estado_envio = 'fallido' WHERE id IN (?, ?)", reemplazada.id, vigente.id)
    const respuesta = await reintentar(reemplazada.id)
    assert.equal(respuesta.estado, 409)
    assert.match(respuesta.datos.error, /se reemplazó por uno más reciente/)
    assert.equal(servidor.sqlTodas('SELECT intentos FROM registro_notificaciones WHERE id = ?', reemplazada.id)[0].intentos, 1, 'no se envió')
    const lista = (await listar('?estado=fallido')).notificaciones
    assert.equal(lista.find((fila) => fila.id === reemplazada.id).puede_reintentar, false)
    assert.equal(lista.find((fila) => fila.id === vigente.id).puede_reintentar, true)
    // Usado: también 409.
    const usado = await registrarSolicitudPrueba(servidor, 'usado2@ejemplo.com', 'Nuevo León', { contrasena: null })
    const token = leerToken(usado.correo.archivo)
    await servidor.pedir('/portal/crear-contrasena', { metodo: 'POST', cuerpo: { token, nueva: CLAVE, confirmacion: CLAVE } })
    const id = filas(usado.solicitud.id)[0].id
    servidor.sql("UPDATE registro_notificaciones SET estado_envio = 'fallido' WHERE id = ?", id)
    const respuestaUsado = await reintentar(id)
    assert.equal(respuestaUsado.estado, 409)
    assert.match(respuestaUsado.datos.error, /ya se usó para crear la contraseña/)
  })

  test('filtro "Enlace": vigente y desactivado, solo de enlaces de acceso; valor no válido 400', async () => {
    const vigentes = (await listar('?enlace=vigente')).notificaciones
    const desactivados = (await listar('?enlace=desactivado')).notificaciones
    assert.ok(vigentes.length > 0 && desactivados.length > 0)
    assert.ok(vigentes.every((fila) => fila.tipo === 'credenciales' && !fila.desactivado))
    assert.ok(desactivados.every((fila) => fila.tipo === 'credenciales' && fila.desactivado))
    const total = servidor.sqlTodas("SELECT COUNT(*) AS total FROM registro_notificaciones WHERE tipo_correo = 'credenciales' AND desactivado_at IS NOT NULL")[0].total
    assert.equal((await listar('?enlace=desactivado')).total, total)
    assert.equal((await listar('?enlace=vigente&tipo=cotizacion_lista')).total, 0)
    // Un cliente en la papelera ya no tiene un enlace que funcione: su correo no sale como vigente.
    const enPapelera = await registrarSolicitudPrueba(servidor, 'vigente-papelera@ejemplo.com', 'Nuevo León', { contrasena: null })
    leerToken(enPapelera.correo.archivo)
    assert.ok((await listar('?enlace=vigente')).notificaciones.some((fila) => fila.id === enPapelera.correo.id))
    await pedir(`/admin/clientes/${enPapelera.registro.id}/eliminar`, { metodo: 'POST', token: sesion.admin, cuerpo: {} })
    const vigentesDespues = await listar('?enlace=vigente')
    assert.ok(!vigentesDespues.notificaciones.some((fila) => fila.id === enPapelera.correo.id))
    assert.equal(vigentesDespues.total, vigentesDespues.notificaciones.length, 'el total usa la misma condición')
    assert.equal((await pedir('/notificaciones?enlace=otro', { token: sesion.admin })).estado, 400)
  })

  test('ninguna respuesta ni registro contiene tokens, enlaces ni fechas de expiración', () => {
    assert.ok(tokens.length >= 8)
    const registros = JSON.stringify(servidor.sqlTodas('SELECT * FROM registro_notificaciones'))
    for (const texto of [respuestas.join('\n'), registros, servidor.salida()]) {
      for (const token of tokens) assert.ok(!texto.includes(token))
      assert.doesNotMatch(texto, /crear-contrasena=|expira/)
    }
  })
})

describe('migración de una base anterior a la desactivación', () => {
  let carpeta
  after(() => carpeta && rmSync(carpeta, { recursive: true, force: true }))

  test('agrega las columnas, marca "reemplazado" con la fecha del siguiente correo y conserva todos los datos', async () => {
    // 1. Base con datos creada con la versión actual, copiada a una carpeta temporal propia.
    const origen = await iniciarServidorPrueba()
    carpeta = mkdtempSync(join(tmpdir(), 'atlas-migracion-'))
    const copia = join(carpeta, 'atlas.sqlite')
    let ids
    try {
      const agente = (await origen.iniciarSesion('ventas@atlas.com')).datos.token
      const a = await registrarSolicitudPrueba(origen, 'migra-a@ejemplo.com', 'Nuevo León', { contrasena: null })
      for (let i = 0; i < 2; i++) await origen.pedir(`/solicitudes/${a.solicitud.id}/reenviar-credenciales`, { metodo: 'POST', token: agente, cuerpo: {} })
      const b = await registrarSolicitudPrueba(origen, 'migra-b@ejemplo.com', 'Nuevo León', { contrasena: null })
      ids = { a: a.solicitud.id, b: b.solicitud.id }
      origen.sql(`VACUUM INTO '${copia.replaceAll("'", "''")}'`)
    } finally {
      await origen.detener()
    }
    // 2. Se quitan las columnas para simular la base anterior; las fechas se separan para verificar cuál se copia.
    const db = new DatabaseSync(copia)
    db.exec('ALTER TABLE registro_notificaciones DROP COLUMN desactivado_motivo')
    db.exec('ALTER TABLE registro_notificaciones DROP COLUMN desactivado_at')
    const filasA = db.prepare("SELECT id FROM registro_notificaciones WHERE solicitud_id = ? AND tipo_correo = 'credenciales' ORDER BY id").all(ids.a).map((fila) => fila.id)
    filasA.forEach((id, indice) => db.prepare('UPDATE registro_notificaciones SET created_at = ? WHERE id = ?').run(`2026-10-0${indice + 1} 10:00:00`, id))
    // Una notificación anonimizada (sin prospecto) no se puede relacionar con una cuenta.
    db.prepare("INSERT INTO registro_notificaciones (destinatario_email, tipo_correo, estado_envio) VALUES ('eliminado-1@anonimo.invalid', 'credenciales', 'aceptado')").run()
    const antes = db.prepare('SELECT * FROM registro_notificaciones ORDER BY id').all()
    db.close()
    // El ayudante consulta la base de su propia carpeta; aquí se lee la copia directamente.
    const leer = (consulta, ...parametros) => {
      const conexion = new DatabaseSync(copia, { readOnly: true })
      // Objetos normales (node:sqlite los devuelve sin prototipo) para compararlos con deepEqual.
      try { return conexion.prepare(consulta).all(...parametros).map((fila) => ({ ...fila })) } finally { conexion.close() }
    }

    // 3. El servidor arranca sobre la base anterior y aplica la migración.
    const migrado = await iniciarServidorPrueba({ ATLAS_DB_PATH: copia })
    try {
      const despues = leer('SELECT * FROM registro_notificaciones ORDER BY id')
      assert.equal(despues.length, antes.length)
      despues.forEach((fila, indice) => {
        const { desactivado_at: fecha, desactivado_motivo: motivo, ...resto } = fila
        assert.deepEqual(resto, { ...antes[indice] }, 'el resto de cada fila no cambia')
        void fecha
        void motivo
      })
      const marcas = (solicitudId) => leer("SELECT desactivado_motivo, desactivado_at FROM registro_notificaciones WHERE solicitud_id = ? AND tipo_correo = 'credenciales' ORDER BY id", solicitudId)
      assert.deepEqual(marcas(ids.a), [
        { desactivado_motivo: 'reemplazado', desactivado_at: '2026-10-02 10:00:00' },
        { desactivado_motivo: 'reemplazado', desactivado_at: '2026-10-03 10:00:00' },
        { desactivado_motivo: null, desactivado_at: null },
      ])
      assert.deepEqual(marcas(ids.b).map((fila) => fila.desactivado_motivo), [null], 'una sola: vigente')
      assert.equal(leer("SELECT COUNT(*) AS total FROM registro_notificaciones WHERE desactivado_motivo = 'usado'")[0].total, 0, 'no se marca usado retroactivamente')
      assert.equal(leer("SELECT desactivado_motivo FROM registro_notificaciones WHERE destinatario_email = 'eliminado-1@anonimo.invalid'")[0].desactivado_motivo, null)
      assert.deepEqual(leer('PRAGMA foreign_key_check'), [])
    } finally {
      await migrado.detener()
    }
    // La segunda vez no recalcula (la columna ya existe): una marca quitada a mano no vuelve a aparecer.
    const db2 = new DatabaseSync(copia)
    db2.prepare('UPDATE registro_notificaciones SET desactivado_at = NULL, desactivado_motivo = NULL').run()
    db2.close()
    const otraVez = await iniciarServidorPrueba({ ATLAS_DB_PATH: copia })
    try {
      assert.equal(leer('SELECT COUNT(*) AS total FROM registro_notificaciones WHERE desactivado_motivo IS NOT NULL')[0].total, 0)
    } finally {
      await otraVez.detener()
    }
  })
})

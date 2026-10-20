// Pruebas de la Fase 4b: reenvío del enlace de acceso, pantalla de Notificaciones (administrador) y correos en el
// detalle del agente. Base, correos y respaldos en carpetas temporales; los SMTP son servidores falsos locales.
// Ejecutar con: npm test
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { aprobarSolicitudPrueba, iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'
import { smtpFalso } from './pruebas/smtpFalso.js'

const tokenDe = (correo) => /#crear-contrasena=([A-Za-z0-9_-]{43})/.exec(correo.texto)?.[1]
const CLAVE = 'ClavePropia2026'

describe('modo simulado: reenvío, notificaciones y permisos', () => {
  let servidor
  const sesion = {}
  const respuestas = []
  const tokensVistos = []
  // Todas las respuestas se guardan para comprobar al final que ninguna contiene un token ni un enlace.
  const pedir = async (ruta, opciones) => {
    const respuesta = await servidor.pedir(ruta, opciones)
    respuestas.push(respuesta.texto)
    return respuesta
  }
  const reenviar = (solicitudId, token = sesion.agente) => pedir(`/solicitudes/${solicitudId}/reenviar-credenciales`, { metodo: 'POST', token, cuerpo: {} })
  const correosDe = (solicitudId, token = sesion.agente) => pedir(`/solicitudes/${solicitudId}/notificaciones`, { token })
  const reintentar = (id) => pedir(`/notificaciones/${id}/reintentar`, { metodo: 'POST', token: sesion.admin, cuerpo: {} })
  // Lee el token del .eml que indicó la respuesta (el reintento reutiliza la fila, así que el nombre no es el último).
  const ultimoToken = (archivo) => {
    const token = tokenDe(servidor.leerCorreo(archivo))
    tokensVistos.push(token)
    return token
  }
  const validar = (token) => servidor.pedir('/portal/validar-enlace', { metodo: 'POST', cuerpo: { token } })
  const fila = (id) => servidor.sqlTodas('SELECT * FROM registro_notificaciones WHERE id = ?', id)[0]
  const clienteNuevo = async (email) => {
    const datos = await registrarSolicitudPrueba(servidor, email, 'Nuevo León', { contrasena: null })
    ultimoToken(datos.correo.archivo)
    return datos
  }

  before(async () => {
    servidor = await iniciarServidorPrueba()
    for (const ruta of [servidor.base, servidor.carpetaCorreos, dirname(servidor.base)]) {
      assert.ok(resolve(ruta).startsWith(resolve(tmpdir())), `${ruta} debe estar en la carpeta temporal`)
    }
    sesion.admin = (await servidor.iniciarSesion('admin@atlas.com')).datos.token
    sesion.agente = (await servidor.iniciarSesion('ventas@atlas.com')).datos.token
    sesion.tecnico = (await servidor.iniciarSesion('tecnico@atlas.com')).datos.token
    const alta = await servidor.pedir('/personal', { metodo: 'POST', token: sesion.admin, cuerpo: { nombre: 'Otra Agente', email: 'otra.agente@ejemplo.com', telefono: '8100000000', rol: 'Agente', estado_trabajo_codigo: 'MX-NLE' } })
    assert.equal(alta.estado, 201, alta.texto)
    sesion.otroAgente = (await servidor.iniciarSesion('otra.agente@ejemplo.com')).datos.token
  })
  after(() => servidor?.detener())

  test('reenvío válido: notificación nueva, el enlace anterior deja de servir y el nuevo sí', async () => {
    const { solicitud } = await clienteNuevo('reenvio@ejemplo.com')
    const anterior = tokensVistos.at(-1)
    const respuesta = await reenviar(solicitud.id)
    assert.equal(respuesta.estado, 200, respuesta.texto)
    assert.equal(respuesta.datos.correo.estado, 'pendiente')
    assert.match(respuesta.datos.correo.archivo, /-credenciales-\d+\.eml$/)
    const nuevo = ultimoToken(respuesta.datos.correo.archivo)
    assert.notEqual(nuevo, anterior)
    assert.equal((await validar(anterior)).datos.codigo, 'enlace_invalido')
    assert.deepEqual((await validar(nuevo)).datos, { valido: true })
    const registros = servidor.sqlTodas("SELECT * FROM registro_notificaciones WHERE solicitud_id = ? AND tipo_correo = 'credenciales'", solicitud.id)
    assert.equal(registros.length, 2, 'una fila por envío')
  })

  test('detalle del agente: correos de la solicitud y acceso pendiente; el administrador también los ve', async () => {
    const { solicitud } = await clienteNuevo('detalle@ejemplo.com')
    for (const token of [sesion.agente, sesion.admin]) {
      const respuesta = await correosDe(solicitud.id, token)
      assert.equal(respuesta.estado, 200)
      assert.equal(respuesta.datos.acceso_pendiente, true)
      assert.deepEqual(respuesta.datos.notificaciones.map((correo) => [correo.tipo_correo, correo.estado_envio, correo.intentos]), [['credenciales', 'pendiente', 1]])
    }
  })

  test('permisos: técnico 403, otro agente 404 (como el detalle) y sin sesión 401', async () => {
    const { solicitud } = await clienteNuevo('permisos@ejemplo.com')
    for (const ruta of [`/solicitudes/${solicitud.id}/reenviar-credenciales`, `/solicitudes/${solicitud.id}/notificaciones`]) {
      const metodo = ruta.endsWith('reenviar-credenciales') ? 'POST' : 'GET'
      const cuerpo = metodo === 'POST' ? {} : undefined
      assert.equal((await pedir(ruta, { metodo, cuerpo })).estado, 401, ruta)
      assert.equal((await pedir(ruta, { metodo, cuerpo, token: sesion.tecnico })).estado, 403, ruta)
      assert.equal((await pedir(ruta, { metodo, cuerpo, token: sesion.otroAgente })).estado, 404, ruta)
    }
    for (const [metodo, ruta] of [['GET', '/notificaciones'], ['POST', '/notificaciones/1/reintentar']]) {
      const cuerpo = metodo === 'POST' ? {} : undefined
      for (const token of [sesion.agente, sesion.tecnico]) assert.equal((await pedir(ruta, { metodo, cuerpo, token })).estado, 403, ruta)
    }
    assert.equal(servidor.sqlTodas('SELECT COUNT(*) AS total FROM registro_notificaciones WHERE solicitud_id = ?', solicitud.id)[0].total, 1, 'nadie sin permiso reenvió')
  })

  test('el agente solo ve los correos de sus solicitudes', async () => {
    const otra = (await servidor.iniciarSesion('otra.agente@ejemplo.com')).datos.token
    const registro = await pedir('/solicitudes', {
      metodo: 'POST',
      token: otra,
      cuerpo: {
        cliente: { nombre: 'Cliente de otra agente', telefono: '8100000000', email: 'ajeno@ejemplo.com' },
        direccion: { estado: 'Nuevo León', municipio: 'Monterrey', colonia: 'Centro', codigo_postal: '64000', calle: 'Zaragoza', numero_exterior: '1' },
        modalidad: 'historial_cfe',
        historial_cfe: [{ consumo_kwh: 300, periodo: 'mensual', mes_inicio: '2026-08' }],
        configuracion: { margen_crecimiento_pct: 10, cubrir_baterias: false },
      },
    })
    assert.equal(registro.estado, 201)
    ultimoToken(registro.datos.correo.archivo)
    assert.equal((await correosDe(registro.datos.solicitud.id, sesion.agente)).estado, 404)
    assert.equal((await correosDe(registro.datos.solicitud.id, otra)).estado, 200)
  })

  test('409 si el cliente ya creó su contraseña; el botón deja de ofrecerse', async () => {
    const { solicitud } = await clienteNuevo('creada@ejemplo.com')
    const creada = await servidor.pedir('/portal/crear-contrasena', { metodo: 'POST', cuerpo: { token: tokensVistos.at(-1), nueva: CLAVE, confirmacion: CLAVE } })
    assert.equal(creada.estado, 200)
    const respuesta = await reenviar(solicitud.id)
    assert.equal(respuesta.estado, 409)
    assert.equal(respuesta.datos.codigo, 'acceso_creado')
    assert.match(respuesta.datos.error, /ya creó su contraseña/)
    assert.equal((await correosDe(solicitud.id)).datos.acceso_pendiente, false)
  })

  test('404 si el cliente o la solicitud están en la papelera', async () => {
    const cliente = await clienteNuevo('papelera@ejemplo.com')
    await pedir(`/admin/clientes/${cliente.registro.id}/eliminar`, { metodo: 'POST', token: sesion.admin, cuerpo: {} })
    assert.equal((await reenviar(cliente.solicitud.id)).estado, 404)
    assert.equal((await correosDe(cliente.solicitud.id)).estado, 404)
    assert.equal((await correosDe(cliente.solicitud.id, sesion.admin)).estado, 404)
    const estimacion = await clienteNuevo('estimacion@ejemplo.com')
    await pedir(`/admin/solicitudes/${estimacion.solicitud.id}/eliminar`, { metodo: 'POST', token: sesion.admin, cuerpo: {} })
    assert.equal((await reenviar(estimacion.solicitud.id)).estado, 404)
  })

  test('límite: 3 envíos por hora por cuenta (reenvío y reintento suman) y 429 con mensaje claro', async () => {
    const { solicitud } = await clienteNuevo('limite@ejemplo.com')
    for (const token of [sesion.agente, sesion.admin]) {
      const respuesta = await reenviar(solicitud.id, token)
      assert.equal(respuesta.estado, 200)
      ultimoToken(respuesta.datos.correo.archivo)
    }
    // El tercero es un reintento de una notificación fallida de la misma cuenta.
    const ultima = servidor.sqlTodas('SELECT MAX(id) AS id FROM registro_notificaciones WHERE solicitud_id = ?', solicitud.id)[0].id
    servidor.sql("UPDATE registro_notificaciones SET estado_envio = 'fallido', detalle_error = 'Falla simulada' WHERE id = ?", ultima)
    const reintento = await reintentar(ultima)
    assert.equal(reintento.estado, 200)
    ultimoToken(reintento.datos.correo.archivo)
    const bloqueado = await reenviar(solicitud.id)
    assert.equal(bloqueado.estado, 429)
    assert.equal(bloqueado.datos.codigo, 'limite_reenvio')
    assert.match(bloqueado.datos.error, /^Ya se enviaron 3 correos a esta cuenta en la última hora\. Espera \d+ minutos e inténtalo de nuevo\.$/)
    // Otra cuenta no se afecta.
    const otra = await clienteNuevo('limite.otra@ejemplo.com')
    const deOtra = await reenviar(otra.solicitud.id)
    assert.equal(deOtra.estado, 200)
    ultimoToken(deOtra.datos.correo.archivo)
  })

  test('reintento de credenciales fallidas: misma fila, intentos + 1 y token nuevo; el anterior deja de servir', async () => {
    const { solicitud } = await clienteNuevo('reintento@ejemplo.com')
    const anterior = tokensVistos.at(-1)
    const id = servidor.sqlTodas('SELECT id FROM registro_notificaciones WHERE solicitud_id = ?', solicitud.id)[0].id
    assert.equal((await reintentar(id)).estado, 409, 'no está fallida')
    servidor.sql("UPDATE registro_notificaciones SET estado_envio = 'fallido', detalle_error = 'Falla simulada' WHERE id = ?", id)
    const respuesta = await reintentar(id)
    assert.equal(respuesta.estado, 200, respuesta.texto)
    assert.equal(respuesta.datos.correo.estado, 'pendiente')
    assert.equal(respuesta.datos.notificacion.intentos, 2)
    assert.equal(fila(id).intentos, 2)
    assert.equal(servidor.sqlTodas('SELECT COUNT(*) AS total FROM registro_notificaciones WHERE solicitud_id = ?', solicitud.id)[0].total, 1, 'no crea otra fila')
    const nuevo = ultimoToken(respuesta.datos.correo.archivo)
    assert.equal((await validar(anterior)).datos.codigo, 'enlace_invalido')
    assert.deepEqual((await validar(nuevo)).datos, { valido: true })
  })

  test('reintento de "cotización lista" fallida reenvía el aviso', async () => {
    const { solicitud } = await registrarSolicitudPrueba(servidor, 'aviso@ejemplo.com')
    assert.equal((await aprobarSolicitudPrueba(servidor, solicitud.id)).estado, 200)
    const id = servidor.sqlTodas("SELECT id FROM registro_notificaciones WHERE solicitud_id = ? AND tipo_correo = 'cotizacion_lista'", solicitud.id)[0].id
    servidor.sql("UPDATE registro_notificaciones SET estado_envio = 'fallido' WHERE id = ?", id)
    const respuesta = await reintentar(id)
    assert.equal(respuesta.estado, 200, respuesta.texto)
    assert.match(respuesta.datos.correo.archivo, /-cotizacion_lista-\d+\.eml$/)
    assert.equal(fila(id).intentos, 2)
  })

  test('sin reintento para clientes en la papelera o eliminados definitivamente; estos salen anonimizados', async () => {
    const enPapelera = await clienteNuevo('sinreintento@ejemplo.com')
    const eliminado = await clienteNuevo('borrado@ejemplo.com')
    for (const { solicitud } of [enPapelera, eliminado]) servidor.sql("UPDATE registro_notificaciones SET estado_envio = 'fallido', detalle_error = 'Falla simulada' WHERE solicitud_id = ?", solicitud.id)
    const idPapelera = servidor.sqlTodas('SELECT id FROM registro_notificaciones WHERE solicitud_id = ?', enPapelera.solicitud.id)[0].id
    const idEliminado = servidor.sqlTodas('SELECT id FROM registro_notificaciones WHERE solicitud_id = ?', eliminado.solicitud.id)[0].id
    for (const { registro } of [enPapelera, eliminado]) await pedir(`/admin/clientes/${registro.id}/eliminar`, { metodo: 'POST', token: sesion.admin, cuerpo: {} })
    const definitivo = await pedir(`/admin/clientes/${eliminado.registro.id}/eliminar-definitivamente`, { metodo: 'POST', token: sesion.admin, cuerpo: { entiendo: true, confirmacion: 'borrado@ejemplo.com' } })
    assert.equal(definitivo.estado, 200)
    assert.match((await reintentar(idPapelera)).datos.error, /papelera/)
    const sinCliente = await reintentar(idEliminado)
    assert.equal(sinCliente.estado, 409)
    assert.ok(!sinCliente.texto.includes('borrado@ejemplo.com'))
    const lista = (await pedir('/notificaciones?estado=fallido', { token: sesion.admin })).datos.notificaciones
    const papelera = lista.find((correo) => correo.id === idPapelera)
    const anonima = lista.find((correo) => correo.id === idEliminado)
    assert.equal(papelera.cliente, 'papelera')
    assert.equal(papelera.puede_reintentar, false)
    assert.deepEqual(
      { cliente: anonima.cliente, destinatario: anonima.destinatario, nombre: anonima.cliente_nombre, detalle: anonima.detalle, solicitud: anonima.solicitud_id, puede: anonima.puede_reintentar },
      { cliente: 'eliminado', destinatario: `eliminado-${idEliminado}@anonimo.invalid`, nombre: null, detalle: null, solicitud: null, puede: false },
    )
    assert.ok(!JSON.stringify(lista).includes('borrado@ejemplo.com'))
  })

  test('pantalla Notificaciones: filtros, paginación de 50 y validación', async () => {
    const todas = await pedir('/notificaciones', { token: sesion.admin })
    assert.equal(todas.estado, 200)
    assert.equal(todas.datos.por_pagina, 50)
    assert.equal(todas.datos.total, servidor.sqlTodas('SELECT COUNT(*) AS total FROM registro_notificaciones')[0].total)
    const ids = todas.datos.notificaciones.map((correo) => correo.id)
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'más recientes primero')
    const credenciales = (await pedir('/notificaciones?tipo=credenciales&estado=pendiente', { token: sesion.admin })).datos
    assert.ok(credenciales.notificaciones.length > 0)
    assert.ok(credenciales.notificaciones.every((correo) => correo.tipo === 'credenciales' && correo.estado === 'pendiente'))
    for (const consulta of ['?estado=raro', '?tipo=otro', '?pagina=0', '?pagina=x']) assert.equal((await pedir(`/notificaciones${consulta}`, { token: sesion.admin })).estado, 400, consulta)
    // Más de 50: la segunda página trae el resto.
    for (let i = 0; i < 55; i++) servidor.sql("INSERT INTO registro_notificaciones (destinatario_email, tipo_correo, estado_envio) VALUES ('relleno@ejemplo.com', 'recordatorio', 'aceptado')")
    const primera = (await pedir('/notificaciones?tipo=recordatorio', { token: sesion.admin })).datos
    const segunda = (await pedir('/notificaciones?tipo=recordatorio&pagina=2', { token: sesion.admin })).datos
    assert.equal(primera.notificaciones.length, 50)
    assert.equal(segunda.notificaciones.length, primera.total - 50)
    assert.ok(primera.notificaciones.every((correo) => !correo.puede_reintentar))
  })

  test('ningún token ni enlace en respuestas, registro_notificaciones, tokens_cuenta ni consola', () => {
    assert.ok(tokensVistos.length >= 10)
    const registros = JSON.stringify(servidor.sqlTodas('SELECT * FROM registro_notificaciones'))
    const tokens = JSON.stringify(servidor.sqlTodas('SELECT * FROM tokens_cuenta'))
    const textos = [respuestas.join('\n'), registros, tokens, servidor.salida()]
    for (const token of tokensVistos) for (const texto of textos) assert.ok(!texto.includes(token))
    for (const texto of textos) assert.doesNotMatch(texto, /crear-contrasena=/)
  })
})

describe('SMTP real: un reintento convierte un fallido en aceptado', () => {
  test('falla con el servidor rechazando y se acepta al reintentar', async () => {
    const smtp = await smtpFalso('rechaza')
    const servidor = await iniciarServidorPrueba({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.puerto) })
    try {
      const { solicitud, correo } = await registrarSolicitudPrueba(servidor, 'smtp@ejemplo.com', 'Nuevo León', { contrasena: null })
      assert.equal(correo.estado, 'fallido')
      const admin = (await servidor.iniciarSesion('admin@atlas.com')).datos.token
      const lista = (await servidor.pedir('/notificaciones?estado=fallido', { token: admin })).datos.notificaciones
      assert.equal(lista.length, 1)
      assert.equal(lista[0].puede_reintentar, true)
      smtp.cambiarModo('acepta')
      const respuesta = await servidor.pedir(`/notificaciones/${correo.id}/reintentar`, { metodo: 'POST', token: admin, cuerpo: {} })
      assert.equal(respuesta.estado, 200, respuesta.texto)
      assert.deepEqual(respuesta.datos.correo, { id: correo.id, estado: 'aceptado', simulado: false })
      const fila = servidor.sqlTodas('SELECT * FROM registro_notificaciones WHERE id = ?', correo.id)[0]
      assert.equal(fila.estado_envio, 'aceptado')
      assert.equal(fila.intentos, 2)
      assert.ok(fila.enviado_at)
      assert.equal(fila.solicitud_id, solicitud.id)
      // El correo aceptado lleva el enlace nuevo; ni la respuesta ni la base lo contienen.
      const token = /#crear-contrasena=3D([A-Za-z0-9_-]{43})|#crear-contrasena=([A-Za-z0-9_-]{43})/.exec(smtp.recibidos.at(-1).replace(/=\r\n/g, ''))
      const valor = token?.[1] ?? token?.[2]
      assert.ok(valor)
      assert.ok(!respuesta.texto.includes(valor) && !JSON.stringify(fila).includes(valor))
      assert.deepEqual((await servidor.pedir('/portal/validar-enlace', { metodo: 'POST', cuerpo: { token: valor } })).datos, { valido: true })
    } finally {
      await servidor.detener()
      await smtp.cerrar()
    }
  })
})

// Pruebas de las notificaciones por correo con la API real sobre una base temporal y correos en una carpeta
// temporal (nunca data/atlas.sqlite ni data/correos/). Los SMTP son servidores falsos locales. Ejecutar con: npm test
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'

const tokenDelCorreo = (correo) => /#crear-contrasena=([A-Za-z0-9_-]{43})/.exec(correo.texto)?.[1]
const notificaciones = (servidor) => servidor.sqlTodas('SELECT * FROM registro_notificaciones ORDER BY id')

// SMTP mínimo: responde según `modo` ('acepta', 'rechaza' destinatario o 'mudo' sin saludo).
async function smtpFalso(modo) {
  const recibidos = []
  const servidor = createServer((socket) => {
    if (modo === 'mudo') return
    let enDatos = false
    let datos = ''
    let pendiente = ''
    socket.write('220 smtp.falso ESMTP\r\n')
    socket.on('data', (trozo) => {
      pendiente += trozo.toString('utf8')
      if (enDatos) {
        const fin = pendiente.indexOf('\r\n.\r\n')
        if (fin === -1) return
        datos += pendiente.slice(0, fin)
        pendiente = pendiente.slice(fin + 5)
        enDatos = false
        recibidos.push(datos)
        socket.write('250 2.0.0 Aceptado\r\n')
      }
      let salto
      while (!enDatos && (salto = pendiente.indexOf('\r\n')) !== -1) {
        const linea = pendiente.slice(0, salto)
        pendiente = pendiente.slice(salto + 2)
        const comando = linea.slice(0, 4).toUpperCase()
        if (comando === 'EHLO' || comando === 'HELO') socket.write('250 smtp.falso\r\n')
        else if (comando === 'MAIL') socket.write('250 OK\r\n')
        else if (comando === 'RCPT') socket.write(modo === 'rechaza' ? '550 5.1.1 Buzón inexistente\r\n' : '250 OK\r\n')
        else if (comando === 'DATA') { enDatos = true; datos = ''; socket.write('354 Termina con .\r\n') }
        else if (comando === 'QUIT') { socket.write('221 Adiós\r\n'); socket.end() }
        else socket.write('250 OK\r\n')
      }
    })
  })
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  return { puerto: servidor.address().port, recibidos, cerrar: () => new Promise((resolver) => { servidor.close(resolver); servidor.closeAllConnections?.() }) }
}

async function aprobarSolicitud(servidor, solicitudId) {
  // El técnico solo toma solicitudes de su estado de trabajo; la de prueba es de Nuevo León.
  servidor.sql("UPDATE usuarios_personal SET estado_trabajo_codigo = 'MX-NLE' WHERE email = 'tecnico@atlas.com'")
  const token = async (email) => (await servidor.iniciarSesion(email)).datos.token
  const tecnico = await token('tecnico@atlas.com')
  const agente = await token('ventas@atlas.com')
  const productos = (await servidor.pedir('/productos', { token: tecnico })).datos
  const panel = productos.find((producto) => producto.tipo === 'Panel' && producto.activo)
  const inversor = productos.find((producto) => producto.tipo === 'Inversor' && producto.activo)
  for (const [ruta, metodo, cuerpo] of [
    ['tomar', 'POST', {}],
    ['borrador', 'PUT', { items: [{ producto_id: panel.id, cantidad: 10 }, { producto_id: inversor.id, cantidad: 1 }] }],
    ['completar', 'POST', {}],
  ]) {
    const respuesta = await servidor.pedir(`/tecnico/solicitudes/${solicitudId}/${ruta}`, { metodo, token: tecnico, cuerpo })
    assert.ok(respuesta.estado < 300, `${ruta}: ${respuesta.texto}`)
  }
  return servidor.pedir(`/agente/solicitudes/${solicitudId}/aprobar`, { metodo: 'POST', token: agente, cuerpo: { precio_venta: 150000 } })
}

describe('modo simulado (sin SMTP)', () => {
  let servidor
  let registro
  before(async () => {
    servidor = await iniciarServidorPrueba()
    registro = await registrarSolicitudPrueba(servidor, 'nuevo@ejemplo.com', 'Nuevo León', { contrasena: null })
  })
  after(() => servidor?.detener())

  test('al registrar una solicitud guarda el .eml de credenciales y lo registra como pendiente "modo simulado"', () => {
    const { correo } = registro
    assert.equal(correo.estado, 'pendiente')
    assert.equal(correo.simulado, true)
    assert.match(correo.archivo, /^\d{8}T\d{6}Z-credenciales-\d+\.eml$/)
    assert.deepEqual(servidor.correos(), [correo.archivo])
    const eml = servidor.leerCorreo(correo.archivo)
    assert.match(eml.encabezados.to, /nuevo@ejemplo\.com/)
    assert.match(eml.encabezados.subject, /Crea tu contrase|=\?UTF-8\?/)
    assert.ok(eml.texto.includes(`http://atlas.example/#crear-contrasena=${tokenDelCorreo(eml)}`))
    assert.ok(eml.html.includes('Crear mi contraseña'))
    assert.match(eml.texto, /48 horas/)
    assert.doesNotMatch(eml.texto + eml.html, /contraseña temporal/i)

    const [fila] = notificaciones(servidor)
    assert.equal(fila.tipo_correo, 'credenciales')
    assert.equal(fila.estado_envio, 'pendiente')
    assert.equal(fila.destinatario_email, 'nuevo@ejemplo.com')
    assert.equal(fila.detalle_error, `Modo simulado: no se envió. Archivo: ${correo.archivo}`)
    assert.equal(fila.archivo, correo.archivo)
    assert.equal(fila.intentos, 1)
    assert.equal(fila.enviado_at, null)
    assert.equal(fila.solicitud_id, registro.solicitud.id)
    assert.equal(fila.prospecto_id, registro.registro.id)
  })

  test('el token del enlace no aparece en la respuesta, en la base ni en la consola del servidor', () => {
    const token = tokenDelCorreo(servidor.leerCorreo(registro.correo.archivo))
    assert.ok(!JSON.stringify(registro).includes(token))
    assert.ok(!JSON.stringify(notificaciones(servidor)).includes(token))
    assert.ok(!JSON.stringify(servidor.sqlTodas('SELECT * FROM tokens_cuenta')).includes(token), 'la base guarda solo el hash')
    assert.ok(!servidor.salida().includes(token))
    assert.match(servidor.salida(), /modo simulado/)
  })

  test('la cuenta nueva tiene una contraseña que nadie conoce; entra después de crearla con el enlace', async () => {
    assert.equal((await servidor.iniciarSesion('nuevo@ejemplo.com', '123')).estado, 401)
    const [cuenta] = servidor.sqlTodas("SELECT debe_cambiar_password FROM cuentas_cliente WHERE email = 'nuevo@ejemplo.com'")
    assert.equal(cuenta.debe_cambiar_password, 1)
    const token = tokenDelCorreo(servidor.leerCorreo(registro.correo.archivo))
    const creada = await servidor.pedir('/portal/crear-contrasena', { metodo: 'POST', cuerpo: { token, nueva: 'ClavePropia2026', confirmacion: 'ClavePropia2026' } })
    assert.equal(creada.estado, 200)
    const { estado, datos } = await servidor.iniciarSesion('nuevo@ejemplo.com', 'ClavePropia2026')
    assert.equal(estado, 200)
    assert.equal(datos.debe_cambiar_password, false)
  })

  test('las cuentas de personal siguen entrando con 123 sin cambio obligatorio', async () => {
    for (const email of ['admin@atlas.com', 'ventas@atlas.com', 'tecnico@atlas.com']) {
      const { estado, datos } = await servidor.iniciarSesion(email)
      assert.equal(estado, 200)
      assert.ok(!datos.debe_cambiar_password)
    }
  })

  test('al aprobar, el cliente recibe "cotización lista" sin precios ni costos', async () => {
    const respuesta = await aprobarSolicitud(servidor, registro.solicitud.id)
    assert.equal(respuesta.estado, 200, respuesta.texto)
    assert.equal(respuesta.datos.correo.estado, 'pendiente')
    assert.match(respuesta.datos.correo.archivo, /-cotizacion_lista-\d+\.eml$/)
    const eml = servidor.leerCorreo(respuesta.datos.correo.archivo)
    assert.match(eml.encabezados.to, /nuevo@ejemplo\.com/)
    assert.ok(eml.texto.includes('http://atlas.example'))
    assert.doesNotMatch(eml.texto + eml.html, /150[,.]?000|\$|MXN|costo|precio/i)
    const fila = notificaciones(servidor).at(-1)
    assert.equal(fila.tipo_correo, 'cotizacion_lista')
    assert.equal(fila.solicitud_id, registro.solicitud.id)
  })
})

describe('SMTP real', () => {
  const credenciales = { SMTP_USER: 'usuario-de-prueba', SMTP_PASS: 'secreto-de-prueba' }

  test('servidor SMTP que acepta: estado "aceptado" con fecha de envío y sin .eml local', async () => {
    const smtp = await smtpFalso('acepta')
    const servidor = await iniciarServidorPrueba({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.puerto), CORREO_REMITENTE: 'ATLAS <no-responder@ejemplo.com>' })
    try {
      const { correo } = await registrarSolicitudPrueba(servidor, 'smtp@ejemplo.com', 'Nuevo León', { contrasena: null })
      assert.deepEqual(correo, { id: correo.id, estado: 'aceptado', simulado: false })
      const [fila] = notificaciones(servidor)
      assert.equal(fila.estado_envio, 'aceptado')
      assert.ok(fila.enviado_at)
      assert.equal(fila.detalle_error, null)
      assert.deepEqual(servidor.correos(), [])
      assert.equal(smtp.recibidos.length, 1)
      assert.match(smtp.recibidos[0], /no-responder@ejemplo\.com/)
      assert.match(servidor.salida(), /SMTP configurado/)
    } finally {
      await servidor.detener()
      await smtp.cerrar()
    }
  })

  test('SMTP inalcanzable: la solicitud se registra igual, el correo queda "fallido" y sin credenciales en el detalle', async () => {
    const smtp = await smtpFalso('acepta')
    const puertoCerrado = smtp.puerto
    await smtp.cerrar()
    const servidor = await iniciarServidorPrueba({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(puertoCerrado), CORREO_TIEMPO_MAX_MS: '3000', ...credenciales })
    try {
      const datos = await registrarSolicitudPrueba(servidor, 'caido@ejemplo.com', 'Nuevo León', { contrasena: null })
      assert.equal(datos.correo.estado, 'fallido')
      assert.ok(datos.correo.detalle)
      assert.ok(datos.solicitud.id, 'la solicitud quedó registrada')
      assert.equal(servidor.sqlTodas('SELECT COUNT(*) AS total FROM solicitudes_cotizacion')[0].total, 1)
      assert.equal(servidor.sqlTodas("SELECT debe_cambiar_password FROM cuentas_cliente WHERE email = 'caido@ejemplo.com'")[0].debe_cambiar_password, 1)
      const [fila] = notificaciones(servidor)
      assert.equal(fila.estado_envio, 'fallido')
      assert.ok(fila.detalle_error)
      assert.equal(fila.enviado_at, null)
      for (const texto of [JSON.stringify(datos), JSON.stringify(fila), servidor.salida()]) {
        assert.ok(!texto.includes('secreto-de-prueba'), 'la contraseña SMTP no aparece')
      }
    } finally {
      await servidor.detener()
    }
  })

  test('destinatario rechazado: "fallido"', async () => {
    const smtp = await smtpFalso('rechaza')
    const servidor = await iniciarServidorPrueba({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.puerto) })
    try {
      const { correo } = await registrarSolicitudPrueba(servidor, 'rechazado@ejemplo.com', 'Nuevo León', { contrasena: null })
      assert.equal(correo.estado, 'fallido')
      assert.equal(notificaciones(servidor)[0].estado_envio, 'fallido')
    } finally {
      await servidor.detener()
      await smtp.cerrar()
    }
  })

  test('servidor que no responde: el envío se corta en el tiempo máximo y queda "fallido"', async () => {
    const smtp = await smtpFalso('mudo')
    const servidor = await iniciarServidorPrueba({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.puerto), CORREO_TIEMPO_MAX_MS: '1500' })
    try {
      const inicio = Date.now()
      const { correo } = await registrarSolicitudPrueba(servidor, 'lento@ejemplo.com', 'Nuevo León', { contrasena: null })
      const duracion = Date.now() - inicio
      assert.equal(correo.estado, 'fallido')
      assert.ok(duracion < 6000, `tardó ${duracion} ms`)
      assert.equal(notificaciones(servidor)[0].estado_envio, 'fallido')
    } finally {
      await servidor.detener()
      await smtp.cerrar()
    }
  })
})

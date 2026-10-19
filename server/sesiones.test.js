// Pruebas de límites del login, motivo del 401 y rutas antiguas de prospectos.
// Usan servidores con base temporal (nunca data/) y límites bajos por variables de entorno.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'

const loginDesde = (servidor, ip, email, password) => servidor.pedir('/login', { metodo: 'POST', cuerpo: { email, password }, ip })

describe('límite de intentos del login por cuenta', () => {
  let servidor
  before(async () => {
    servidor = await iniciarServidorPrueba({ ATLAS_LOGIN_MAX_CUENTA: '3', ATLAS_LOGIN_MAX_IP: '1000' })
    await registrarSolicitudPrueba(servidor, 'cliente@prueba.com')
  })
  after(async () => { await servidor.detener() })

  test('el 401 de credenciales incorrectas no cambia', async () => {
    const respuesta = await servidor.iniciarSesion('tecnico@atlas.com', 'mala')
    assert.equal(respuesta.estado, 401)
    assert.deepEqual(respuesta.datos, { error: 'Credenciales incorrectas' })
  })

  test('tras 3 fallos la cuenta se bloquea, incluso con la contraseña correcta (también el personal)', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await servidor.iniciarSesion('admin@atlas.com', 'mala')).estado, 401)
    const bloqueada = await servidor.iniciarSesion('admin@atlas.com', '123')
    assert.equal(bloqueada.estado, 429)
    assert.equal(bloqueada.datos.codigo, 'limite_cuenta')
    assert.match(bloqueada.datos.error, /^Demasiados intentos fallidos para esta cuenta\. Espera \d+ minutos? e inténtalo de nuevo\.$/)
    assert.equal((await servidor.iniciarSesion('ventas@atlas.com', '123')).estado, 200, 'otra cuenta no se afecta')
  })

  test('un login exitoso reinicia el contador de la cuenta', async () => {
    for (let i = 0; i < 2; i++) await servidor.iniciarSesion('cliente@prueba.com', 'mala')
    assert.equal((await servidor.iniciarSesion('cliente@prueba.com', '123')).estado, 200)
    for (let i = 0; i < 2; i++) assert.equal((await servidor.iniciarSesion('cliente@prueba.com', 'mala')).estado, 401)
    assert.equal((await servidor.iniciarSesion('cliente@prueba.com', '123')).estado, 200)
  })

  test('un correo inexistente se comporta igual (no revela qué cuentas existen)', async () => {
    for (let i = 0; i < 3; i++) assert.deepEqual((await servidor.iniciarSesion('noexiste@prueba.com', 'x')).datos, { error: 'Credenciales incorrectas' })
    const bloqueada = await servidor.iniciarSesion('noexiste@prueba.com', 'x')
    assert.equal(bloqueada.estado, 429)
    assert.equal(bloqueada.datos.codigo, 'limite_cuenta')
  })
})

describe('límite de intentos del login por IP', () => {
  let servidor
  before(async () => { servidor = await iniciarServidorPrueba({ ATLAS_LOGIN_MAX_CUENTA: '1000', ATLAS_LOGIN_MAX_IP: '4' }) })
  after(async () => { await servidor.detener() })

  test('tras 4 fallos desde una IP se bloquea esa IP para cualquier cuenta; otra IP sigue entrando', async () => {
    // Desde localhost, trust proxy 'loopback' acepta X-Forwarded-For, como haría el proxy de Vite.
    for (let i = 0; i < 4; i++) assert.equal((await loginDesde(servidor, '203.0.113.10', `x${i}@prueba.com`, 'mala')).estado, 401)
    const bloqueada = await loginDesde(servidor, '203.0.113.10', 'admin@atlas.com', '123')
    assert.equal(bloqueada.estado, 429)
    assert.equal(bloqueada.datos.codigo, 'limite_ip')
    assert.match(bloqueada.datos.error, /^Demasiados intentos fallidos desde esta conexión\./)
    assert.equal((await loginDesde(servidor, '203.0.113.11', 'admin@atlas.com', '123')).estado, 200)
  })

  test('un login exitoso no reinicia el contador de la IP', async () => {
    for (let i = 0; i < 3; i++) await loginDesde(servidor, '203.0.113.20', `y${i}@prueba.com`, 'mala')
    assert.equal((await loginDesde(servidor, '203.0.113.20', 'ventas@atlas.com', '123')).estado, 200)
    await loginDesde(servidor, '203.0.113.20', 'z@prueba.com', 'mala')
    assert.equal((await loginDesde(servidor, '203.0.113.20', 'ventas@atlas.com', '123')).estado, 429)
  })
})

describe('motivo del 401 y rutas antiguas de prospectos', () => {
  let servidor
  before(async () => {
    servidor = await iniciarServidorPrueba()
    await registrarSolicitudPrueba(servidor, 'cliente@prueba.com')
  })
  after(async () => { await servidor.detener() })

  test('una sesión cerrada por cambio de contraseña responde 401 con el motivo; un token desconocido, sesion_vencida', async () => {
    const vieja = (await servidor.iniciarSesion('cliente@prueba.com')).datos
    const actual = (await servidor.iniciarSesion('cliente@prueba.com')).datos
    await servidor.pedir('/portal/cambiar-contrasena', { metodo: 'POST', token: actual.token, cuerpo: { actual: '123', nueva: 'ClaveNueva2026', confirmacion: 'ClaveNueva2026' } })
    const respuesta = await servidor.pedir(`/portal/prospectos/${vieja.prospecto_id}`, { token: vieja.token })
    assert.equal(respuesta.estado, 401)
    assert.equal(respuesta.datos.codigo, 'contrasena_cambiada')
    assert.equal(respuesta.datos.error, 'Tu contraseña se cambió en otro dispositivo. Inicia sesión de nuevo.')
    const desconocido = await servidor.pedir('/productos', { token: 'token-inventado' })
    assert.equal(desconocido.estado, 401)
    assert.equal(desconocido.datos.codigo, 'sesion_vencida')
    assert.equal((await servidor.pedir('/productos')).estado, 401)
  })

  test('el 403 de "debe cambiar contraseña" no cambia', async () => {
    servidor.sql("UPDATE cuentas_cliente SET debe_cambiar_password = 1 WHERE email = 'cliente@prueba.com'")
    const sesion = (await servidor.iniciarSesion('cliente@prueba.com', 'ClaveNueva2026')).datos
    const respuesta = await servidor.pedir(`/portal/prospectos/${sesion.prospecto_id}`, { token: sesion.token })
    assert.equal(respuesta.estado, 403)
    assert.equal(respuesta.datos.codigo, 'debe_cambiar_password')
  })

  test('POST, PATCH y PUT de /api/prospectos exigen sesión de Administrador o Agente', async () => {
    const cuerpoNuevo = { nombre: 'Prospecto de prueba', telefono: '8100000000' }
    const sinSesion = [
      await servidor.pedir('/prospectos', { metodo: 'POST', cuerpo: cuerpoNuevo }),
      await servidor.pedir('/prospectos/1', { metodo: 'PATCH', cuerpo: { telefono: '8100000001' } }),
      await servidor.pedir('/prospectos/1/consumo', { metodo: 'PUT', cuerpo: { consumo_kwh: 300 } }),
    ]
    assert.deepEqual(sinSesion.map((r) => r.estado), [401, 401, 401])
    const tecnico = (await servidor.iniciarSesion('tecnico@atlas.com')).datos.token
    assert.equal((await servidor.pedir('/prospectos', { metodo: 'POST', token: tecnico, cuerpo: cuerpoNuevo })).estado, 403)
    const agente = (await servidor.iniciarSesion('ventas@atlas.com')).datos.token
    const creado = await servidor.pedir('/prospectos', { metodo: 'POST', token: agente, cuerpo: cuerpoNuevo })
    assert.equal(creado.estado, 201)
    const admin = (await servidor.iniciarSesion('admin@atlas.com')).datos.token
    assert.equal((await servidor.pedir(`/prospectos/${creado.datos.id}`, { metodo: 'PATCH', token: admin, cuerpo: { telefono: '8100000001' } })).estado, 200)
    assert.equal((await servidor.pedir(`/prospectos/${creado.datos.id}/consumo`, { metodo: 'PUT', token: agente, cuerpo: { consumo_kwh: 300 } })).estado, 200)
  })
})

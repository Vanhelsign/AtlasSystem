// Pruebas del cambio de contraseña del cliente (Fase 3). Usan un servidor con base temporal; no tocan data/.
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'

const NUEVA = 'ClaveNueva2026'
const OTRA = 'OtraClave2026x'

describe('cambio de contraseña del cliente', () => {
  let servidor
  before(async () => {
    servidor = await iniciarServidorPrueba()
    await registrarSolicitudPrueba(servidor, 'cliente1@prueba.com')
    await registrarSolicitudPrueba(servidor, 'cliente2@prueba.com')
    await registrarSolicitudPrueba(servidor, 'cliente3@prueba.com')
    await registrarSolicitudPrueba(servidor, 'cliente4@prueba.com')
  })
  after(async () => { await servidor.detener() })

  const cambiar = (token, cuerpo) => servidor.pedir('/portal/cambiar-contrasena', { metodo: 'POST', token, cuerpo })

  test('las cuentas existentes siguen entrando con 123 y sin cambio obligatorio', async () => {
    const { estado, datos } = await servidor.iniciarSesion('cliente1@prueba.com')
    assert.equal(estado, 200)
    assert.equal(datos.debe_cambiar_password, false)
    const personal = await servidor.iniciarSesion('admin@atlas.com')
    assert.equal(personal.estado, 200)
  })

  test('validaciones con el campo afectado', async () => {
    const { datos } = await servidor.iniciarSesion('cliente1@prueba.com')
    const casos = [
      [{ actual: '', nueva: NUEVA, confirmacion: NUEVA }, 'actual'],
      [{ actual: '123', nueva: 'corta', confirmacion: 'corta' }, 'nueva'],
      [{ actual: '123', nueva: '123', confirmacion: '123' }, 'nueva'],
      [{ actual: '12345678', nueva: '12345678', confirmacion: '12345678' }, 'nueva'],
      [{ actual: '123', nueva: NUEVA, confirmacion: 'distinta123' }, 'confirmacion'],
    ]
    for (const [cuerpo, campo] of casos) {
      const respuesta = await cambiar(datos.token, cuerpo)
      assert.equal(respuesta.estado, 400, JSON.stringify(cuerpo))
      assert.equal(respuesta.datos.campo, campo, respuesta.datos.error)
    }
  })

  test('cambio exitoso: la nueva funciona, la anterior no, y la respuesta no contiene contraseñas', async () => {
    const { datos } = await servidor.iniciarSesion('cliente1@prueba.com')
    const respuesta = await cambiar(datos.token, { actual: '123', nueva: NUEVA, confirmacion: NUEVA })
    assert.equal(respuesta.estado, 200)
    assert.ok(!respuesta.texto.includes(NUEVA) && !respuesta.texto.includes('"123"'))
    assert.equal((await servidor.iniciarSesion('cliente1@prueba.com', NUEVA)).estado, 200)
    assert.equal((await servidor.iniciarSesion('cliente1@prueba.com', '123')).estado, 401)
  })

  test('cierra las demás sesiones de la cuenta y conserva la actual', async () => {
    const a = (await servidor.iniciarSesion('cliente2@prueba.com')).datos
    const b = (await servidor.iniciarSesion('cliente2@prueba.com')).datos
    const otraCuenta = (await servidor.iniciarSesion('cliente3@prueba.com')).datos
    const respuesta = await cambiar(a.token, { actual: '123', nueva: NUEVA, confirmacion: NUEVA })
    assert.equal(respuesta.datos.sesiones_cerradas, 1)
    assert.equal((await servidor.pedir(`/portal/prospectos/${a.prospecto_id}`, { token: a.token })).estado, 200)
    assert.equal((await servidor.pedir(`/portal/prospectos/${b.prospecto_id}`, { token: b.token })).estado, 401)
    assert.equal((await servidor.pedir(`/portal/prospectos/${otraCuenta.prospecto_id}`, { token: otraCuenta.token })).estado, 200)
  })

  test('5 intentos fallidos en 10 minutos bloquean la cuenta, sin afectar a otras', async () => {
    const { datos } = await servidor.iniciarSesion('cliente3@prueba.com')
    for (let intento = 1; intento <= 5; intento += 1) {
      const respuesta = await cambiar(datos.token, { actual: 'incorrecta', nueva: NUEVA, confirmacion: NUEVA })
      assert.equal(respuesta.estado, 400)
      assert.equal(respuesta.datos.campo, 'actual')
    }
    const bloqueado = await cambiar(datos.token, { actual: '123', nueva: NUEVA, confirmacion: NUEVA })
    assert.equal(bloqueado.estado, 429)
    assert.match(bloqueado.datos.error, /Espera \d+ minutos?/)
    assert.equal((await servidor.iniciarSesion('cliente3@prueba.com', '123')).estado, 200, 'la contraseña no cambió')
    const otra = (await servidor.iniciarSesion('cliente4@prueba.com')).datos
    assert.equal((await cambiar(otra.token, { actual: 'incorrecta', nueva: NUEVA, confirmacion: NUEVA })).estado, 400, 'otra cuenta no está bloqueada')
  })

  test('con "debe cambiar contraseña" solo puede cambiarla o cerrar sesión', async () => {
    servidor.sql("UPDATE cuentas_cliente SET debe_cambiar_password = 1 WHERE email = 'cliente4@prueba.com'")
    const { datos } = await servidor.iniciarSesion('cliente4@prueba.com')
    assert.equal(datos.debe_cambiar_password, true)
    const portal = await servidor.pedir(`/portal/prospectos/${datos.prospecto_id}`, { token: datos.token })
    assert.equal(portal.estado, 403)
    assert.equal(portal.datos.codigo, 'debe_cambiar_password')
    assert.equal((await cambiar(datos.token, { actual: '123', nueva: OTRA, confirmacion: OTRA })).estado, 200)
    assert.equal((await servidor.pedir(`/portal/prospectos/${datos.prospecto_id}`, { token: datos.token })).estado, 200)
    assert.equal((await servidor.iniciarSesion('cliente4@prueba.com', OTRA)).datos.debe_cambiar_password, false)
    const otra = (await servidor.iniciarSesion('cliente4@prueba.com', OTRA)).datos
    servidor.sql("UPDATE cuentas_cliente SET debe_cambiar_password = 1 WHERE email = 'cliente4@prueba.com'")
    const pendiente = (await servidor.iniciarSesion('cliente4@prueba.com', OTRA)).datos
    assert.equal((await servidor.pedir('/logout', { metodo: 'POST', token: pendiente.token })).estado, 204)
    assert.equal((await servidor.pedir(`/portal/prospectos/${otra.prospecto_id}`, { token: otra.token })).estado, 200, 'una sesión iniciada antes del indicador no se bloquea')
  })

  test('solo el cliente puede usar la ruta', async () => {
    const admin = (await servidor.iniciarSesion('admin@atlas.com')).datos
    assert.equal((await cambiar(admin.token, { actual: '123', nueva: NUEVA, confirmacion: NUEVA })).estado, 403)
    assert.equal((await cambiar(undefined, { actual: '123', nueva: NUEVA, confirmacion: NUEVA })).estado, 401)
  })

  test('JSON mal formado con una contraseña se rechaza sin registrarla', async () => {
    const { datos } = await servidor.iniciarSesion('cliente1@prueba.com', NUEVA)
    const respuesta = await servidor.pedir('/portal/cambiar-contrasena', { metodo: 'POST', token: datos.token, crudo: `{"actual": "${NUEVA}", "nueva": ` })
    assert.equal(respuesta.estado, 400)
  })

  test('ninguna contraseña aparece en los registros del servidor', () => {
    const registro = servidor.salida()
    for (const secreto of [NUEVA, OTRA, 'incorrecta']) assert.ok(!registro.includes(secreto), `"${secreto}" apareció en el registro`)
  })
})

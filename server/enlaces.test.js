// Pruebas del enlace "Crea tu contraseña" con la API real sobre una base y una carpeta de correos temporales
// (nunca data/atlas.sqlite ni data/correos/). Ejecutar con: npm test
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { iniciarServidorPrueba, registrarSolicitudPrueba } from './pruebas/servidorPrueba.js'

const ENLACE_INVALIDO = { error: 'El enlace no es válido o venció. Pide a tu agente que lo reenvíe.', codigo: 'enlace_invalido' }
const CLAVE = 'ClavePropia2026'
const tokenDelCorreo = (correo) => /#crear-contrasena=([A-Za-z0-9_-]{43})/.exec(correo.texto)?.[1]
let siguienteIp = 1
const ipNueva = () => `198.51.100.${siguienteIp++}`

describe('enlace para crear la contraseña', () => {
  let servidor
  let tokens
  const usados = []
  const validar = (token, ip = ipNueva()) => servidor.pedir('/portal/validar-enlace', { metodo: 'POST', cuerpo: { token }, ip })
  const crear = (token, nueva = CLAVE, confirmacion = nueva, ip = ipNueva()) => servidor.pedir('/portal/crear-contrasena', { metodo: 'POST', cuerpo: { token, nueva, confirmacion }, ip })
  // Registra un cliente nuevo (contraseña desconocida) y devuelve el token de su correo simulado.
  const clienteNuevo = async (email) => {
    const { correo } = await registrarSolicitudPrueba(servidor, email, 'Nuevo León', { contrasena: null })
    const token = tokenDelCorreo(servidor.leerCorreo(correo.archivo))
    usados.push(token)
    return token
  }

  before(async () => {
    servidor = await iniciarServidorPrueba({ ATLAS_ENLACE_MAX_IP: '4' })
    // Para emitir tokens como lo hará el reenvío de la Fase 4b, se usa el mismo módulo del servidor contra la
    // base temporal. Se comprueba antes de importarlo que la ruta no es data/atlas.sqlite.
    assert.ok(resolve(servidor.base).startsWith(resolve(tmpdir())), 'la base de prueba debe estar en la carpeta temporal')
    process.env.ATLAS_DB_PATH = servidor.base
    tokens = await import('./tokensCuenta.js')
  })
  after(async () => {
    // La conexión de este proceso se cierra antes de borrar la carpeta temporal (Windows no borra archivos abiertos).
    if (tokens) (await import('./database.js')).db.close()
    await servidor?.detener()
  })

  test('validar un token vigente no lo consume, aunque se abra varias veces', async () => {
    const token = await clienteNuevo('valida@ejemplo.com')
    for (let i = 0; i < 3; i++) assert.deepEqual((await validar(token)).datos, { valido: true })
    assert.equal(servidor.sqlTodas("SELECT t.usado_at FROM tokens_cuenta t JOIN cuentas_cliente c ON c.id = t.cuenta_id WHERE c.email = 'valida@ejemplo.com'")[0].usado_at, null)
    assert.equal((await crear(token)).estado, 200, 'sigue sirviendo para crear la contraseña')
  })

  test('token inexistente, con formato inválido o ausente: el mismo error genérico', async () => {
    for (const token of [randomBytes(32).toString('base64url'), 'abc', undefined, 12345]) {
      for (const respuesta of [await validar(token), await crear(token)]) {
        assert.equal(respuesta.estado, 400)
        assert.deepEqual(respuesta.datos, ENLACE_INVALIDO)
      }
    }
  })

  test('crear la contraseña: la cuenta entra con ella, sin marca de cambio y sin iniciar sesión sola', async () => {
    const token = await clienteNuevo('crea@ejemplo.com')
    const respuesta = await crear(token)
    assert.equal(respuesta.estado, 200)
    assert.deepEqual(respuesta.datos, { creada: true }, 'no devuelve token de sesión')
    const login = await servidor.iniciarSesion('crea@ejemplo.com', CLAVE)
    assert.equal(login.estado, 200)
    assert.equal(login.datos.debe_cambiar_password, false)
  })

  test('el token es de un solo uso: el segundo intento recibe el error genérico', async () => {
    const token = await clienteNuevo('dosveces@ejemplo.com')
    assert.equal((await crear(token)).estado, 200)
    for (const respuesta of [await crear(token, 'OtraClave2026'), await validar(token)]) {
      assert.equal(respuesta.estado, 400)
      assert.deepEqual(respuesta.datos, ENLACE_INVALIDO)
    }
    assert.equal((await servidor.iniciarSesion('dosveces@ejemplo.com', 'OtraClave2026')).estado, 401)
  })

  test('token vencido: el mismo error genérico y no cambia la contraseña', async () => {
    const token = await clienteNuevo('vencido@ejemplo.com')
    servidor.sql("UPDATE tokens_cuenta SET expira_at = datetime('now', '-1 minute') WHERE cuenta_id = (SELECT id FROM cuentas_cliente WHERE email = 'vencido@ejemplo.com')")
    for (const respuesta of [await validar(token), await crear(token)]) assert.deepEqual(respuesta.datos, ENLACE_INVALIDO)
    assert.equal((await servidor.iniciarSesion('vencido@ejemplo.com', CLAVE)).estado, 401)
  })

  test('vigencia de 48 horas por defecto', async () => {
    await clienteNuevo('vigencia@ejemplo.com')
    const [{ horas }] = servidor.sqlTodas(`
      SELECT round((julianday(t.expira_at) - julianday(t.created_at)) * 24) AS horas
      FROM tokens_cuenta t JOIN cuentas_cliente c ON c.id = t.cuenta_id WHERE c.email = 'vigencia@ejemplo.com'`)
    assert.equal(horas, 48)
  })

  test('contraseña corta o confirmación distinta: error por campo y el token sigue vigente', async () => {
    const token = await clienteNuevo('corrige@ejemplo.com')
    const corta = await crear(token, 'corta')
    assert.equal(corta.estado, 400)
    assert.equal(corta.datos.campo, 'nueva')
    const distinta = await crear(token, CLAVE, 'Distinta2026')
    assert.equal(distinta.estado, 400)
    assert.equal(distinta.datos.campo, 'confirmacion')
    assert.deepEqual((await validar(token)).datos, { valido: true })
    assert.equal((await crear(token)).estado, 200)
  })

  test('consumo atómico: de dos peticiones simultáneas solo una crea la contraseña', async () => {
    const token = await clienteNuevo('simultaneo@ejemplo.com')
    const resultados = await Promise.all([crear(token, 'PrimeraClave1'), crear(token, 'SegundaClave2')])
    const estados = resultados.map((respuesta) => respuesta.estado).sort()
    assert.deepEqual(estados, [200, 400])
    const ganadora = resultados[0].estado === 200 ? 'PrimeraClave1' : 'SegundaClave2'
    const perdedora = ganadora === 'PrimeraClave1' ? 'SegundaClave2' : 'PrimeraClave1'
    assert.equal((await servidor.iniciarSesion('simultaneo@ejemplo.com', ganadora)).estado, 200)
    assert.equal((await servidor.iniciarSesion('simultaneo@ejemplo.com', perdedora)).estado, 401)
  })

  test('emitir un token nuevo invalida el anterior de la cuenta', async () => {
    const anterior = await clienteNuevo('reemite@ejemplo.com')
    const [{ id }] = servidor.sqlTodas("SELECT id FROM cuentas_cliente WHERE email = 'reemite@ejemplo.com'")
    const nuevo = tokens.emitirTokenCuenta(id)
    usados.push(nuevo)
    assert.deepEqual((await validar(anterior)).datos, ENLACE_INVALIDO)
    assert.deepEqual((await validar(nuevo)).datos, { valido: true })
    assert.equal(servidor.sqlTodas('SELECT COUNT(*) AS total FROM tokens_cuenta WHERE cuenta_id = ?', id)[0].total, 1)
  })

  test('crear la contraseña cierra las sesiones abiertas de esa cuenta', async () => {
    await registrarSolicitudPrueba(servidor, 'sesiones@ejemplo.com')
    const sesion = (await servidor.iniciarSesion('sesiones@ejemplo.com', '123')).datos.token
    const [{ id }] = servidor.sqlTodas("SELECT id FROM cuentas_cliente WHERE email = 'sesiones@ejemplo.com'")
    const token = tokens.emitirTokenCuenta(id)
    usados.push(token)
    assert.equal((await crear(token)).estado, 200)
    const portal = await servidor.pedir('/portal/prospectos/1', { token: sesion })
    assert.equal(portal.estado, 401)
    assert.equal(portal.datos.codigo, 'contrasena_cambiada')
  })

  test('límite por IP: tokens inválidos en validar y crear suman; el 429 no revela si el token existió', async () => {
    const valido = await clienteNuevo('limite@ejemplo.com')
    const ip = '203.0.113.50'
    const falso = randomBytes(32).toString('base64url')
    for (const respuesta of [await validar(falso, ip), await crear(falso, CLAVE, CLAVE, ip), await validar('x', ip), await crear(falso, CLAVE, CLAVE, ip)]) {
      assert.equal(respuesta.estado, 400)
    }
    for (const respuesta of [await validar(valido, ip), await crear(valido, CLAVE, CLAVE, ip), await validar(falso, ip)]) {
      assert.equal(respuesta.estado, 429)
      assert.equal(respuesta.datos.codigo, 'limite_enlace')
      assert.match(respuesta.datos.error, /^Demasiados intentos con enlaces no válidos desde esta conexión\. Espera 1[45] minutos e inténtalo de nuevo\.$/)
    }
    assert.deepEqual((await validar(valido, '203.0.113.51')).datos, { valido: true }, 'otra IP no se afecta')
    // Los errores de contraseña con un token válido no cuentan como fallos.
    const ipCorrige = '203.0.113.60'
    for (let i = 0; i < 5; i++) assert.equal((await crear(valido, 'corta', 'corta', ipCorrige)).datos.campo, 'nueva')
    assert.equal((await crear(valido, CLAVE, CLAVE, ipCorrige)).estado, 200)
  })

  test('el token no aparece en la consola del servidor, en registro_notificaciones ni en respuestas de error', async () => {
    const token = await clienteNuevo('registros@ejemplo.com')
    // JSON mal formado que contiene el token: el servidor responde 400 sin registrar el cuerpo.
    const malformado = await servidor.pedir('/portal/crear-contrasena', { metodo: 'POST', crudo: `{"token":"${token}",` })
    assert.equal(malformado.estado, 400)
    assert.ok(!malformado.texto.includes(token))
    const salida = servidor.salida()
    const notificacionesTexto = JSON.stringify(servidor.sqlTodas('SELECT * FROM registro_notificaciones'))
    const tokensTexto = JSON.stringify(servidor.sqlTodas('SELECT * FROM tokens_cuenta'))
    for (const usado of usados) {
      assert.ok(!salida.includes(usado), 'consola del servidor')
      assert.ok(!notificacionesTexto.includes(usado), 'registro_notificaciones')
      assert.ok(!tokensTexto.includes(usado), 'tokens_cuenta guarda solo el hash')
    }
    assert.doesNotMatch(salida, /crear-contrasena=/)
  })
})

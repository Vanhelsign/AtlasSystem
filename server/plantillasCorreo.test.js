// Pruebas de las plantillas y utilidades de correo (funciones puras, sin base ni red). Ejecutar con: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escaparHtml, plantillaCotizacionLista, plantillaCredenciales, plantillaRecordatorio } from './plantillasCorreo.js'
import { ALFABETO_TEMPORAL, configuracionCorreo, generarContrasenaTemporal, limpiarDetalleError } from './correoUtil.js'

const URL_APP = 'http://atlas.example'

test('credenciales: correo de acceso, contraseña temporal y URL en texto y HTML, en español', () => {
  const correo = plantillaCredenciales({ nombre: 'Cliente Demo', email: 'cliente@ejemplo.com', contrasenaTemporal: 'Ab3dEf7hJk9m', urlApp: URL_APP })
  assert.equal(correo.asunto, 'Tu acceso al portal de ATLAS')
  for (const parte of [correo.texto, correo.html]) {
    assert.ok(parte.includes('cliente@ejemplo.com'))
    assert.ok(parte.includes('Ab3dEf7hJk9m'))
    assert.ok(parte.includes(URL_APP))
    assert.match(parte, /cambiar la contraseña temporal/)
  }
  assert.match(correo.texto, /^Hola, Cliente Demo:/)
  assert.match(correo.html, /<html lang="es">/)
})

test('cotización lista: URL del portal, sin precios, costos ni contraseñas', () => {
  const correo = plantillaCotizacionLista({ nombre: 'Cliente Demo', urlApp: URL_APP })
  assert.equal(correo.asunto, 'Tu cotización de ATLAS está lista')
  for (const parte of [correo.texto, correo.html]) {
    assert.ok(parte.includes(URL_APP))
    assert.doesNotMatch(parte, /\$|MXN|precio|costo|contraseña/i)
  }
})

test('recordatorio: plantilla lista para cuando exista el módulo de mantenimientos', () => {
  const correo = plantillaRecordatorio({ nombre: 'Cliente Demo', fecha: '2026-11-30', descripcion: 'Limpieza de paneles', urlApp: URL_APP })
  assert.match(correo.texto, /Limpieza de paneles, con fecha límite 2026-11-30/)
  assert.ok(correo.html.includes('Limpieza de paneles'))
  assert.doesNotMatch(correo.texto, /contraseña/i)
  const sinDatos = plantillaRecordatorio({ urlApp: URL_APP })
  assert.match(sinDatos.texto, /^Hola:/)
})

test('el HTML escapa los datos del cliente', () => {
  assert.equal(escaparHtml(`<b>"x" & 'y'</b>`), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;')
  const correo = plantillaCredenciales({ nombre: '<script>alert(1)</script>', email: 'a@ejemplo.com', contrasenaTemporal: 'x', urlApp: URL_APP })
  assert.ok(!correo.html.includes('<script>'))
  assert.ok(correo.html.includes('&lt;script&gt;'))
})

test('configuración: sin SMTP_HOST es modo simulado; valores por defecto y URL sin diagonal final', () => {
  const simulado = configuracionCorreo({})
  assert.equal(simulado.simulado, true)
  assert.equal(simulado.puerto, 587)
  assert.equal(simulado.urlApp, 'http://localhost:5173')
  assert.equal(simulado.tiempoMaxMs, 15000)
  assert.match(simulado.carpetaCorreos.replaceAll('\\', '/'), /data\/correos$/)
  const real = configuracionCorreo({ SMTP_HOST: 'smtp.ejemplo.com', SMTP_SECURE: 'true', APP_URL: 'https://atlas.ejemplo.com/', CORREO_TIEMPO_MAX_MS: '5000' })
  assert.equal(real.simulado, false)
  assert.equal(real.puerto, 465)
  assert.equal(real.urlApp, 'https://atlas.ejemplo.com')
  assert.equal(real.tiempoMaxMs, 5000)
})

test('contraseña temporal: 12 caracteres del alfabeto sin ambiguos y distinta cada vez', () => {
  const generadas = new Set(Array.from({ length: 200 }, () => generarContrasenaTemporal()))
  assert.equal(generadas.size, 200)
  for (const contrasena of generadas) {
    assert.equal(contrasena.length, 12)
    assert.ok([...contrasena].every((caracter) => ALFABETO_TEMPORAL.includes(caracter)))
  }
  assert.doesNotMatch(ALFABETO_TEMPORAL, /[0O1lI]/)
})

test('el detalle de error oculta usuario y contraseña SMTP y se acota', () => {
  const configuracion = { usuario: 'usuario-smtp', contrasena: 'secreto-smtp' }
  const detalle = limpiarDetalleError(Object.assign(new Error('Invalid login for usuario-smtp with secreto-smtp'), { code: 'EAUTH' }), configuracion)
  assert.equal(detalle, 'EAUTH: Invalid login for *** with ***')
  assert.equal(limpiarDetalleError(new Error('x'.repeat(1000)), configuracion).length, 300)
})

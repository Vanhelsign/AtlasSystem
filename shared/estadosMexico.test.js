// Pruebas de la normalización de estados. Ejecutar con: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESTADOS_MEXICO, nombreEstadoMexico, normalizarEstadoMexico } from './estadosMexico.js'

test('reconoce los 32 nombres oficiales y sus códigos', () => {
  assert.equal(ESTADOS_MEXICO.length, 32)
  for (const estado of ESTADOS_MEXICO) {
    assert.equal(normalizarEstadoMexico(estado.nombre), estado.codigo)
    assert.equal(normalizarEstadoMexico(estado.codigo), estado.codigo)
  }
})

test('ignora acentos, mayúsculas y espacios repetidos', () => {
  assert.equal(normalizarEstadoMexico('  NUEVO   LEON '), 'MX-NLE')
  assert.equal(normalizarEstadoMexico('yucatan'), 'MX-YUC')
})

test('abreviaturas de Nuevo León con o sin puntos y espacios', () => {
  for (const texto of ['N.L.', 'n.l.', 'N.L', 'NL', 'nl', 'N L', 'n l', 'N. L.', ' n.l. ']) {
    assert.equal(normalizarEstadoMexico(texto), 'MX-NLE', texto)
  }
})

test('variantes con puntuación de los alias existentes', () => {
  assert.equal(normalizarEstadoMexico('D.F.'), 'MX-CMX')
  assert.equal(normalizarEstadoMexico('CDMX'), 'MX-CMX')
  assert.equal(normalizarEstadoMexico('C.D.M.X.'), 'MX-CMX')
  assert.equal(normalizarEstadoMexico('Edo. Méx.'), 'MX-MEX')
  assert.equal(normalizarEstadoMexico('Edomex'), 'MX-MEX')
  assert.equal(normalizarEstadoMexico('Querétaro de Arteaga'), 'MX-QUE')
})

test('textos ambiguos o desconocidos devuelven null', () => {
  for (const texto of ['México', 'mexico', 'Méx.', 'MEX', 'N.', 'L', '', null, undefined, 'Texas', 'Nuevo Le�n']) {
    assert.equal(normalizarEstadoMexico(texto), null, String(texto))
  }
})

test('nombre oficial a partir del código', () => {
  assert.equal(nombreEstadoMexico('MX-NLE'), 'Nuevo León')
  assert.equal(nombreEstadoMexico('MX-XXX'), null)
})

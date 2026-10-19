// Pruebas de la conversión de escalones de un recibo de CFE. Ejecutar con: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertirRecibo } from './reciboCfe.js'

const cerca = (real, esperado) => assert.ok(Math.abs(real - esperado) < 1e-6, `esperado ${esperado}, se obtuvo ${real}`)

test('recibo mensual sin IVA: los valores pasan igual', () => {
  const r = convertirRecibo({ escalones: [{ kwh: 75, precio: 1 }, { kwh: 65, precio: 1.2 }, { kwh: '', precio: 3.5 }], periodo: 'mensual' })
  assert.deepEqual(r.errores, [])
  assert.deepEqual(r.bloques.map((b) => [b.desde_kwh, b.hasta_kwh, b.precio_kwh]), [[0, 75, 1], [75, 140, 1.2], [140, null, 3.5]])
})

test('recibo bimestral: los kWh de cada escalón se dividen entre 2 y el precio no cambia', () => {
  // Básico 150 kWh en el bimestre → 75 kWh/mes; Intermedio 130 → 65; el límite acumulado queda en 75 y 140.
  const r = convertirRecibo({ escalones: [{ kwh: 150, precio: 1 }, { kwh: 130, precio: 1.2 }, { kwh: null, precio: 3.5 }], periodo: 'bimestral' })
  assert.deepEqual(r.bloques.map((b) => [b.desde_kwh, b.hasta_kwh, b.precio_kwh]), [[0, 75, 1], [75, 140, 1.2], [140, null, 3.5]])
})

test('precios con IVA: se dividen entre 1 + IVA', () => {
  // $1.16 con IVA del 16% → $1.00 sin IVA
  const r = convertirRecibo({ escalones: [{ kwh: 75, precio: 1.16 }, { kwh: null, precio: 3.48 }], preciosConIva: true, iva: 0.16 })
  cerca(r.bloques[0].precio_kwh, 1)
  cerca(r.bloques[1].precio_kwh, 3)
})

test('cargo fijo bimestral con IVA → mensual sin IVA', () => {
  // $232 en el bimestre con IVA → 232 / 1.16 = 200 → 100 al mes
  const r = convertirRecibo({ escalones: [{ kwh: null, precio: 6 }], periodo: 'bimestral', preciosConIva: true, iva: 0.16, cargoFijo: '232' })
  cerca(r.cargo_fijo_mensual, 100)
})

test('el último escalón siempre queda sin límite aunque traiga kWh', () => {
  const r = convertirRecibo({ escalones: [{ kwh: 75, precio: 1 }, { kwh: 999, precio: 2 }] })
  assert.equal(r.bloques[1].hasta_kwh, null)
})

test('errores por escalón: falta kWh, kWh no positivo y precio negativo', () => {
  const r = convertirRecibo({ escalones: [{ kwh: '', precio: 1 }, { kwh: 0, precio: -1 }, { kwh: null, precio: 2 }] })
  assert.deepEqual(r.errores.map((e) => [e.indice, e.campo]), [[0, 'kwh'], [1, 'kwh'], [1, 'precio']])
})

test('precio vacío no es error: queda como "sin capturar"', () => {
  const r = convertirRecibo({ escalones: [{ kwh: 75, precio: '' }, { kwh: null, precio: 2 }] })
  assert.deepEqual(r.errores, [])
  assert.equal(r.bloques[0].precio_kwh, null)
})

test('máximo 4 escalones', () => {
  const r = convertirRecibo({ escalones: Array.from({ length: 5 }, () => ({ kwh: 10, precio: 1 })) })
  assert.equal(r.errores[0].campo, 'escalones')
})

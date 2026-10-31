import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proyectarContado } from './proyeccionContado.js'

const datos = () => ({ consumo_mensual_kwh: 300, kwp: 1, irradiacion: { hsp: 5 },
  parametros: { eficiencia: 0.8, degradacion_anual: 0, alza_tarifa_anual: 0, iva: 0, meses_verano: 6 },
  tarifa: { codigo: 'SOLO-PRUEBA', tipo: 'comercial', cargo_fijo_mensual: 50,
    bloques: [{ temporada: 'todo_el_anio', orden: 1, desde_kwh: 0, hasta_kwh: null, precio_kwh: 2 }] } })

test('contado: unidades, gasto, ahorro anual, recuperación y punto de cruce coherentes', () => {
  const { resultado: r } = proyectarContado(datos(), 5840)
  assert.equal(r.generacion_anual_kwh, 1460)
  assert.equal(r.gasto_mensual_sin_sistema, 650)
  assert.equal(r.gasto_mensual_con_sistema, 406.67)
  assert.equal(r.ahorro_anual, 2920)
  assert.ok(Math.abs(r.ahorro_mensual * 12 - r.ahorro_anual) <= 0.06)
  assert.equal(r.retorno_inversion_anios, 2)
  assert.equal(r.serie[1].acumulado, 5840)
})
test('sin datos, tarifa incompleta, importes inválidos y parámetros inválidos no producen números engañosos', () => {
  for (const importe of [0, -1, Infinity, NaN]) assert.equal(proyectarContado(datos(), importe).estado, 'no_disponible')
  assert.equal(proyectarContado(null, 100).estado, 'no_disponible')
  const d = datos(); d.tarifa.bloques[0].precio_kwh = null
  assert.equal(proyectarContado(d, 100).estado, 'tarifa_sin_precios')
  d.parametros.degradacion_anual = 2
  assert.equal(proyectarContado(d, 100).estado, 'no_disponible')
  const incompleta = datos(); incompleta.paneles = [{ potencia_w: null, cantidad: 1 }]
  assert.equal(proyectarContado(incompleta, 100).estado, 'no_disponible')
})
test('ahorro cero y recuperación fuera del horizonte conservan null sin dividir por cero', () => {
  const d = datos(); d.tarifa.bloques[0].precio_kwh = 0
  const cero = proyectarContado(d, 100).resultado
  assert.equal(cero.ahorro_anual, 0); assert.equal(cero.retorno_inversion_anios, null)
  assert.ok(cero.serie.every((fila) => fila.acumulado === 0))
  const lejana = proyectarContado(datos(), 1e7).resultado
  assert.equal(lejana.retorno_inversion_anios, null); assert.equal(lejana.serie.length, 10)
})

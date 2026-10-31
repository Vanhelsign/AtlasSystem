import { test } from 'node:test'
import assert from 'node:assert/strict'
import { progresoCliente } from './progresoCliente.js'
const etapas = (...marcas) => marcas.map((completa, i) => ({ parte: i + 1, completa }))
test('cuatro hitos exactos: pago confirmado, sin trabajo técnico y sin pulsación', () => {
  const p = progresoCliente({ estatus_obra: 'asignada' }, etapas(false, false, false))
  assert.deepEqual(p.etapas.map(e => e.nombre), ['Pago confirmado', 'Preparación', 'Montaje y conexiones', 'Verificación final'])
  assert.deepEqual(p.etapas.map(e => e.completada), [true, false, false, false])
  assert.equal(p.fase_actual, null); assert.equal(p.estado, 'sin_iniciar')
})
test('cada fase depende del checklist guardado, no de parte_actual abierta', () => {
  const orden = { iniciada_at: '2026-01-01', parte_actual: 3, estatus_obra: 'en_progreso' }
  assert.equal(progresoCliente(orden, etapas(false, false, false)).fase_actual, 1)
  assert.equal(progresoCliente(orden, etapas(true, false, false)).fase_actual, 2)
  const ultima = progresoCliente(orden, etapas(true, true, true))
  assert.equal(ultima.fase_actual, 3); assert.equal(ultima.etapas[3].completada, false, 'requiere cerrar la instalación')
})
test('incidencia o postergación conservan verificaciones y detienen el pulso', () => {
  for (const orden of [{ iniciada_at: '2026-01-01', estatus_obra: 'incidencia' }, { iniciada_at: '2026-01-01', postergada_at: '2026-01-02' }]) {
    const p = progresoCliente(orden, etapas(true, false, false))
    assert.equal(p.fase_actual, null); assert.equal(p.etapas[1].completada, true)
  }
})
test('cierre y verificaciones completas dejan los cuatro hitos verdes y estáticos', () => {
  const p = progresoCliente({ estatus_obra: 'completada', iniciada_at: '2026-01-01' }, etapas(true, true, true))
  assert.ok(p.etapas.every(e => e.completada && !e.actual)); assert.equal(p.estado, 'finalizada')
})
test('orden temporalmente ausente no inventa fases completadas ni técnico sin asignar', () => {
  const p = progresoCliente(null)
  assert.equal(p.estado, 'espera'); assert.equal(p.fase_actual, null)
  assert.deepEqual(p.etapas.map(e => e.completada), [true, false, false, false])
})

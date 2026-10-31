import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pagoPruebaFrontend } from './pagoPrueba.js'

test('el botón se habilita por defecto en desarrollo, admite desactivación y nunca aparece en un build o producción', () => {
  const activo = { ATLAS_DEV_SERVER: true, DEV: true, PROD: false }
  assert.equal(pagoPruebaFrontend(activo), true)
  assert.equal(pagoPruebaFrontend({ ...activo, VITE_ATLAS_PAGO_SIMULADO: 'true' }), true)
  for (const cambio of [{ ATLAS_DEV_SERVER: false }, { DEV: false }, { PROD: true }, { VITE_ATLAS_PAGO_SIMULADO: 'false' }]) {
    assert.equal(pagoPruebaFrontend({ ...activo, ...cambio }), false)
  }
})

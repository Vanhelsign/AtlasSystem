import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repartirPrecioVenta } from './preciosVenta.js'

test('el prorrateo comercial conserva el total exacto en centavos incluso con costo cero y cantidades impares', () => {
  for (const precio of [0.01, 875.37, 150000, 962.5]) {
    for (const costo of [0, 100]) {
      const precios = repartirPrecioVenta([{ cantidad: 3, subtotal_interno: costo }, { cantidad: 7, subtotal_interno: costo }, { cantidad: 11, subtotal_interno: costo }], precio)
      assert.equal(precios.reduce((s, item) => s + Math.round(item.subtotal_venta * 100), 0), Math.round(precio * 100))
      assert.ok(precios.every((item) => item.precio_unitario_venta >= 0))
    }
  }
})

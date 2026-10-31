// Prorrateo comercial en centavos: el total confirmado manda, no el inventario actual.
export function repartirPrecioVenta(items, precioVenta) {
  const centavos = Math.round(Number(precioVenta) * 100)
  if (!items.length || !Number.isSafeInteger(centavos) || centavos <= 0) throw new Error('Precio o conceptos inválidos')
  let pesos = items.map((item) => Math.max(0, Number(item.subtotal_interno ?? item.subtotal) || 0))
  if (!pesos.some(Boolean)) pesos = items.map((item) => Number(item.cantidad))
  const pesoTotal = pesos.reduce((a, b) => a + b, 0)
  const cuotas = pesos.map((peso, indice) => {
    const exacto = centavos * peso / pesoTotal
    return { indice, base: Math.floor(exacto), resto: exacto - Math.floor(exacto) }
  })
  let faltan = centavos - cuotas.reduce((suma, cuota) => suma + cuota.base, 0)
  const ordenadas = [...cuotas].sort((a, b) => b.resto - a.resto || a.indice - b.indice)
  for (let i = 0; faltan > 0; i++, faltan--) ordenadas[i % ordenadas.length].base++
  return cuotas.map((cuota, indice) => ({
    precio_unitario_venta: Number((cuota.base / 100 / items[indice].cantidad).toFixed(6)),
    subtotal_venta: cuota.base / 100,
  }))
}

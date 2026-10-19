// Convierte los escalones tal como aparecen en un recibo de CFE a bloques mensuales sin IVA,
// que es como ATLAS guarda las tarifas. Módulo puro: se usa en la pantalla de tarifas y en las pruebas.
//
// Cada escalón del recibo trae los kWh que abarca en el periodo facturado (el último no tiene límite)
// y su precio por kWh. En un recibo bimestral los kWh de cada escalón cubren dos meses, así que se dividen
// entre 2; el precio por kWh no cambia con el periodo. El cargo fijo del periodo también se divide entre 2.

export const MAX_ESCALONES = 4

const redondear = (valor, decimales) => Math.round(valor * 10 ** decimales) / 10 ** decimales
const numero = (valor) => valor === '' || valor === null || valor === undefined ? null : Number(valor)

/**
 * @param {{ escalones: { kwh: number|string|null, precio: number|string|null }[], periodo?: 'mensual'|'bimestral',
 *           preciosConIva?: boolean, iva?: number, cargoFijo?: number|string|null }} recibo
 * @returns {{ bloques: { orden: number, desde_kwh: number, hasta_kwh: number|null, precio_kwh: number|null }[],
 *             cargo_fijo_mensual: number|null, errores: { indice: number|null, campo: string, mensaje: string }[] }}
 */
export function convertirRecibo({ escalones, periodo = 'mensual', preciosConIva = false, iva = 0.16, cargoFijo = null }) {
  const errores = []
  if (!['mensual', 'bimestral'].includes(periodo)) errores.push({ indice: null, campo: 'periodo', mensaje: 'El periodo debe ser mensual o bimestral' })
  if (!Array.isArray(escalones) || escalones.length === 0) errores.push({ indice: null, campo: 'escalones', mensaje: 'Captura al menos un escalón' })
  else if (escalones.length > MAX_ESCALONES) errores.push({ indice: null, campo: 'escalones', mensaje: `Máximo ${MAX_ESCALONES} escalones` })
  if (!(iva >= 0 && iva < 1)) errores.push({ indice: null, campo: 'iva', mensaje: 'El IVA debe estar entre 0 y 1' })
  if (errores.length) return { bloques: [], cargo_fijo_mensual: null, errores }

  const meses = periodo === 'bimestral' ? 2 : 1
  const sinIva = (precio) => preciosConIva ? precio / (1 + iva) : precio
  let desde = 0
  const bloques = escalones.map((escalon, indice) => {
    const ultimo = indice === escalones.length - 1
    const kwh = numero(escalon.kwh)
    const precio = numero(escalon.precio)
    let hasta = null
    if (!ultimo) {
      if (kwh === null) errores.push({ indice, campo: 'kwh', mensaje: 'Escribe los kWh que abarca este escalón en el recibo' })
      else if (!Number.isFinite(kwh) || kwh <= 0) errores.push({ indice, campo: 'kwh', mensaje: 'Los kWh del escalón deben ser mayores que cero' })
      else hasta = redondear(desde + kwh / meses, 3)
    }
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) errores.push({ indice, campo: 'precio', mensaje: 'El precio debe ser un número no negativo' })
    const bloque = {
      orden: indice + 1,
      desde_kwh: redondear(desde, 3),
      hasta_kwh: ultimo ? null : hasta,
      precio_kwh: precio === null || !Number.isFinite(precio) || precio < 0 ? null : redondear(sinIva(precio), 6),
    }
    if (hasta !== null) desde = hasta
    return bloque
  })

  const cargo = numero(cargoFijo)
  let cargoMensual = null
  if (cargo !== null) {
    if (!Number.isFinite(cargo) || cargo < 0) errores.push({ indice: null, campo: 'cargo_fijo', mensaje: 'El cargo fijo debe ser un número no negativo' })
    else cargoMensual = redondear(sinIva(cargo) / meses, 6)
  }
  return { bloques, cargo_fijo_mensual: cargoMensual, errores }
}

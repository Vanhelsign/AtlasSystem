export const dineroCompra = (valor, decimales = 2) => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: decimales,
}).format(valor ?? 0)
export const fechaCompra = (valor) => valor ? new Date(valor.includes('T') ? valor : `${valor.replace(' ', 'T')}Z`).toLocaleString('es-MX') : 'No registrada'

export async function pedirCompra(token, ruta, cuerpo, opciones = {}) {
  const respuesta = await fetch(ruta, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: opciones.signal,
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  })
  const datos = await respuesta.json()
  if (!respuesta.ok) throw new Error(datos.error || 'No se pudo completar la operación')
  return datos
}

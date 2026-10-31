import { estimarAhorro } from './ahorroSolar.js'

/** Proyección de contado v1. Solo usa la copia energética de la cotización,
 * nunca el catálogo ni tarifas actuales. kWp × HSP (h/día) × 365 × eficiencia
 * produce kWh/año. Ahorro = gasto sin sistema - gasto con sistema (MXN).
 * La recuperación interpola el año en que el ahorro acumulado cubre el pago;
 * la serie aplica los supuestos guardados de degradación y alza tarifaria.
 */
export function proyectarContado(supuestos, importe) {
  const falta = (motivo) => ({ estado: 'no_disponible', motivo })
  if (!Number.isFinite(importe) || importe <= 0) return falta('No hay un importe de contado válido registrado.')
  if (!supuestos?.tarifa || !supuestos?.irradiacion || !supuestos?.parametros) return falta('Esta compra no conserva todos los supuestos energéticos y eléctricos necesarios. No se sustituyen por valores actuales.')
  if (supuestos.paneles?.some((panel) => !Number.isFinite(panel.potencia_w) || panel.potencia_w <= 0 || !Number.isFinite(panel.cantidad) || panel.cantidad <= 0)) return falta('Falta potencia o cantidad válida en los paneles de la cotización; no se calcula una generación parcial.')
  const p = supuestos.parametros
  if (![p.eficiencia, p.meses_verano].every(Number.isFinite)) return falta('Faltan parámetros técnicos de la estimación original.')
  if (![p.degradacion_anual, p.alza_tarifa_anual, p.iva].every(Number.isFinite)
    || p.degradacion_anual < 0 || p.degradacion_anual >= 1 || p.alza_tarifa_anual < 0 || p.alza_tarifa_anual > 1 || p.iva < 0 || p.iva > 1) return falta('Los supuestos económicos guardados no son válidos.')
  try {
    const resultado = estimarAhorro({ consumoMensualKwh: supuestos.consumo_mensual_kwh,
      kwp: supuestos.kwp, hsp: supuestos.irradiacion.hsp, parametros: p,
      tarifa: supuestos.tarifa, tarifaDac: supuestos.tarifa_dac, precioVenta: importe })
    if (resultado.estado !== 'calculada') return resultado
    if (resultado.gasto_mensual_con_sistema > resultado.gasto_mensual_sin_sistema) return falta('Los supuestos guardados producen un gasto con sistema mayor que sin sistema. No hay ahorro recuperable; se requiere revisar los cargos y las tarifas consideradas.')
    if (![resultado.ahorro_anual, resultado.generacion_anual_kwh, resultado.gasto_mensual_sin_sistema, resultado.gasto_mensual_con_sistema].every(Number.isFinite)
      || !resultado.serie.every((fila) => Number.isFinite(fila.acumulado))) return falta('Los datos guardados no permiten obtener cifras finitas.')
    return { estado: 'calculada', resultado }
  } catch (err) { return falta(`No se puede estimar esta compra: ${err.message}`) }
}

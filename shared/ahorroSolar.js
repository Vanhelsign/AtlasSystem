// Estimación de ahorro y retorno de inversión de un sistema fotovoltaico.
// Módulo puro: no accede a la base de datos ni al DOM, por lo que se usa igual en el servidor y en las pruebas.
//
// Forma de una tarifa:
//   { codigo, nombre, tipo: 'domestica' | 'dac' | 'comercial', limite_dac_kwh, cargo_fijo_mensual,
//     bloques: [{ temporada: 'todo_el_anio' | 'verano' | 'fuera_verano', orden, desde_kwh, hasta_kwh, precio_kwh }] }
// Los precios y el cargo fijo se guardan sin IVA; el IVA se aplica al calcular.

export const TEMPORADAS = ['todo_el_anio', 'verano', 'fuera_verano']
export const MAX_BLOQUES = 4
export const HORIZONTE_MAXIMO_ANIOS = 30
export const ANIOS_MINIMOS_GRAFICA = 10
export const PARAMETROS_POR_DEFECTO = {
  eficiencia: 0.8,
  degradacion_anual: 0.005,
  alza_tarifa_anual: 0,
  iva: 0.16,
  meses_verano: 6,
}

const redondear = (valor, decimales = 2) => valor === null || valor === undefined ? null : Math.round(valor * 10 ** decimales) / 10 ** decimales

export function agruparBloques(bloques = []) {
  const grupos = new Map()
  for (const bloque of bloques) {
    if (!grupos.has(bloque.temporada)) grupos.set(bloque.temporada, [])
    grupos.get(bloque.temporada).push(bloque)
  }
  for (const lista of grupos.values()) lista.sort((a, b) => a.orden - b.orden)
  return grupos
}

// Devuelve la lista de errores; vacía si los bloques son válidos.
export function validarBloques(bloques) {
  if (!Array.isArray(bloques) || bloques.length === 0) return ['La tarifa necesita al menos un bloque']
  const errores = []
  for (const bloque of bloques) {
    if (!TEMPORADAS.includes(bloque.temporada)) errores.push(`Temporada no válida: ${bloque.temporada}`)
  }
  if (errores.length) return errores
  const grupos = agruparBloques(bloques)
  if (grupos.has('todo_el_anio') && (grupos.has('verano') || grupos.has('fuera_verano'))) {
    errores.push('Usa un solo juego de bloques para todo el año o juegos por temporada, no ambos')
  }
  const nombres = { todo_el_anio: 'todo el año', verano: 'verano', fuera_verano: 'fuera de verano' }
  for (const [temporada, lista] of grupos) {
    const etiqueta = nombres[temporada]
    if (lista.length > MAX_BLOQUES) errores.push(`Máximo ${MAX_BLOQUES} bloques por temporada (${etiqueta})`)
    lista.forEach((bloque, indice) => {
      const numero = indice + 1
      const desde = Number(bloque.desde_kwh)
      const hasta = bloque.hasta_kwh === null || bloque.hasta_kwh === undefined ? null : Number(bloque.hasta_kwh)
      const ultimo = indice === lista.length - 1
      if (bloque.orden !== numero) errores.push(`Los bloques de ${etiqueta} deben numerarse del 1 al ${lista.length}`)
      if (!Number.isFinite(desde) || desde < 0) errores.push(`Bloque ${numero} (${etiqueta}): el inicio debe ser un número no negativo`)
      if (indice === 0 && desde !== 0) errores.push(`El primer bloque de ${etiqueta} debe empezar en 0 kWh`)
      if (indice > 0) {
        const anterior = lista[indice - 1].hasta_kwh
        if (anterior === null || anterior === undefined || Number(anterior) !== desde) {
          errores.push(`Bloque ${numero} (${etiqueta}) debe empezar donde termina el bloque ${numero - 1}`)
        }
      }
      if (ultimo && hasta !== null) errores.push(`El último bloque de ${etiqueta} debe quedar abierto (sin límite superior)`)
      if (!ultimo && hasta === null) errores.push(`Solo el último bloque de ${etiqueta} puede quedar abierto`)
      if (hasta !== null && (!Number.isFinite(hasta) || hasta <= desde)) errores.push(`Bloque ${numero} (${etiqueta}): el límite superior debe ser mayor que el inicio`)
      if (bloque.precio_kwh !== null && bloque.precio_kwh !== undefined && (!Number.isFinite(Number(bloque.precio_kwh)) || Number(bloque.precio_kwh) < 0)) {
        errores.push(`Bloque ${numero} (${etiqueta}): el precio debe ser un número no negativo`)
      }
    })
  }
  return [...new Set(errores)]
}

// Una tarifa sin precios capturados no permite estimar: se informa en lugar de mostrar cifras.
export function faltantesDeTarifa(tarifa) {
  if (!tarifa) return ['tarifa no encontrada']
  const faltantes = []
  if (tarifa.cargo_fijo_mensual === null || tarifa.cargo_fijo_mensual === undefined) faltantes.push(`cargo fijo de ${tarifa.codigo}`)
  if (!tarifa.bloques?.length) faltantes.push(`bloques de ${tarifa.codigo}`)
  else if (tarifa.bloques.some((bloque) => bloque.precio_kwh === null || bloque.precio_kwh === undefined)) faltantes.push(`precios por kWh de ${tarifa.codigo}`)
  return faltantes
}

function bloquesPara(tarifa, temporada) {
  const grupos = agruparBloques(tarifa.bloques)
  if (grupos.has(temporada)) return grupos.get(temporada)
  // Una tarifa con un solo juego lo usa en cualquier temporada.
  if (grupos.size === 1) return [...grupos.values()][0]
  throw new Error(`La tarifa ${tarifa.codigo} no tiene bloques para la temporada ${temporada}`)
}

export function costoEnergia(kwh, bloques) {
  return bloques.reduce((total, bloque) => {
    const hasta = bloque.hasta_kwh === null || bloque.hasta_kwh === undefined ? Infinity : Number(bloque.hasta_kwh)
    const tramo = Math.max(0, Math.min(kwh, hasta) - Number(bloque.desde_kwh))
    return total + tramo * Number(bloque.precio_kwh)
  }, 0)
}

export function aplicaDac(kwh, tarifa) {
  return tarifa.tipo === 'domestica' && tarifa.limite_dac_kwh !== null && tarifa.limite_dac_kwh !== undefined && kwh > Number(tarifa.limite_dac_kwh)
}

// Costo de un mes con IVA. Una tarifa doméstica que supera su límite se cobra con la tarifa DAC.
export function costoMensual(kwh, { tarifa, tarifaDac = null, temporada = 'todo_el_anio', iva = PARAMETROS_POR_DEFECTO.iva }) {
  const dac = aplicaDac(kwh, tarifa)
  if (dac && !tarifaDac) throw new Error(`La tarifa ${tarifa.codigo} supera su límite DAC y no tiene una tarifa DAC asignada`)
  const aplicada = dac ? tarifaDac : tarifa
  const energia = costoEnergia(kwh, bloquesPara(aplicada, temporada))
  const cargoFijo = Number(aplicada.cargo_fijo_mensual ?? 0)
  const subtotal = energia + cargoFijo
  return { total: subtotal * (1 + iva), subtotal, energia, cargo_fijo: cargoFijo, dac, tarifa_codigo: aplicada.codigo, temporada }
}

export function temporadasDe(tarifa, mesesVerano = PARAMETROS_POR_DEFECTO.meses_verano) {
  const grupos = agruparBloques(tarifa.bloques)
  if (grupos.has('verano') && grupos.has('fuera_verano')) return [['verano', mesesVerano], ['fuera_verano', 12 - mesesVerano]]
  return [['todo_el_anio', 12]]
}

// Costo anual ponderando verano y fuera de verano cuando la tarifa tiene ambos juegos.
export function costoAnual(kwhMensual, { tarifa, tarifaDac = null, iva = PARAMETROS_POR_DEFECTO.iva, mesesVerano = PARAMETROS_POR_DEFECTO.meses_verano }) {
  const detalle = temporadasDe(tarifa, mesesVerano)
    .filter(([, meses]) => meses > 0)
    .map(([temporada, meses]) => ({ meses, ...costoMensual(kwhMensual, { tarifa, tarifaDac, temporada, iva }) }))
  const anual = detalle.reduce((total, mes) => total + mes.total * mes.meses, 0)
  return { anual, mensual_promedio: anual / 12, detalle }
}

export function kwpDePaneles(paneles = []) {
  return paneles.reduce((total, panel) => total + Number(panel.cantidad) * Number(panel.potencia_w), 0) / 1000
}

/**
 * Estima ahorro, recuperación y serie anual.
 * Devuelve { estado: 'calculada', ... } o { estado: 'sin_paneles' | 'tarifa_sin_precios', motivo, ... } sin cifras.
 */
export function estimarAhorro({ consumoMensualKwh, kwp, hsp, parametros = {}, tarifa, tarifaDac = null, precioVenta }) {
  const p = { ...PARAMETROS_POR_DEFECTO, ...parametros }
  const consumo = Number(consumoMensualKwh)
  const potencia = Number(kwp)
  if (!Number.isFinite(consumo) || consumo <= 0) throw new Error('El consumo mensual debe ser mayor que cero')
  if (!Number.isFinite(Number(precioVenta)) || Number(precioVenta) <= 0) throw new Error('El precio de venta debe ser mayor que cero')
  if (!Number.isFinite(Number(hsp)) || Number(hsp) <= 0) throw new Error('Las horas solares pico deben ser mayores que cero')
  if (!(p.eficiencia > 0 && p.eficiencia <= 1)) throw new Error('La eficiencia debe estar entre 0 y 1')
  if (!(p.meses_verano >= 0 && p.meses_verano <= 12)) throw new Error('Los meses de verano deben estar entre 0 y 12')

  if (!Number.isFinite(potencia) || potencia <= 0) {
    return { estado: 'sin_paneles', motivo: 'La cotización no incluye paneles con potencia registrada, por lo que no hay generación que estimar.' }
  }
  const faltantes = faltantesDeTarifa(tarifa)
  if (aplicaDac(consumo, tarifa)) faltantes.push(...(tarifaDac ? faltantesDeTarifa(tarifaDac) : ['tarifa DAC asignada']))
  if (faltantes.length) {
    return { estado: 'tarifa_sin_precios', motivo: `La tarifa ${tarifa?.codigo ?? ''} todavía no tiene precios capturados; falta: ${faltantes.join(', ')}.`, faltantes }
  }

  const generacionAnual = potencia * Number(hsp) * 365 * p.eficiencia
  const generacionMensual = generacionAnual / 12
  // Sin pagos por excedente: lo generado de más no reduce el recibo por debajo de cero consumo.
  const consumoNeto = Math.max(consumo - generacionMensual, 0)
  const opciones = { tarifa, tarifaDac, iva: p.iva, mesesVerano: p.meses_verano }
  const sinSistema = costoAnual(consumo, opciones)
  const conSistema = costoAnual(consumoNeto, opciones)
  const ahorroAnual = Math.max(sinSistema.anual - conSistema.anual, 0)

  const serieCompleta = []
  let acumulado = 0
  let recuperacion = null
  for (let anio = 1; anio <= HORIZONTE_MAXIMO_ANIOS; anio += 1) {
    const ahorro = ahorroAnual * (1 - p.degradacion_anual) ** (anio - 1) * (1 + p.alza_tarifa_anual) ** (anio - 1)
    const anterior = acumulado
    acumulado += ahorro
    if (recuperacion === null && ahorro > 0 && acumulado >= Number(precioVenta)) {
      recuperacion = anio - 1 + (Number(precioVenta) - anterior) / ahorro
    }
    serieCompleta.push({ anio, ahorro, acumulado })
  }
  const aniosGrafica = recuperacion === null
    ? ANIOS_MINIMOS_GRAFICA
    : Math.min(HORIZONTE_MAXIMO_ANIOS, Math.max(ANIOS_MINIMOS_GRAFICA, Math.ceil(recuperacion) + 2))

  return {
    estado: 'calculada',
    kwp: redondear(potencia, 3),
    hsp: Number(hsp),
    consumo_mensual_kwh: redondear(consumo),
    generacion_anual_kwh: redondear(generacionAnual),
    generacion_mensual_kwh: redondear(generacionMensual),
    consumo_neto_mensual_kwh: redondear(consumoNeto),
    generacion_supera_consumo: generacionMensual > consumo,
    dac_sin_sistema: sinSistema.detalle.some((mes) => mes.dac),
    dac_con_sistema: conSistema.detalle.some((mes) => mes.dac),
    gasto_mensual_sin_sistema: redondear(sinSistema.mensual_promedio),
    gasto_mensual_con_sistema: redondear(conSistema.mensual_promedio),
    gasto_anual_sin_sistema: redondear(sinSistema.anual),
    gasto_anual_con_sistema: redondear(conSistema.anual),
    ahorro_mensual: redondear(ahorroAnual / 12),
    ahorro_anual: redondear(ahorroAnual),
    precio_venta: redondear(Number(precioVenta)),
    retorno_inversion_anios: redondear(recuperacion),
    serie: serieCompleta.slice(0, aniosGrafica).map((fila) => ({ anio: fila.anio, ahorro: redondear(fila.ahorro), acumulado: redondear(fila.acumulado) })),
    parametros: p,
  }
}

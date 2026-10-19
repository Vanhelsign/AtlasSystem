// Pruebas de shared/ahorroSolar.js con valores calculados a mano. Ejecutar con: npm test
// Las tarifas de estas pruebas son ficticias y simples para que las cuentas se puedan verificar con calculadora.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  costoAnual,
  costoMensual,
  estimarAhorro,
  faltantesDeTarifa,
  kwpDePaneles,
  validarBloques,
} from './ahorroSolar.js'

const cerca = (real, esperado, tolerancia = 0.01) => assert.ok(Math.abs(real - esperado) <= tolerancia, `esperado ${esperado}, se obtuvo ${real}`)

// Doméstica: 0–75 kWh a $1, 75–140 a $2, más de 140 a $3; sin cargo fijo; DAC por encima de 250 kWh/mes.
const DOMESTICA = {
  codigo: 'PRUEBA-1', tipo: 'domestica', limite_dac_kwh: 250, cargo_fijo_mensual: 0,
  bloques: [
    { temporada: 'todo_el_anio', orden: 1, desde_kwh: 0, hasta_kwh: 75, precio_kwh: 1 },
    { temporada: 'todo_el_anio', orden: 2, desde_kwh: 75, hasta_kwh: 140, precio_kwh: 2 },
    { temporada: 'todo_el_anio', orden: 3, desde_kwh: 140, hasta_kwh: null, precio_kwh: 3 },
  ],
}
// DAC: cargo fijo $100 y $5 por kWh.
const DAC = { codigo: 'PRUEBA-DAC', tipo: 'dac', limite_dac_kwh: null, cargo_fijo_mensual: 100, bloques: [{ temporada: 'todo_el_anio', orden: 1, desde_kwh: 0, hasta_kwh: null, precio_kwh: 5 }] }
// Comercial: cargo fijo $50 y precio plano de $4 por kWh.
const COMERCIAL = { codigo: 'PRUEBA-COM', tipo: 'comercial', limite_dac_kwh: null, cargo_fijo_mensual: 50, bloques: [{ temporada: 'todo_el_anio', orden: 1, desde_kwh: 0, hasta_kwh: null, precio_kwh: 4 }] }
// Sin degradación para que la recuperación se pueda verificar a mano; IVA 16%.
const SIN_DEGRADACION = { eficiencia: 0.8, degradacion_anual: 0, alza_tarifa_anual: 0, iva: 0.16, meses_verano: 6 }

describe('costo por bloques', () => {
  test('consumo dentro del primer bloque', () => {
    // 60 kWh × $1 = $60; con IVA 60 × 1.16 = $69.60
    cerca(costoMensual(60, { tarifa: DOMESTICA, iva: 0.16 }).total, 69.6)
  })
  test('consumo que cruza los tres bloques', () => {
    // 75×1 + 65×2 + 60×3 = 75 + 130 + 180 = $385; con IVA $446.60
    const costo = costoMensual(200, { tarifa: DOMESTICA, iva: 0.16 })
    cerca(costo.energia, 385)
    cerca(costo.total, 446.6)
    assert.equal(costo.dac, false)
  })
  test('por encima del límite DAC se cobra con la tarifa DAC', () => {
    // (100 + 400×5) × 1.16 = 2100 × 1.16 = $2,436
    const costo = costoMensual(400, { tarifa: DOMESTICA, tarifaDac: DAC, iva: 0.16 })
    assert.equal(costo.dac, true)
    assert.equal(costo.tarifa_codigo, 'PRUEBA-DAC')
    cerca(costo.total, 2436)
  })
})

describe('estimación de ahorro', () => {
  test('consumo bajo: el ahorro es lo generado al precio del primer bloque', () => {
    // Generación: 0.2 kWp × 5 h × 365 × 0.8 = 292 kWh/año = 24.333 kWh/mes
    // Sin sistema: 60 × 1 × 1.16 = $69.60; con sistema: (60 − 24.333) × 1.16 = $41.37
    // Ahorro mensual: 24.333 × 1.16 = $28.23
    const r = estimarAhorro({ consumoMensualKwh: 60, kwp: 0.2, hsp: 5, parametros: SIN_DEGRADACION, tarifa: DOMESTICA, tarifaDac: DAC, precioVenta: 5000 })
    assert.equal(r.estado, 'calculada')
    cerca(r.generacion_anual_kwh, 292)
    cerca(r.gasto_mensual_sin_sistema, 69.6)
    cerca(r.gasto_mensual_con_sistema, 41.37)
    cerca(r.ahorro_mensual, 28.23)
  })

  test('consumo medio y tiempo de recuperación interpolado', () => {
    // Generación: 1 kWp × 5 × 365 × 0.8 = 1,460 kWh/año = 121.667 kWh/mes
    // Sin sistema: $446.60 (ver costo por bloques)
    // Con sistema: 78.333 kWh → 75×1 + 3.333×2 = 81.667 × 1.16 = $94.73
    // Ahorro mensual: 446.60 − 94.73 = $351.87; anual: $4,222.40
    // Recuperación con precio $10,000 y sin degradación: 2 + (10,000 − 8,444.80) / 4,222.40 = 2.368 años
    const r = estimarAhorro({ consumoMensualKwh: 200, kwp: 1, hsp: 5, parametros: SIN_DEGRADACION, tarifa: DOMESTICA, tarifaDac: DAC, precioVenta: 10000 })
    cerca(r.gasto_mensual_con_sistema, 94.73)
    cerca(r.ahorro_mensual, 351.87)
    cerca(r.ahorro_anual, 4222.4)
    cerca(r.retorno_inversion_anios, 2.37)
    assert.equal(r.serie.length, 10, 'la gráfica muestra al menos 10 años')
    cerca(r.serie[2].acumulado, 12667.2)
  })

  test('degradación anual reduce el ahorro de cada año', () => {
    // Año 2 = año 1 × (1 − 0.005); año 3 = año 1 × 0.995²
    const r = estimarAhorro({ consumoMensualKwh: 200, kwp: 1, hsp: 5, parametros: { ...SIN_DEGRADACION, degradacion_anual: 0.005 }, tarifa: DOMESTICA, tarifaDac: DAC, precioVenta: 10000 })
    cerca(r.serie[1].ahorro, 4222.4 * 0.995)
    cerca(r.serie[2].ahorro, 4222.4 * 0.995 ** 2)
  })

  test('DAC: con el sistema el consumo neto baja del límite y vuelve a la tarifa doméstica', () => {
    // Generación: 2 kWp × 5 × 365 × 0.8 = 2,920 kWh/año = 243.333 kWh/mes
    // Sin sistema (400 kWh, DAC): $2,436
    // Con sistema: 156.667 kWh → 75 + 130 + 16.667×3 = 255 × 1.16 = $295.80
    // Ahorro mensual: $2,140.20
    const r = estimarAhorro({ consumoMensualKwh: 400, kwp: 2, hsp: 5, parametros: SIN_DEGRADACION, tarifa: DOMESTICA, tarifaDac: DAC, precioVenta: 50000 })
    assert.equal(r.dac_sin_sistema, true)
    assert.equal(r.dac_con_sistema, false)
    cerca(r.gasto_mensual_sin_sistema, 2436)
    cerca(r.gasto_mensual_con_sistema, 295.8)
    cerca(r.ahorro_mensual, 2140.2)
  })

  test('generación mayor al consumo: el ahorro se limita al consumo y el recibo baja al cargo fijo', () => {
    // Generación: 3 × 5 × 365 × 0.8 / 12 = 365 kWh/mes, pero el consumo es de 100 kWh
    // Sin sistema: (50 + 100×4) × 1.16 = $522; con sistema solo el cargo fijo: 50 × 1.16 = $58
    // Ahorro mensual: $464 (= 100 kWh × $4 × 1.16), no 365 kWh
    const r = estimarAhorro({ consumoMensualKwh: 100, kwp: 3, hsp: 5, parametros: SIN_DEGRADACION, tarifa: COMERCIAL, precioVenta: 30000 })
    assert.equal(r.generacion_supera_consumo, true)
    assert.equal(r.consumo_neto_mensual_kwh, 0)
    cerca(r.gasto_mensual_con_sistema, 58)
    cerca(r.ahorro_mensual, 464)
  })

  test('sin paneles no hay estimación', () => {
    const r = estimarAhorro({ consumoMensualKwh: 200, kwp: kwpDePaneles([]), hsp: 5, tarifa: DOMESTICA, tarifaDac: DAC, precioVenta: 10000 })
    assert.equal(r.estado, 'sin_paneles')
    assert.equal(r.ahorro_anual, undefined)
  })

  test('sin ahorro posible no hay recuperación', () => {
    // Con una tarifa de precio cero el sistema no ahorra nada.
    const gratis = { ...COMERCIAL, cargo_fijo_mensual: 0, bloques: [{ ...COMERCIAL.bloques[0], precio_kwh: 0 }] }
    const r = estimarAhorro({ consumoMensualKwh: 200, kwp: 1, hsp: 5, tarifa: gratis, precioVenta: 10000 })
    assert.equal(r.ahorro_anual, 0)
    assert.equal(r.retorno_inversion_anios, null)
    assert.equal(r.serie.length, 10)
  })

  test('tarifa sin precios capturados: no se muestran cifras', () => {
    const sinPrecios = { ...DOMESTICA, bloques: DOMESTICA.bloques.map((bloque) => ({ ...bloque, precio_kwh: null })) }
    const r = estimarAhorro({ consumoMensualKwh: 200, kwp: 1, hsp: 5, tarifa: sinPrecios, tarifaDac: DAC, precioVenta: 10000 })
    assert.equal(r.estado, 'tarifa_sin_precios')
    assert.deepEqual(faltantesDeTarifa(sinPrecios), ['precios por kWh de PRUEBA-1'])
  })

  test('DAC necesaria pero sin precios también impide estimar', () => {
    const dacSinPrecio = { ...DAC, cargo_fijo_mensual: null }
    const r = estimarAhorro({ consumoMensualKwh: 400, kwp: 2, hsp: 5, tarifa: DOMESTICA, tarifaDac: dacSinPrecio, precioVenta: 10000 })
    assert.equal(r.estado, 'tarifa_sin_precios')
  })

  test('kWp a partir de los paneles cotizados', () => {
    // 10 × 550 W + 2 × 400 W = 6,300 W = 6.3 kWp
    cerca(kwpDePaneles([{ cantidad: 10, potencia_w: 550 }, { cantidad: 2, potencia_w: 400 }]), 6.3, 0.0001)
  })
})

describe('tarifas por temporada', () => {
  // Verano: 0–150 a $1 y más de 150 a $2. Fuera de verano: 0–75 a $1 y más de 75 a $3. Sin IVA para simplificar.
  const ESTACIONAL = {
    codigo: 'PRUEBA-1C', tipo: 'domestica', limite_dac_kwh: 850, cargo_fijo_mensual: 0,
    bloques: [
      { temporada: 'verano', orden: 1, desde_kwh: 0, hasta_kwh: 150, precio_kwh: 1 },
      { temporada: 'verano', orden: 2, desde_kwh: 150, hasta_kwh: null, precio_kwh: 2 },
      { temporada: 'fuera_verano', orden: 1, desde_kwh: 0, hasta_kwh: 75, precio_kwh: 1 },
      { temporada: 'fuera_verano', orden: 2, desde_kwh: 75, hasta_kwh: null, precio_kwh: 3 },
    ],
  }

  test('pondera los meses de verano y fuera de verano', () => {
    // 200 kWh/mes. Verano: 150 + 50×2 = $250. Fuera de verano: 75 + 125×3 = $450.
    // 6 meses de verano: 6×250 + 6×450 = $4,200 al año
    cerca(costoAnual(200, { tarifa: ESTACIONAL, iva: 0, mesesVerano: 6 }).anual, 4200)
    // 4 meses de verano: 4×250 + 8×450 = $4,600
    cerca(costoAnual(200, { tarifa: ESTACIONAL, iva: 0, mesesVerano: 4 }).anual, 4600)
  })

  test('una tarifa con un solo juego lo usa todo el año', () => {
    const soloVerano = { ...ESTACIONAL, bloques: ESTACIONAL.bloques.filter((bloque) => bloque.temporada === 'verano') }
    cerca(costoAnual(200, { tarifa: soloVerano, iva: 0, mesesVerano: 6 }).anual, 12 * 250)
  })

  test('la estimación usa ambas temporadas', () => {
    // Generación: 1 × 5 × 365 × 0.8 / 12 = 121.667 kWh/mes → consumo neto 78.333
    // Con sistema: verano 78.333 × 1 = 78.333; fuera 75 + 3.333×3 = 85 → anual 6×78.333 + 6×85 = 980
    // Sin sistema: 4,200 → ahorro anual 3,220 (sin IVA)
    const r = estimarAhorro({ consumoMensualKwh: 200, kwp: 1, hsp: 5, parametros: { ...SIN_DEGRADACION, iva: 0 }, tarifa: ESTACIONAL, precioVenta: 10000 })
    cerca(r.gasto_anual_sin_sistema, 4200)
    cerca(r.gasto_anual_con_sistema, 980)
    cerca(r.ahorro_anual, 3220)
  })
})

describe('validación de bloques', () => {
  const bloque = (temporada, orden, desde, hasta, precio = 1) => ({ temporada, orden, desde_kwh: desde, hasta_kwh: hasta, precio_kwh: precio })

  test('acepta bloques contiguos con el último abierto y precios vacíos', () => {
    assert.deepEqual(validarBloques([bloque('todo_el_anio', 1, 0, 75, null), bloque('todo_el_anio', 2, 75, null, null)]), [])
  })
  test('rechaza huecos entre bloques', () => {
    assert.ok(validarBloques([bloque('todo_el_anio', 1, 0, 75), bloque('todo_el_anio', 2, 80, null)]).some((e) => e.includes('debe empezar donde termina')))
  })
  test('rechaza un último bloque cerrado o un bloque intermedio abierto', () => {
    assert.ok(validarBloques([bloque('todo_el_anio', 1, 0, 75), bloque('todo_el_anio', 2, 75, 200)]).some((e) => e.includes('debe quedar abierto')))
    assert.ok(validarBloques([bloque('todo_el_anio', 1, 0, null), bloque('todo_el_anio', 2, 75, null)]).some((e) => e.includes('Solo el último')))
  })
  test('máximo 4 bloques por temporada', () => {
    const cinco = [0, 1, 2, 3, 4].map((i) => bloque('verano', i + 1, i * 100, i === 4 ? null : (i + 1) * 100))
    assert.ok(validarBloques(cinco).some((e) => e.includes('Máximo 4')))
  })
  test('no mezcla todo el año con temporadas', () => {
    assert.ok(validarBloques([bloque('todo_el_anio', 1, 0, null), bloque('verano', 1, 0, null)]).some((e) => e.includes('no ambos')))
  })
})

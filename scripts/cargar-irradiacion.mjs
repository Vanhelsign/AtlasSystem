// Consulta PVGIS (Comisión Europea, JRC) para la capital de cada estado y actualiza shared/irradiacion.js.
//
// Uso:
//   node scripts/cargar-irradiacion.mjs              consulta los 32 estados y escribe el archivo
//   node scripts/cargar-irradiacion.mjs --simular    consulta y muestra los resultados sin escribir
//   node scripts/cargar-irradiacion.mjs --solo MX-NLE,MX-CMX
//
// Fuente: API PVGIS 5.3 (PVcalc) con la base de radiación PVGIS-ERA5. En México la API solo acepta ERA5:
// PVGIS-SARAH3 no cubre el país y PVGIS-NSRDB ya no se ofrece en la versión 5.3.
// Horas solares pico = H(i)_d: irradiación diaria promedio (kWh/m²/día) sobre un plano fijo con la
// inclinación y orientación óptimas que calcula PVGIS, promediada en todo el periodo de la base de datos.
// Si una consulta falla o devuelve un valor fuera de rango, se conserva el valor anterior y se reporta.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

const API = 'https://re.jrc.ec.europa.eu/api/v5_3/PVcalc'
const BASE_RADIACION = 'PVGIS-ERA5'
const RANGO_VALIDO = [2, 9] // kWh/m²/día; fuera de este rango el valor se considera sospechoso
const PAUSA_MS = 500
const REINTENTOS = 2
const TIEMPO_LIMITE_MS = 60_000

// Coordenadas aproximadas del centro de cada capital estatal (grados decimales).
const CAPITALES = {
  'MX-AGU': ['Aguascalientes', 21.88, -102.29],
  'MX-BCN': ['Mexicali', 32.62, -115.45],
  'MX-BCS': ['La Paz', 24.14, -110.31],
  'MX-CAM': ['San Francisco de Campeche', 19.85, -90.53],
  'MX-CHP': ['Tuxtla Gutiérrez', 16.75, -93.12],
  'MX-CHH': ['Chihuahua', 28.63, -106.07],
  'MX-CMX': ['Ciudad de México', 19.43, -99.13],
  'MX-COA': ['Saltillo', 25.42, -101.00],
  'MX-COL': ['Colima', 19.24, -103.72],
  'MX-DUR': ['Victoria de Durango', 24.02, -104.66],
  'MX-GUA': ['Guanajuato', 21.02, -101.26],
  'MX-GRO': ['Chilpancingo', 17.55, -99.50],
  'MX-HID': ['Pachuca', 20.10, -98.76],
  'MX-JAL': ['Guadalajara', 20.67, -103.35],
  'MX-MEX': ['Toluca', 19.29, -99.66],
  'MX-MIC': ['Morelia', 19.70, -101.19],
  'MX-MOR': ['Cuernavaca', 18.92, -99.23],
  'MX-NAY': ['Tepic', 21.50, -104.89],
  'MX-NLE': ['Monterrey', 25.69, -100.32],
  'MX-OAX': ['Oaxaca de Juárez', 17.07, -96.73],
  'MX-PUE': ['Puebla', 19.04, -98.21],
  'MX-QUE': ['Santiago de Querétaro', 20.59, -100.39],
  'MX-ROO': ['Chetumal', 18.50, -88.30],
  'MX-SLP': ['San Luis Potosí', 22.15, -100.98],
  'MX-SIN': ['Culiacán', 24.81, -107.39],
  'MX-SON': ['Hermosillo', 29.07, -110.96],
  'MX-TAB': ['Villahermosa', 17.99, -92.93],
  'MX-TAM': ['Ciudad Victoria', 23.74, -99.15],
  'MX-TLA': ['Tlaxcala', 19.32, -98.24],
  'MX-VER': ['Xalapa', 19.54, -96.91],
  'MX-YUC': ['Mérida', 20.97, -89.62],
  'MX-ZAC': ['Zacatecas', 22.77, -102.58],
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const rutaDatos = join(raiz, 'shared', 'irradiacion.js')
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function leerArgumentos() {
  const argumentos = process.argv.slice(2)
  const simular = argumentos.includes('--simular')
  const indiceSolo = argumentos.indexOf('--solo')
  const solo = indiceSolo >= 0 ? argumentos[indiceSolo + 1]?.split(',').map((codigo) => codigo.trim().toUpperCase()) : null
  if (solo?.some((codigo) => !CAPITALES[codigo])) throw new Error(`Código de estado desconocido en --solo: ${solo.filter((codigo) => !CAPITALES[codigo]).join(', ')}`)
  return { simular, codigos: solo ?? Object.keys(CAPITALES) }
}

async function consultarPvgis(lat, lon) {
  const url = new URL(API)
  url.search = new URLSearchParams({
    lat: String(lat), lon: String(lon), peakpower: '1', loss: '14',
    optimalangles: '1', raddatabase: BASE_RADIACION, outputformat: 'json',
  }).toString()
  let ultimoError
  for (let intento = 0; intento <= REINTENTOS; intento += 1) {
    try {
      const respuesta = await fetch(url, { signal: AbortSignal.timeout(TIEMPO_LIMITE_MS) })
      const cuerpo = await respuesta.json().catch(() => null)
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}: ${cuerpo?.message ?? 'sin detalle'}`)
      const hsp = cuerpo?.outputs?.totals?.fixed?.['H(i)_d']
      if (typeof hsp !== 'number' || !Number.isFinite(hsp)) throw new Error('La respuesta no trae H(i)_d')
      if (hsp < RANGO_VALIDO[0] || hsp > RANGO_VALIDO[1]) throw new Error(`H(i)_d = ${hsp} fuera del rango esperado ${RANGO_VALIDO.join('–')}`)
      const meteo = cuerpo.inputs?.meteo_data ?? {}
      return {
        hsp: Math.round(hsp * 100) / 100,
        inclinacion: cuerpo.inputs?.mounting_system?.fixed?.slope?.value,
        base: meteo.radiation_db ?? BASE_RADIACION,
        periodo: meteo.year_min && meteo.year_max ? `${meteo.year_min}–${meteo.year_max}` : 'periodo no informado',
      }
    } catch (error) {
      ultimoError = error
      if (intento < REINTENTOS) await espera(2000 * (intento + 1))
    }
  }
  throw ultimoError
}

const literal = (texto) => `'${String(texto).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`

function generarBloque(datos, eol) {
  const lineas = Object.keys(CAPITALES).map((codigo) => {
    const dato = datos[codigo]
    return `  '${codigo}': { hsp: ${Number(dato.hsp).toFixed(2).replace(/0$/, '').replace(/\.$/, '.0')}, fuente: ${literal(dato.fuente)}, fecha: ${literal(dato.fecha)} },`
  })
  return ['// INICIO DATOS', 'export const IRRADIACION_ESTADOS = {', ...lineas, '}', '// FIN DATOS'].join(eol)
}

async function main() {
  const { simular, codigos } = leerArgumentos()
  const texto = readFileSync(rutaDatos, 'utf8')
  const eol = texto.includes('\r\n') ? '\r\n' : '\n'
  const inicio = texto.indexOf('// INICIO DATOS')
  const fin = texto.indexOf('// FIN DATOS')
  if (inicio < 0 || fin < inicio) throw new Error('No se encontraron los marcadores INICIO/FIN DATOS en shared/irradiacion.js')
  const { IRRADIACION_ESTADOS: anteriores } = await import(`${pathToFileURL(rutaDatos).href}?v=${Date.now()}`)
  const datos = structuredClone(anteriores)
  const fecha = new Date().toISOString().slice(0, 10)
  const fallas = []

  for (const codigo of codigos) {
    const [capital, lat, lon] = CAPITALES[codigo]
    try {
      const r = await consultarPvgis(lat, lon)
      datos[codigo] = {
        hsp: r.hsp,
        fuente: `PVGIS 5.3, ${r.base} (${r.periodo}), plano con inclinación óptima de ${r.inclinacion ?? '?'}°, capital: ${capital}`,
        fecha,
      }
      console.log(`${codigo}  ${capital.padEnd(26)} ${String(anteriores[codigo]?.hsp ?? '—').padStart(5)} → ${r.hsp}`)
    } catch (error) {
      fallas.push(`${codigo} (${capital}): ${error.message}`)
      console.log(`${codigo}  ${capital.padEnd(26)} FALLÓ, se conserva ${anteriores[codigo]?.hsp ?? '—'}`)
    }
    await espera(PAUSA_MS)
  }

  if (simular) console.log('\nModo --simular: no se escribió ningún archivo.')
  else {
    const nuevo = texto.slice(0, inicio) + generarBloque(datos, eol) + texto.slice(fin + '// FIN DATOS'.length)
    const temporal = `${rutaDatos}.tmp`
    writeFileSync(temporal, nuevo, 'utf8')
    renameSync(temporal, rutaDatos)
    console.log(`\nSe actualizó ${rutaDatos} (${codigos.length - fallas.length} de ${codigos.length} estados).`)
  }
  if (fallas.length) {
    console.log(`\nConsultas fallidas (se conservó el valor anterior):\n- ${fallas.join('\n- ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exitCode = 1
})

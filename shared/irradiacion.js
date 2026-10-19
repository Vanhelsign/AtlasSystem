// Horas solares pico (kWh/m²/día) por estado, indexadas por el código de shared/estadosMexico.js.
// scripts/cargar-irradiacion.mjs reemplaza solo el bloque entre los marcadores INICIO/FIN DATOS.
// Mientras "fuente" diga "valor por defecto", la cifra no proviene de una medición.

export const HSP_POR_DEFECTO = 5.0

// INICIO DATOS
export const IRRADIACION_ESTADOS = {
  'MX-AGU': { hsp: 6.7, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 24°, capital: Aguascalientes', fecha: '2026-10-19' },
  'MX-BCN': { hsp: 6.86, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 33°, capital: Mexicali', fecha: '2026-10-19' },
  'MX-BCS': { hsp: 6.73, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 25°, capital: La Paz', fecha: '2026-10-19' },
  'MX-CAM': { hsp: 5.95, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 20°, capital: San Francisco de Campeche', fecha: '2026-10-19' },
  'MX-CHP': { hsp: 5.65, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 20°, capital: Tuxtla Gutiérrez', fecha: '2026-10-19' },
  'MX-CHH': { hsp: 6.75, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 30°, capital: Chihuahua', fecha: '2026-10-19' },
  'MX-CMX': { hsp: 6.18, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 24°, capital: Ciudad de México', fecha: '2026-10-19' },
  'MX-COA': { hsp: 6.34, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 27°, capital: Saltillo', fecha: '2026-10-19' },
  'MX-COL': { hsp: 5.99, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: Colima', fecha: '2026-10-19' },
  'MX-DUR': { hsp: 6.75, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 26°, capital: Victoria de Durango', fecha: '2026-10-19' },
  'MX-GUA': { hsp: 6.5, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: Guanajuato', fecha: '2026-10-19' },
  'MX-GRO': { hsp: 6.04, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 21°, capital: Chilpancingo', fecha: '2026-10-19' },
  'MX-HID': { hsp: 6.21, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: Pachuca', fecha: '2026-10-19' },
  'MX-JAL': { hsp: 6.34, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: Guadalajara', fecha: '2026-10-19' },
  'MX-MEX': { hsp: 6.14, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 24°, capital: Toluca', fecha: '2026-10-19' },
  'MX-MIC': { hsp: 6.17, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 24°, capital: Morelia', fecha: '2026-10-19' },
  'MX-MOR': { hsp: 6.43, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 22°, capital: Cuernavaca', fecha: '2026-10-19' },
  'MX-NAY': { hsp: 6.04, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 24°, capital: Tepic', fecha: '2026-10-19' },
  'MX-NLE': { hsp: 5.94, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 26°, capital: Monterrey', fecha: '2026-10-19' },
  'MX-OAX': { hsp: 5.93, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 20°, capital: Oaxaca de Juárez', fecha: '2026-10-19' },
  'MX-PUE': { hsp: 6.42, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: Puebla', fecha: '2026-10-19' },
  'MX-QUE': { hsp: 6.32, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: Santiago de Querétaro', fecha: '2026-10-19' },
  'MX-ROO': { hsp: 5.38, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 18°, capital: Chetumal', fecha: '2026-10-19' },
  'MX-SLP': { hsp: 6.18, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: San Luis Potosí', fecha: '2026-10-19' },
  'MX-SIN': { hsp: 6.18, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 27°, capital: Culiacán', fecha: '2026-10-19' },
  'MX-SON': { hsp: 6.7, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 29°, capital: Hermosillo', fecha: '2026-10-19' },
  'MX-TAB': { hsp: 5.44, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 17°, capital: Villahermosa', fecha: '2026-10-19' },
  'MX-TAM': { hsp: 5.82, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 24°, capital: Ciudad Victoria', fecha: '2026-10-19' },
  'MX-TLA': { hsp: 6.27, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 23°, capital: Tlaxcala', fecha: '2026-10-19' },
  'MX-VER': { hsp: 5.43, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 21°, capital: Xalapa', fecha: '2026-10-19' },
  'MX-YUC': { hsp: 5.62, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 21°, capital: Mérida', fecha: '2026-10-19' },
  'MX-ZAC': { hsp: 6.68, fuente: 'PVGIS 5.3, PVGIS-ERA5 (2005–2023), plano con inclinación óptima de 24°, capital: Zacatecas', fecha: '2026-10-19' },
}
// FIN DATOS

// Devuelve las horas solares pico del estado; si el código no existe, usa el valor por defecto y lo indica.
export function horasSolaresPico(codigoEstado) {
  const dato = IRRADIACION_ESTADOS[codigoEstado]
  if (dato) return { ...dato, estado_codigo: codigoEstado, conocido: true }
  return { hsp: HSP_POR_DEFECTO, fuente: 'valor por defecto (estado no identificado)', fecha: '', estado_codigo: codigoEstado ?? null, conocido: false }
}

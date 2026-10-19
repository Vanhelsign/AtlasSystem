export const ESTADOS_MEXICO = [
  { codigo: 'MX-AGU', nombre: 'Aguascalientes' },
  { codigo: 'MX-BCN', nombre: 'Baja California' },
  { codigo: 'MX-BCS', nombre: 'Baja California Sur' },
  { codigo: 'MX-CAM', nombre: 'Campeche' },
  { codigo: 'MX-CHP', nombre: 'Chiapas' },
  { codigo: 'MX-CHH', nombre: 'Chihuahua' },
  { codigo: 'MX-CMX', nombre: 'Ciudad de México' },
  { codigo: 'MX-COA', nombre: 'Coahuila' },
  { codigo: 'MX-COL', nombre: 'Colima' },
  { codigo: 'MX-DUR', nombre: 'Durango' },
  { codigo: 'MX-GUA', nombre: 'Guanajuato' },
  { codigo: 'MX-GRO', nombre: 'Guerrero' },
  { codigo: 'MX-HID', nombre: 'Hidalgo' },
  { codigo: 'MX-JAL', nombre: 'Jalisco' },
  { codigo: 'MX-MEX', nombre: 'Estado de México' },
  { codigo: 'MX-MIC', nombre: 'Michoacán' },
  { codigo: 'MX-MOR', nombre: 'Morelos' },
  { codigo: 'MX-NAY', nombre: 'Nayarit' },
  { codigo: 'MX-NLE', nombre: 'Nuevo León' },
  { codigo: 'MX-OAX', nombre: 'Oaxaca' },
  { codigo: 'MX-PUE', nombre: 'Puebla' },
  { codigo: 'MX-QUE', nombre: 'Querétaro' },
  { codigo: 'MX-ROO', nombre: 'Quintana Roo' },
  { codigo: 'MX-SLP', nombre: 'San Luis Potosí' },
  { codigo: 'MX-SIN', nombre: 'Sinaloa' },
  { codigo: 'MX-SON', nombre: 'Sonora' },
  { codigo: 'MX-TAB', nombre: 'Tabasco' },
  { codigo: 'MX-TAM', nombre: 'Tamaulipas' },
  { codigo: 'MX-TLA', nombre: 'Tlaxcala' },
  { codigo: 'MX-VER', nombre: 'Veracruz' },
  { codigo: 'MX-YUC', nombre: 'Yucatán' },
  { codigo: 'MX-ZAC', nombre: 'Zacatecas' },
]

const claveTexto = (valor) => String(valor ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase()

const estadosPorValor = new Map()
for (const estado of ESTADOS_MEXICO) {
  estadosPorValor.set(claveTexto(estado.codigo), estado.codigo)
  estadosPorValor.set(claveTexto(estado.nombre), estado.codigo)
}
estadosPorValor.set('cdmx', 'MX-CMX')
estadosPorValor.set('distrito federal', 'MX-CMX')
estadosPorValor.set('df', 'MX-CMX')
estadosPorValor.set('coahuila de zaragoza', 'MX-COA')
estadosPorValor.set('michoacan de ocampo', 'MX-MIC')
estadosPorValor.set('veracruz de ignacio de la llave', 'MX-VER')
estadosPorValor.set('edomex', 'MX-MEX')
estadosPorValor.set('queretaro de arteaga', 'MX-QUE')

// Abreviaturas sin ambigüedad. Se comparan sin puntos ni espacios, por lo que "N.L.", "N. L.", "n l" y "NL"
// coinciden. "México" a secas no se incluye: puede ser el país o el Estado de México.
const abreviaturas = new Map([
  ['nl', 'MX-NLE'],
  ['cdmx', 'MX-CMX'],
  ['df', 'MX-CMX'],
  ['edomex', 'MX-MEX'],
])
const sinPuntuacion = (clave) => clave.replace(/[.\s]/g, '')

export function normalizarEstadoMexico(valor) {
  const clave = claveTexto(valor)
  return estadosPorValor.get(clave) ?? abreviaturas.get(sinPuntuacion(clave)) ?? null
}

export function nombreEstadoMexico(codigo) {
  return ESTADOS_MEXICO.find((estado) => estado.codigo === codigo)?.nombre ?? null
}

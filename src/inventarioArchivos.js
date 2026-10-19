// Lectura y escritura de archivos del inventario (CSV y Excel .xlsx).
// Ambos formatos se convierten a las mismas filas de texto para que la revisión y la importación sean idénticas.

export const COLUMNAS_INVENTARIO = ['codigo', 'clase', 'tipo', 'modelo', 'costo', 'existencias', 'estado', 'marca', 'capacidad_kwh', 'potencia_w', 'potencia_kw']
export const COLUMNAS_OBLIGATORIAS = ['codigo', 'clase', 'tipo', 'modelo', 'costo', 'existencias', 'estado']
export const ENCABEZADOS_INVENTARIO = {
  codigo: 'código', clase: 'clase', tipo: 'tipo', modelo: 'modelo', costo: 'costo', existencias: 'existencias',
  estado: 'estado', marca: 'marca', capacidad_kwh: 'capacidad_kwh', potencia_w: 'potencia_w', potencia_kw: 'potencia_kw',
}
export const LIMITE_FILAS_IMPORTACION = 2000
const LIMITE_TAMANO_ARCHIVO = 5 * 1024 * 1024

const ALIAS_COLUMNAS = {
  codigo: 'codigo', clase: 'clase', clasificacion: 'clase', tipo: 'tipo', modelo: 'modelo',
  costo: 'costo', costo_base: 'costo', costo_unitario: 'costo', existencias: 'existencias', stock: 'existencias',
  estado: 'estado', marca: 'marca', capacidad_kwh: 'capacidad_kwh', potencia_w: 'potencia_w', potencia_kw: 'potencia_kw',
}

const claveEncabezado = (valor) => String(valor ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim()
  .toLowerCase()
  .replace(/[()]/g, '')
  .replace(/[\s-]+/g, '_')

// Excel entrega números, fechas, booleanos o texto; el servidor siempre recibe texto o null.
function normalizarCelda(valor) {
  if (valor === null || valor === undefined) return null
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10)
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : null
  if (typeof valor === 'boolean') return valor ? 'VERDADERO' : 'FALSO'
  const texto = String(valor).trim()
  return texto || null
}

function decodificarTexto(buffer) {
  const bytes = new Uint8Array(buffer)
  const conBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(conBom ? bytes.subarray(3) : bytes), codificacion: 'UTF-8' }
  } catch {
    // Excel guarda "CSV (delimitado por comas)" en ANSI cuando no se elige UTF-8.
    return { texto: new TextDecoder('windows-1252').decode(bytes), codificacion: 'Windows-1252' }
  }
}

function detectarSeparador(texto) {
  const conteo = { ',': 0, ';': 0, '\t': 0 }
  let entreComillas = false
  for (const caracter of texto) {
    if (caracter === '"') entreComillas = !entreComillas
    else if (!entreComillas && (caracter === '\n' || caracter === '\r')) break
    else if (!entreComillas && caracter in conteo) conteo[caracter] += 1
  }
  const [separador, apariciones] = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0]
  return apariciones > 0 ? separador : ','
}

// Lector CSV (RFC 4180): comillas dobles, comillas escapadas y saltos de línea dentro de un campo.
function parsearCsv(texto) {
  const separador = detectarSeparador(texto)
  const filas = []
  let fila = []
  let campo = ''
  let entreComillas = false
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caracter = texto[indice]
    if (entreComillas) {
      if (caracter === '"' && texto[indice + 1] === '"') { campo += '"'; indice += 1 }
      else if (caracter === '"') entreComillas = false
      else campo += caracter
    } else if (caracter === '"' && campo === '') entreComillas = true
    else if (caracter === separador) { fila.push(campo); campo = '' }
    else if (caracter === '\n' || caracter === '\r') {
      if (caracter === '\r' && texto[indice + 1] === '\n') indice += 1
      fila.push(campo); filas.push(fila); fila = []; campo = ''
    } else campo += caracter
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return filas
}

function construirFilas(tabla) {
  const inicio = tabla.findIndex((fila) => fila.some((celda) => normalizarCelda(celda) !== null))
  if (inicio === -1) throw new Error('El archivo está vacío.')
  const columnas = []
  const ignoradas = []
  const posiciones = new Map()
  tabla[inicio].forEach((encabezado, posicion) => {
    const texto = normalizarCelda(encabezado)
    if (texto === null) return
    const columna = ALIAS_COLUMNAS[claveEncabezado(texto)]
    if (!columna) return ignoradas.push(texto)
    if (posiciones.has(columna)) throw new Error(`La columna "${texto}" está repetida en el encabezado.`)
    posiciones.set(columna, posicion)
    columnas.push(columna)
  })

  const filas = []
  for (let indice = inicio + 1; indice < tabla.length; indice += 1) {
    const fila = { fila: indice + 1 }
    let vacia = true
    for (const [columna, posicion] of posiciones) {
      fila[columna] = normalizarCelda(tabla[indice][posicion])
      if (fila[columna] !== null) vacia = false
    }
    if (!vacia) filas.push(fila)
  }
  return {
    filas,
    columnas,
    ignoradas,
    faltantes: COLUMNAS_OBLIGATORIAS.filter((columna) => !posiciones.has(columna)),
  }
}

export async function leerArchivoInventario(archivo) {
  const extension = archivo.name.includes('.') ? archivo.name.split('.').pop().toLowerCase() : ''
  if (extension === 'xls') throw new Error('Los archivos .xls no son compatibles. Ábrelo en Excel y guárdalo como .xlsx o como CSV.')
  if (!['csv', 'xlsx'].includes(extension)) throw new Error('Selecciona un archivo .csv o .xlsx.')
  if (archivo.size === 0) throw new Error('El archivo está vacío.')
  if (archivo.size > LIMITE_TAMANO_ARCHIVO) throw new Error('El archivo supera el tamaño máximo de 5 MB.')

  if (extension === 'csv') {
    const { texto, codificacion } = decodificarTexto(await archivo.arrayBuffer())
    return { ...construirFilas(parsearCsv(texto)), formato: `CSV ${codificacion}`, hoja: null }
  }

  const { default: readXlsxFile } = await import('read-excel-file/browser')
  let hojas
  try {
    hojas = await readXlsxFile(archivo)
  } catch {
    throw new Error('No se pudo leer el archivo de Excel. Verifica que sea un .xlsx válido y que no esté protegido con contraseña.')
  }
  if (!hojas.length) throw new Error('El archivo de Excel no contiene hojas.')
  return { ...construirFilas(hojas[0].data), formato: 'Excel .xlsx', hoja: { nombre: hojas[0].sheet, total: hojas.length } }
}

function filasExportacion(inventario) {
  return inventario.map((producto) => ({
    codigo: producto.codigo,
    clase: producto.clasificacion,
    tipo: producto.tipo,
    modelo: producto.modelo,
    costo: producto.costo_unitario,
    existencias: producto.clasificacion === 'servicio' ? 'No aplica' : producto.existencias,
    estado: producto.activo ? 'Activo' : 'Inactivo',
    marca: producto.marca ?? null,
    capacidad_kwh: producto.capacidad_kwh ?? null,
    potencia_w: producto.potencia_w ?? null,
    potencia_kw: producto.potencia_kw ?? null,
  }))
}

// Evita que una hoja de cálculo interprete como fórmula un texto que empieza con = + - @.
const protegerTexto = (valor) => typeof valor === 'string' && /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor

export function generarCsvInventario(inventario) {
  const escapar = (valor) => {
    if (valor === null || valor === undefined) return ''
    const texto = String(protegerTexto(valor))
    return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto
  }
  const lineas = [
    COLUMNAS_INVENTARIO.map((columna) => ENCABEZADOS_INVENTARIO[columna]).join(','),
    ...filasExportacion(inventario).map((fila) => COLUMNAS_INVENTARIO.map((columna) => escapar(fila[columna])).join(',')),
  ]
  // El BOM permite que Excel reconozca los acentos al abrir el archivo.
  return new Blob([`\uFEFF${lineas.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' })
}

export async function generarExcelInventario(inventario) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const numericas = new Set(['costo', 'capacidad_kwh', 'potencia_w', 'potencia_kw'])
  const encabezado = COLUMNAS_INVENTARIO.map((columna) => ({ value: ENCABEZADOS_INVENTARIO[columna], fontWeight: 'bold', backgroundColor: '#EEF2FF' }))
  const filas = filasExportacion(inventario).map((fila) => COLUMNAS_INVENTARIO.map((columna) => {
    const valor = fila[columna]
    if (valor === null || valor === undefined) return null
    if (numericas.has(columna) || (columna === 'existencias' && typeof valor === 'number')) return { value: Number(valor), type: Number }
    // El código siempre se guarda como texto para conservar ceros a la izquierda (por ejemplo "001").
    return { value: String(protegerTexto(valor)), type: String }
  }))
  return writeXlsxFile([encabezado, ...filas], {
    sheet: 'Inventario',
    stickyRowsCount: 1,
    columns: [{ width: 22 }, { width: 11 }, { width: 14 }, { width: 34 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 18 }, { width: 14 }, { width: 12 }, { width: 12 }],
  }).toBlob()
}

// Usa el diálogo de guardado del navegador cuando existe; si no (Firefox, Safari o una vista embebida), descarga el archivo.
// Devuelve false si la persona cancela el diálogo.
export async function guardarArchivo({ nombre, descripcion, mime, construir }) {
  if (typeof window.showSaveFilePicker === 'function') {
    let destino = null
    try {
      destino = await window.showSaveFilePicker({ suggestedName: nombre, types: [{ description: descripcion, accept: { [mime]: [`.${nombre.split('.').pop()}`] } }] })
    } catch (error) {
      if (error.name === 'AbortError') return false
    }
    if (destino) {
      const contenido = await construir()
      const escritor = await destino.createWritable()
      await escritor.write(contenido)
      await escritor.close()
      return true
    }
  }
  const url = URL.createObjectURL(await construir())
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.append(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

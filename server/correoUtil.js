// Funciones puras del correo (sin base de datos ni red), separadas para poder probarlas solas.
import { randomInt } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const raizProyecto = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REMITENTE_POR_DEFECTO = 'ATLAS CRM <no-responder@atlas.example>'
const TIEMPO_MAX_POR_DEFECTO_MS = 15_000

// Sin SMTP_HOST el correo trabaja en modo simulado.
export function configuracionCorreo(entorno = process.env) {
  const texto = (nombre) => String(entorno[nombre] ?? '').trim()
  const seguro = /^(1|true|si|sí)$/i.test(texto('SMTP_SECURE'))
  const tiempo = Number.parseInt(texto('CORREO_TIEMPO_MAX_MS'), 10)
  return {
    simulado: texto('SMTP_HOST') === '',
    host: texto('SMTP_HOST'),
    puerto: Number.parseInt(texto('SMTP_PORT'), 10) || (seguro ? 465 : 587),
    seguro,
    usuario: texto('SMTP_USER'),
    contrasena: String(entorno.SMTP_PASS ?? ''),
    remitente: texto('CORREO_REMITENTE') || REMITENTE_POR_DEFECTO,
    urlApp: (texto('APP_URL') || 'http://localhost:5173').replace(/\/+$/, ''),
    tiempoMaxMs: Number.isInteger(tiempo) && tiempo > 0 ? tiempo : TIEMPO_MAX_POR_DEFECTO_MS,
    carpetaCorreos: texto('ATLAS_CORREOS_DIR') ? resolve(texto('ATLAS_CORREOS_DIR')) : join(raizProyecto, 'data', 'correos'),
  }
}

// Sin caracteres que se confunden al leerlos (0/O, 1/l/I). 12 caracteres de 56 posibles ≈ 69 bits.
export const ALFABETO_TEMPORAL = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
export function generarContrasenaTemporal(longitud = 12) {
  let resultado = ''
  for (let i = 0; i < longitud; i += 1) resultado += ALFABETO_TEMPORAL[randomInt(ALFABETO_TEMPORAL.length)]
  return resultado
}

// Mensaje de error apto para guardar y mostrar: sin credenciales y de longitud acotada.
export function limpiarDetalleError(error, configuracion) {
  let detalle = `${error?.code ? `${error.code}: ` : ''}${error?.message ?? String(error)}`
  for (const secreto of [configuracion?.contrasena, configuracion?.usuario]) {
    if (secreto && secreto.length >= 3) detalle = detalle.split(secreto).join('***')
  }
  return detalle.replace(/\s+/g, ' ').trim().slice(0, 300)
}

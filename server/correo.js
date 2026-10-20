// Envío de correos de ATLAS y su registro en registro_notificaciones.
//
// Modo simulado (sin SMTP_HOST): cada correo se guarda como .eml en data/correos/ (o en ATLAS_CORREOS_DIR)
// y queda "pendiente" con el detalle "Modo simulado"; nunca se marca como aceptado ni entregado.
// SMTP real: "aceptado" cuando el servidor SMTP acepta el mensaje y "fallido" con detalle si falla o se agota
// el tiempo. "entregado" no se usa: requeriría una confirmación del proveedor que hoy no existe.
//
// Reglas de seguridad: no se imprimen ni se guardan credenciales SMTP ni el enlace de acceso. El enlace (con su
// token) solo viaja dentro del mensaje; en modo simulado, el .eml local es la única otra copia.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import nodemailer from 'nodemailer'
import { db } from './database.js'
import { configuracionCorreo, limpiarDetalleError } from './correoUtil.js'
import { PLANTILLAS } from './plantillasCorreo.js'
import { enlaceCrearContrasena } from './tokensCuenta.js'

const config = configuracionCorreo()
let transporte = null

function obtenerTransporte() {
  if (transporte) return transporte
  transporte = config.simulado
    ? nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' })
    : nodemailer.createTransport({
      host: config.host,
      port: config.puerto,
      secure: config.seguro,
      auth: config.usuario ? { user: config.usuario, pass: config.contrasena } : undefined,
      connectionTimeout: config.tiempoMaxMs,
      greetingTimeout: config.tiempoMaxMs,
      socketTimeout: config.tiempoMaxMs,
    })
  return transporte
}

export function describirModoCorreo() {
  return config.simulado
    ? 'Correo en modo simulado: los mensajes se guardan como .eml y no se envían.'
    : 'Correo: SMTP configurado.'
}

const marcaArchivo = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const TIEMPO_AGOTADO = 'Tiempo de espera agotado al enviar el correo'

function actualizar(id, estado, detalle, { archivo = null, aceptado = false } = {}) {
  db.prepare(`
    UPDATE registro_notificaciones
    SET estado_envio = ?, detalle_error = ?, archivo = COALESCE(?, archivo),
        enviado_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE enviado_at END
    WHERE id = ?
  `).run(estado, detalle, archivo, aceptado ? 1 : 0, id)
}

// Intenta enviar un mensaje ya registrado. Nunca lanza: devuelve el resultado para la respuesta de la API.
export async function intentarEnvio(id, tipo, mensaje) {
  try {
    db.prepare('UPDATE registro_notificaciones SET intentos = intentos + 1, ultimo_intento_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
    if (config.simulado) {
      const info = await obtenerTransporte().sendMail(mensaje)
      const archivo = `${marcaArchivo()}-${tipo}-${id}.eml`
      mkdirSync(config.carpetaCorreos, { recursive: true })
      writeFileSync(join(config.carpetaCorreos, archivo), info.message)
      const detalle = `Modo simulado: no se envió. Archivo: ${archivo}`
      actualizar(id, 'pendiente', detalle, { archivo })
      return { id, estado: 'pendiente', simulado: true, archivo, detalle }
    }

    const envio = obtenerTransporte().sendMail(mensaje)
    let temporizador
    const limite = new Promise((_, rechazar) => {
      temporizador = setTimeout(() => rechazar(Object.assign(new Error(TIEMPO_AGOTADO), { tiempoAgotado: true })), config.tiempoMaxMs)
    })
    // Si el servidor acepta el mensaje después del tiempo máximo, el registro se corrige a "aceptado".
    envio.then((info) => {
      if (info.accepted?.length && !info.rejected?.length) {
        db.prepare(`
          UPDATE registro_notificaciones SET estado_envio = 'aceptado', detalle_error = NULL, enviado_at = CURRENT_TIMESTAMP
          WHERE id = ? AND estado_envio = 'fallido' AND detalle_error = ?
        `).run(id, TIEMPO_AGOTADO)
      }
    }, () => {})
    try {
      const info = await Promise.race([envio, limite])
      if (info.rejected?.length || !info.accepted?.length) {
        const detalle = 'El servidor de correo rechazó el destinatario'
        actualizar(id, 'fallido', detalle)
        return { id, estado: 'fallido', simulado: false, detalle }
      }
      actualizar(id, 'aceptado', null, { aceptado: true })
      return { id, estado: 'aceptado', simulado: false }
    } finally {
      clearTimeout(temporizador)
    }
  } catch (error) {
    const detalle = error?.tiempoAgotado ? TIEMPO_AGOTADO : limpiarDetalleError(error, config)
    try { actualizar(id, 'fallido', detalle) } catch (errorBase) { console.error(errorBase.stack ?? String(errorBase)) }
    return { id, estado: 'fallido', simulado: config.simulado, detalle }
  }
}

// Registra y envía un correo de una plantilla. `datos` llega a la plantilla y nunca se guarda en la base.
export async function enviarCorreo({ tipo, destinatario, nombre, datos = {}, prospectoId = null, solicitudId = null }) {
  let id
  try {
    id = Number(db.prepare(`
      INSERT INTO registro_notificaciones (prospecto_id, solicitud_id, destinatario_email, tipo_correo, estado_envio)
      VALUES (?, ?, ?, ?, 'pendiente')
    `).run(prospectoId, solicitudId, destinatario, tipo).lastInsertRowid)
  } catch (error) {
    console.error(error.stack ?? String(error))
    return { id: null, estado: 'fallido', simulado: config.simulado, detalle: 'No se pudo registrar la notificación' }
  }
  const { asunto, texto, html } = PLANTILLAS[tipo]({ nombre, email: destinatario, urlApp: config.urlApp, ...datos })
  return intentarEnvio(id, tipo, { from: config.remitente, to: destinatario, subject: asunto, text: texto, html })
}

// El enlace lleva el token en el fragmento (#), que el navegador no envía al servidor ni en Referer.
export function enviarCredenciales({ destinatario, nombre, token, horasVigencia, prospectoId, solicitudId }) {
  const enlace = enlaceCrearContrasena(config.urlApp, token)
  return enviarCorreo({ tipo: 'credenciales', destinatario, nombre, datos: { enlace, horasVigencia }, prospectoId, solicitudId })
}

export function enviarCotizacionLista({ destinatario, nombre, prospectoId, solicitudId }) {
  return enviarCorreo({ tipo: 'cotizacion_lista', destinatario, nombre, prospectoId, solicitudId })
}

// Borra los .eml indicados, solo si su ruta resuelta queda dentro de la carpeta de correos (data/correos/).
// Cualquier nombre que se salga de la carpeta (por ejemplo con "..") se rechaza. Nunca lanza: informa cada caso.
export function borrarArchivosCorreo(archivos) {
  const carpeta = resolve(config.carpetaCorreos)
  const resultado = { borrados: 0, no_encontrados: 0, rechazados: 0, fallidos: [] }
  for (const archivo of archivos) {
    const ruta = resolve(carpeta, String(archivo))
    const relativa = relative(carpeta, ruta)
    if (!relativa || relativa.startsWith('..') || isAbsolute(relativa) || dirname(ruta) !== carpeta || !ruta.endsWith('.eml')) {
      resultado.rechazados += 1
      continue
    }
    try {
      rmSync(ruta)
      resultado.borrados += 1
    } catch (error) {
      if (error.code === 'ENOENT') resultado.no_encontrados += 1
      else resultado.fallidos.push(`${basename(ruta)}: ${error.code ?? 'error'}`)
    }
  }
  return resultado
}

// Sin disparador todavía: se llamará desde el módulo de mantenimientos programados cuando exista.
export function enviarRecordatorio({ destinatario, nombre, fecha, descripcion, prospectoId = null }) {
  return enviarCorreo({ tipo: 'recordatorio', destinatario, nombre, datos: { fecha, descripcion }, prospectoId })
}

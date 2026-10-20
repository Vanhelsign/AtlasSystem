// Enlaces de un solo uso para que el cliente cree su contraseña.
// El token (32 bytes aleatorios en base64url) solo viaja en el correo; la base guarda su hash SHA-256.
// Nunca se escribe el token en consola, en registro_notificaciones ni en mensajes de error.
import { createHash, randomBytes } from 'node:crypto'
import process from 'node:process'
import { db } from './database.js'

const horas = Number(process.env.ATLAS_ENLACE_VIGENCIA_HORAS)
export const HORAS_VIGENCIA_ENLACE = Number.isInteger(horas) && horas > 0 ? horas : 48

export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex')

// Un token con otro formato nunca coincide: se descarta antes de tocar la base.
export const formatoTokenValido = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)

// Emite un token nuevo para la cuenta y borra los anteriores del mismo tipo. Debe llamarse dentro de la
// transacción que crea o modifica la cuenta. Devuelve el token en claro, solo para armar el correo.
export function emitirTokenCuenta(cuentaId, tipo = 'crear_contrasena') {
  const token = randomBytes(32).toString('base64url')
  db.prepare('DELETE FROM tokens_cuenta WHERE cuenta_id = ? AND tipo = ?').run(cuentaId, tipo)
  db.prepare(`
    INSERT INTO tokens_cuenta (cuenta_id, tipo, token_hash, expira_at)
    VALUES (?, ?, ?, datetime('now', ?))
  `).run(cuentaId, tipo, hashToken(token), `+${HORAS_VIGENCIA_ENLACE} hours`)
  return token
}

// Token existente, sin usar, sin vencer y de un cliente que no está en la papelera. No lo consume.
export function buscarTokenVigente(token, tipo = 'crear_contrasena') {
  if (!formatoTokenValido(token)) return null
  return db.prepare(`
    SELECT t.id, t.cuenta_id FROM tokens_cuenta t
    JOIN cuentas_cliente c ON c.id = t.cuenta_id
    JOIN prospectos p ON p.id = c.prospecto_id
    WHERE t.token_hash = ? AND t.tipo = ? AND t.usado_at IS NULL AND t.expira_at > datetime('now')
      AND p.eliminado_at IS NULL
  `).get(hashToken(token), tipo) ?? null
}

// Marca el token como usado solo si sigue vigente. Llamar dentro de una transacción: devuelve true si
// esta petición fue la que lo consumió (un segundo intento, simultáneo o no, recibe false).
export function consumirToken(id) {
  return db.prepare(`
    UPDATE tokens_cuenta SET usado_at = CURRENT_TIMESTAMP
    WHERE id = ? AND usado_at IS NULL AND expira_at > datetime('now')
  `).run(id).changes === 1
}

export const enlaceCrearContrasena = (urlApp, token) => `${urlApp}/#crear-contrasena=${token}`

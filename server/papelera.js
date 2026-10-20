// Papelera de clientes y estimaciones (solo Administrador).
//
// Borrado lógico: marca eliminado_at, eliminado_por, motivo_eliminacion y eliminacion_lote en prospectos y
// solicitudes_cotizacion. Eliminar un cliente marca también sus solicitudes activas con el mismo lote; restaurarlo
// solo restaura las de ese lote. No toca cotizaciones emitidas, sus copias ni registro_notificaciones.
//
// Eliminación definitiva: único borrado físico de clientes y estimaciones. Solo para registros que ya están en la
// papelera. Crea un respaldo, borra en un orden explícito (hay llaves RESTRICT que la cascada no resuelve),
// verifica PRAGMA foreign_key_check y, si algo falla, deshace todo.
import { randomUUID } from 'node:crypto'
import { db, respaldarBase } from './database.js'

const MAX_MOTIVO = 500

export class ErrorPapelera extends Error {
  constructor(status, mensaje) {
    super(mensaje)
    this.status = status
  }
}

export function validarMotivo(valor) {
  if (valor === undefined || valor === null) return null
  if (typeof valor !== 'string') throw new ErrorPapelera(400, 'El motivo debe ser texto')
  const motivo = valor.trim()
  if (motivo.length > MAX_MOTIVO) throw new ErrorPapelera(400, `El motivo no debe superar ${MAX_MOTIVO} caracteres`)
  return motivo || null
}

const enTransaccion = (fn) => {
  db.exec('BEGIN IMMEDIATE')
  try {
    const resultado = fn()
    db.exec('COMMIT')
    return resultado
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const prospecto = (id) => db.prepare('SELECT id, nombre, email, eliminado_at, eliminacion_lote FROM prospectos WHERE id = ?').get(id)
const solicitud = (id) => db.prepare(`
  SELECT s.id, s.prospecto_id, s.eliminado_at, p.eliminado_at AS cliente_eliminado_at
  FROM solicitudes_cotizacion s JOIN prospectos p ON p.id = s.prospecto_id WHERE s.id = ?
`).get(id)

const cotizacionesDe = (ids) => ids.length
  ? Number(db.prepare('SELECT COUNT(*) AS total FROM cotizaciones_versiones WHERE solicitud_id IN (SELECT value FROM json_each(?))').get(JSON.stringify(ids)).total)
  : 0

// ─── Listado y detalle ───────────────────────────────────────────

export function listarClientes({ eliminados = false, busqueda = '' } = {}) {
  const patron = `%${busqueda.trim().toLowerCase().replace(/[\\%_]/g, (caracter) => `\\${caracter}`)}%`
  // En "Activos" se cuentan solo las solicitudes activas; en "Eliminados", todas las del cliente.
  const filtroSolicitud = eliminados ? '' : 'AND s.eliminado_at IS NULL'
  return db.prepare(`
    SELECT p.id, p.nombre, p.email, p.created_at, p.eliminado_at, p.motivo_eliminacion,
           admin.nombre AS eliminado_por_nombre,
           d.estado AS direccion_estado, d.estado_codigo AS direccion_estado_codigo,
           (SELECT COUNT(*) FROM solicitudes_cotizacion s WHERE s.prospecto_id = p.id ${filtroSolicitud}) AS total_solicitudes,
           ultima.estado_flujo AS ultimo_estado_flujo,
           ultima.revision_estado AS ultima_revision_estado,
           ultima.id AS ultima_solicitud_id
    FROM prospectos p
    LEFT JOIN direcciones_cliente d ON d.prospecto_id = p.id
    LEFT JOIN usuarios_personal admin ON admin.id = p.eliminado_por
    LEFT JOIN (
      SELECT s.id, s.prospecto_id, s.estado_flujo, rt.estado AS revision_estado
      FROM solicitudes_cotizacion s LEFT JOIN revisiones_tecnicas rt ON rt.solicitud_id = s.id
      WHERE 1 = 1 ${filtroSolicitud}
    ) ultima ON ultima.id = (
      SELECT MAX(s.id) FROM solicitudes_cotizacion s WHERE s.prospecto_id = p.id ${filtroSolicitud}
    )
    WHERE ${eliminados ? 'p.eliminado_at IS NOT NULL' : 'p.eliminado_at IS NULL'}
      AND (lower(p.nombre) LIKE ? ESCAPE '\\' OR lower(COALESCE(p.email, '')) LIKE ? ESCAPE '\\')
    ORDER BY ${eliminados ? 'p.eliminado_at DESC' : 'p.id DESC'}
  `).all(patron, patron)
}

export function detalleCliente(id) {
  const cliente = db.prepare(`
    SELECT p.id, p.nombre, p.empresa, p.telefono, p.email, p.created_at, p.eliminado_at, p.motivo_eliminacion,
           p.eliminacion_lote, admin.nombre AS eliminado_por_nombre,
           c.id AS cuenta_id, c.debe_cambiar_password
    FROM prospectos p
    LEFT JOIN usuarios_personal admin ON admin.id = p.eliminado_por
    LEFT JOIN cuentas_cliente c ON c.prospecto_id = p.id
    WHERE p.id = ?
  `).get(id)
  if (!cliente) throw new ErrorPapelera(404, 'Cliente no encontrado')
  const direccion = db.prepare('SELECT * FROM direcciones_cliente WHERE prospecto_id = ?').get(id) ?? null
  const solicitudes = db.prepare(`
    SELECT s.id, s.created_at, s.estado_flujo, s.modalidad, s.consumo_mensual_kwh, s.eliminado_at,
           s.motivo_eliminacion, s.eliminacion_lote, admin.nombre AS eliminado_por_nombre,
           u.nombre AS agente_responsable, rt.estado AS revision_estado,
           cv.version AS cotizacion_version, cv.emitida_at AS cotizacion_emitida_at,
           (SELECT COUNT(*) FROM cotizaciones_versiones WHERE solicitud_id = s.id) AS total_cotizaciones
    FROM solicitudes_cotizacion s
    LEFT JOIN usuarios_personal admin ON admin.id = s.eliminado_por
    LEFT JOIN usuarios_personal u ON u.id = s.agente_responsable_id
    LEFT JOIN revisiones_tecnicas rt ON rt.solicitud_id = s.id
    LEFT JOIN cotizaciones_versiones cv ON cv.id = (SELECT id FROM cotizaciones_versiones WHERE solicitud_id = s.id ORDER BY version DESC LIMIT 1)
    WHERE s.prospecto_id = ?
    ORDER BY s.id DESC
  `).all(id).map((fila) => ({
    ...fila,
    // Se puede restaurar sola si se eliminó aparte (otro lote) y el cliente está activo.
    eliminada_con_cliente: Boolean(fila.eliminado_at && cliente.eliminado_at && fila.eliminacion_lote === cliente.eliminacion_lote),
    impacto_definitivo: fila.eliminado_at ? conteoDefinitivo({ solicitudes: [fila.id] }) : null,
  }))
  const activas = solicitudes.filter((fila) => !fila.eliminado_at).map((fila) => fila.id)
  return {
    cliente: { ...cliente, eliminacion_lote: undefined, debe_cambiar_password: cliente.cuenta_id ? Boolean(cliente.debe_cambiar_password) : null },
    direccion,
    solicitudes: solicitudes.map((fila) => ({ ...fila, eliminacion_lote: undefined })),
    impacto: {
      // Lo que se marcaría al eliminar el cliente (sus solicitudes activas y sus cotizaciones).
      eliminar: { solicitudes: activas.length, cotizaciones: cotizacionesDe(activas) },
      // Lo que se restauraría: solo las solicitudes del lote del cliente.
      restaurar: cliente.eliminado_at ? (() => {
        const delLote = solicitudes.filter((fila) => fila.eliminada_con_cliente).map((fila) => fila.id)
        return { solicitudes: delLote.length, cotizaciones: cotizacionesDe(delLote) }
      })() : null,
      definitivo: cliente.eliminado_at ? conteoDefinitivo({ prospectoId: id }) : null,
    },
  }
}

// ─── Borrado lógico ──────────────────────────────────────────────

export function eliminarCliente(id, adminId, motivo) {
  return enTransaccion(() => {
    const actual = prospecto(id)
    if (!actual) throw new ErrorPapelera(404, 'Cliente no encontrado')
    if (actual.eliminado_at) throw new ErrorPapelera(409, 'El cliente ya está en la papelera')
    const lote = randomUUID()
    db.prepare(`
      UPDATE prospectos SET eliminado_at = CURRENT_TIMESTAMP, eliminado_por = ?, motivo_eliminacion = ?, eliminacion_lote = ?
      WHERE id = ? AND eliminado_at IS NULL
    `).run(adminId, motivo, lote, id)
    const solicitudes = db.prepare(`
      UPDATE solicitudes_cotizacion SET eliminado_at = CURRENT_TIMESTAMP, eliminado_por = ?, motivo_eliminacion = ?, eliminacion_lote = ?
      WHERE prospecto_id = ? AND eliminado_at IS NULL
      RETURNING id
    `).all(adminId, motivo, lote, id).map((fila) => fila.id)
    // Los enlaces "Crea tu contraseña" pendientes vencen ya (UPDATE, sin borrar): tampoco sirven si se restaura.
    db.prepare(`
      UPDATE tokens_cuenta SET expira_at = datetime('now')
      WHERE cuenta_id IN (SELECT id FROM cuentas_cliente WHERE prospecto_id = ?) AND usado_at IS NULL AND expira_at > datetime('now')
    `).run(id)
    const cuentas = db.prepare('SELECT id FROM cuentas_cliente WHERE prospecto_id = ?').all(id).map((fila) => fila.id)
    return { solicitudes: solicitudes.length, cotizaciones: cotizacionesDe(solicitudes), cuentas }
  })
}

export function restaurarCliente(id) {
  return enTransaccion(() => {
    const actual = prospecto(id)
    if (!actual) throw new ErrorPapelera(404, 'Cliente no encontrado')
    if (!actual.eliminado_at) throw new ErrorPapelera(409, 'El cliente no está en la papelera')
    const solicitudes = db.prepare(`
      UPDATE solicitudes_cotizacion SET eliminado_at = NULL, eliminado_por = NULL, motivo_eliminacion = NULL, eliminacion_lote = NULL
      WHERE prospecto_id = ? AND eliminacion_lote = ?
      RETURNING id
    `).all(id, actual.eliminacion_lote).map((fila) => fila.id)
    db.prepare(`
      UPDATE prospectos SET eliminado_at = NULL, eliminado_por = NULL, motivo_eliminacion = NULL, eliminacion_lote = NULL
      WHERE id = ?
    `).run(id)
    return { solicitudes: solicitudes.length, cotizaciones: cotizacionesDe(solicitudes) }
  })
}

export function eliminarSolicitud(id, adminId, motivo) {
  return enTransaccion(() => {
    const actual = solicitud(id)
    if (!actual) throw new ErrorPapelera(404, 'Estimación no encontrada')
    if (actual.eliminado_at || actual.cliente_eliminado_at) throw new ErrorPapelera(409, 'La estimación ya está en la papelera')
    db.prepare(`
      UPDATE solicitudes_cotizacion SET eliminado_at = CURRENT_TIMESTAMP, eliminado_por = ?, motivo_eliminacion = ?, eliminacion_lote = ?
      WHERE id = ?
    `).run(adminId, motivo, randomUUID(), id)
    return { solicitudes: 1, cotizaciones: cotizacionesDe([id]) }
  })
}

export function restaurarSolicitud(id) {
  return enTransaccion(() => {
    const actual = solicitud(id)
    if (!actual) throw new ErrorPapelera(404, 'Estimación no encontrada')
    if (!actual.eliminado_at) throw new ErrorPapelera(409, 'La estimación no está en la papelera')
    if (actual.cliente_eliminado_at) throw new ErrorPapelera(409, 'El cliente de esta estimación está en la papelera: restaura primero al cliente')
    db.prepare(`
      UPDATE solicitudes_cotizacion SET eliminado_at = NULL, eliminado_por = NULL, motivo_eliminacion = NULL, eliminacion_lote = NULL
      WHERE id = ?
    `).run(id)
    return { solicitudes: 1, cotizaciones: cotizacionesDe([id]) }
  })
}

// ─── Eliminación definitiva ──────────────────────────────────────

// Subconsultas por tabla para un conjunto de solicitudes (y, si es un cliente, sus tablas propias).
// El orden de esta lista es el orden de borrado: firmas y órdenes primero (RESTRICT hacia la cotización y la
// cuenta) y cotizaciones antes que revisiones (cotizaciones_versiones.revision_id es RESTRICT).
const S = '(SELECT value FROM json_each(:solicitudes))'
const COTIZACIONES = `(SELECT id FROM cotizaciones_versiones WHERE solicitud_id IN ${S})`
const ORDENES = `(SELECT id FROM ordenes_instalacion WHERE cotizacion_id IN ${COTIZACIONES})`
const REVISIONES = `(SELECT id FROM revisiones_tecnicas WHERE solicitud_id IN ${S})`
const CUENTAS = '(SELECT id FROM cuentas_cliente WHERE prospecto_id = :prospecto)'
const TABLAS = [
  // [tabla, etiqueta, condición, se borra explícitamente (o cae por cascada de la fila anterior)]
  ['firmas_cotizacion', 'Firmas de cotización', `cotizacion_id IN ${COTIZACIONES} OR cuenta_cliente_id IN ${CUENTAS}`, true],
  ['checklist_evidencias', 'Evidencias de instalación', `orden_id IN ${ORDENES}`, false],
  ['mantenimientos_programados', 'Mantenimientos programados', `orden_id IN ${ORDENES}`, false],
  ['ordenes_instalacion', 'Órdenes de instalación', `cotizacion_id IN ${COTIZACIONES}`, true],
  ['cotizacion_version_items', 'Renglones de cotizaciones emitidas', `cotizacion_id IN ${COTIZACIONES}`, false],
  ['cotizaciones_versiones', 'Cotizaciones emitidas', `solicitud_id IN ${S}`, true],
  ['revision_tecnica_items', 'Renglones de revisión técnica', `revision_id IN ${REVISIONES}`, false],
  ['revision_tecnica_devoluciones', 'Devoluciones de revisión técnica', `revision_id IN ${REVISIONES}`, false],
  ['revisiones_tecnicas', 'Revisiones técnicas', `solicitud_id IN ${S}`, true],
  ['historial_cfe', 'Recibos CFE capturados', `solicitud_id IN ${S}`, true],
  ['electrodomesticos_solicitud', 'Electrodomésticos', `solicitud_id IN ${S}`, true],
  ['solicitudes_cotizacion', 'Solicitudes', `id IN ${S}`, true],
]
const TABLAS_CLIENTE = [
  ['tokens_cuenta', 'Enlaces de acceso', `cuenta_id IN ${CUENTAS}`, true],
  ['cuentas_cliente', 'Cuenta de acceso', 'prospecto_id = :prospecto', true],
  ['direcciones_cliente', 'Dirección', 'prospecto_id = :prospecto', true],
  ['consumos_prospecto', 'Consumo registrado', 'prospecto_id = :prospecto', true],
  ['prospectos', 'Cliente', 'id = :prospecto', true],
]
const NOTIFICACIONES = `prospecto_id = :prospecto OR solicitud_id IN ${S}`
// Las consultas con nombre comparten un mismo objeto de parámetros; cada una usa solo los que necesita.
const conNombres = (sql) => {
  const sentencia = db.prepare(sql)
  sentencia.setAllowUnknownNamedParameters(true)
  return sentencia
}

function alcance({ prospectoId = null, solicitudes = null }) {
  const ids = solicitudes ?? db.prepare('SELECT id FROM solicitudes_cotizacion WHERE prospecto_id = ?').all(prospectoId).map((fila) => fila.id)
  return { tablas: prospectoId ? [...TABLAS, ...TABLAS_CLIENTE] : TABLAS, parametros: { solicitudes: JSON.stringify(ids), prospecto: prospectoId ?? -1 } }
}

// Cuántas filas de cada tabla se borrarían, y cuántos registros de notificaciones se desvinculan (no se borran).
export function conteoDefinitivo(opciones) {
  const { tablas, parametros } = alcance(opciones)
  const tablasConteo = tablas.map(([tabla, etiqueta, condicion]) => ({
    tabla, etiqueta, total: Number(conNombres(`SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion}`).get(parametros).total),
  }))
  const notificaciones = Number(conNombres(`SELECT COUNT(*) AS total FROM registro_notificaciones WHERE ${NOTIFICACIONES}`).get(parametros).total)
  return { tablas: tablasConteo.filter((fila) => fila.total > 0), notificaciones }
}

// Borra físicamente un cliente (con todo lo suyo) o una estimación que ya estén en la papelera.
// Devuelve los conteos, la ruta del respaldo y los .eml del cliente que se deben borrar después del COMMIT.
export function eliminarDefinitivamente({ prospectoId = null, solicitudId = null, confirmacion = '' }) {
  if (prospectoId) {
    const actual = prospecto(prospectoId)
    if (!actual) throw new ErrorPapelera(404, 'Cliente no encontrado')
    if (!actual.eliminado_at) throw new ErrorPapelera(409, 'Solo se puede eliminar definitivamente un cliente que está en la papelera')
    const esperado = (actual.email || actual.nombre).trim().toLowerCase()
    if (typeof confirmacion !== 'string' || confirmacion.trim().toLowerCase() !== esperado) {
      throw new ErrorPapelera(400, actual.email ? 'Escribe el correo del cliente para confirmar' : 'Escribe el nombre del cliente para confirmar')
    }
  } else {
    const actual = solicitud(solicitudId)
    if (!actual) throw new ErrorPapelera(404, 'Estimación no encontrada')
    if (!actual.eliminado_at) throw new ErrorPapelera(409, 'Solo se puede eliminar definitivamente una estimación que está en la papelera')
  }

  // VACUUM INTO no puede ejecutarse dentro de una transacción: el respaldo va antes. Sin respaldo no se borra nada.
  let respaldo
  try {
    respaldo = respaldarBase(prospectoId ? `antes-eliminar-cliente-${prospectoId}` : `antes-eliminar-estimacion-${solicitudId}`)
  } catch (error) {
    console.error(error.stack ?? String(error))
    throw new ErrorPapelera(500, 'No se pudo crear el respaldo de la base en data/backups/. No se eliminó nada.')
  }
  const resultado = conMensajeDeFalla(() => enTransaccion(() => {
    // Se vuelve a comprobar dentro de la transacción por si otro administrador restauró el registro.
    const sigueEnPapelera = prospectoId ? prospecto(prospectoId)?.eliminado_at : solicitud(solicitudId)?.eliminado_at
    if (!sigueEnPapelera) throw new ErrorPapelera(409, 'El registro ya no está en la papelera')
    const opciones = prospectoId ? { prospectoId } : { solicitudes: [solicitudId] }
    const conteo = conteoDefinitivo(opciones)
    const { tablas, parametros } = alcance(opciones)
    const archivos = prospectoId
      ? conNombres(`SELECT archivo FROM registro_notificaciones WHERE (${NOTIFICACIONES}) AND archivo IS NOT NULL`).all(parametros).map((fila) => fila.archivo)
      : []
    // registro_notificaciones se conserva sin ids. Al eliminar un cliente, además se anonimiza el destinatario
    // y se vacía el detalle (puede repetir el correo en mensajes SMTP). Tipo, estado, fechas e intentos quedan.
    conNombres(prospectoId
      ? `UPDATE registro_notificaciones SET prospecto_id = NULL, solicitud_id = NULL, detalle_error = NULL,
           destinatario_email = 'eliminado-' || id || '@anonimo.invalid' WHERE ${NOTIFICACIONES}`
      : `UPDATE registro_notificaciones SET solicitud_id = NULL WHERE solicitud_id IN ${S}`).run(parametros)
    for (const [tabla, , condicion, explicita] of tablas) {
      if (explicita) conNombres(`DELETE FROM ${tabla} WHERE ${condicion}`).run(parametros)
    }
    const huerfanas = db.prepare('PRAGMA foreign_key_check').all()
    if (huerfanas.length) throw new ErrorPapelera(500, 'La verificación de integridad falló. Se deshizo todo y no se eliminó nada.')
    return { conteo, archivos }
  }))
  return { ...resultado, respaldo }
}

// Cualquier falla inesperada dentro de la transacción ya se deshizo: se registra el stack y se responde claro.
function conMensajeDeFalla(fn) {
  try {
    return fn()
  } catch (error) {
    if (error instanceof ErrorPapelera) throw error
    console.error(error.stack ?? String(error))
    throw new ErrorPapelera(500, 'No se pudo completar la eliminación. Se deshizo todo y no se eliminó nada.')
  }
}

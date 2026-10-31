import { createHash, randomBytes } from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { PNG } from 'pngjs'
import { db, completarPreciosVenta } from './database.js'
import { generarCotizacionPdf, generarOrdenPdf } from './documentosCompra.js'
import { guardarProyeccionCompra } from './ahorroCompras.js'

export const CONFORMIDAD = 'He revisado los conceptos, cantidades y precio final de esta cotización y acepto la propuesta. Entiendo que la compra se confirma después de verificar el pago.'
const error = (estado, mensaje) => Object.assign(new Error(mensaje), { status: estado })
const idValido = (valor) => Number.isSafeInteger(Number(valor)) && Number(valor) > 0 ? Number(valor) : null
const sha256 = (valor) => createHash('sha256').update(valor).digest('hex')
// ATLAS es un sistema de pruebas: habilitado por defecto en desarrollo local.
// Un entorno explícito de producción siempre prevalece sobre la bandera.
export const pagoSimuladoHabilitado = () => (process.env.NODE_ENV ?? 'development') === 'development'
  && (process.env.ATLAS_PAGO_SIMULADO ?? 'true') === 'true'

function datosPagoConfigurados() {
  const campos = { beneficiario: 'BENEFICIARIO', banco: 'BANCO', clabe: 'CLABE', cuenta: 'CUENTA', referencia: 'REFERENCIA' }
  const datos = Object.fromEntries(Object.entries(campos).flatMap(([clave, variable]) => {
    const valor = process.env[`ATLAS_PAGO_${variable}`]?.trim()
    if (valor?.length > 250) throw error(503, `La configuración de pago ${clave} es demasiado larga`)
    return valor ? [[clave, valor]] : []
  }))
  if (datos.clabe && !/^\d{18}$/.test(datos.clabe)) throw error(503, 'La CLABE configurada debe tener 18 dígitos')
  return Object.keys(datos).length ? datos : null
}

function transaccion(fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const resultado = fn(); db.exec('COMMIT'); return resultado } catch (err) { db.exec('ROLLBACK'); throw err }
}

export function actualizarVencimientos() {
  transaccion(() => {
    const vencidas = db.prepare("SELECT id, cotizacion_id FROM ordenes_pago WHERE estado = 'pendiente' AND limite_at <= CURRENT_TIMESTAMP").all()
    for (const orden of vencidas) {
      db.prepare("UPDATE ordenes_pago SET estado = 'vencida', vencida_at = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'pendiente'").run(orden.id)
      db.prepare("UPDATE cotizaciones_versiones SET estatus_respuesta = 'pago_vencido' WHERE id = ?").run(orden.cotizacion_id)
      db.prepare("INSERT OR IGNORE INTO pagos_auditoria (orden_pago_id, evento, detalle) VALUES (?, 'vencida', 'Plazo agotado; requiere verificación administrativa, nunca confirma una compra')").run(orden.id)
    }
  })
}

function obtenerCotizacion(id) {
  return db.prepare(`
    SELECT cv.*, s.prospecto_id, s.estado_flujo, s.agente_responsable_id,
           s.modalidad, s.consumo_mensual_kwh, s.consumo_objetivo_kwh, s.margen_crecimiento_pct,
           p.nombre, p.email, p.telefono, c.id AS cuenta_id,
           d.estado AS direccion_estado, d.municipio, d.colonia, d.codigo_postal,
           d.calle, d.numero_exterior, d.numero_interior
    FROM cotizaciones_versiones cv
    JOIN solicitudes_cotizacion s ON s.id = cv.solicitud_id
    JOIN prospectos p ON p.id = s.prospecto_id
    JOIN cuentas_cliente c ON c.prospecto_id = p.id
    LEFT JOIN direcciones_cliente d ON d.prospecto_id = p.id
    WHERE cv.id = ? AND p.eliminado_at IS NULL AND s.eliminado_at IS NULL
  `).get(id)
}

function autorizarCotizacion(usuario, id, personal = false) {
  const cotizacion = obtenerCotizacion(idValido(id))
  if (!cotizacion) throw error(404, 'Cotización no encontrada')
  if (usuario.rol === 'Cliente' && usuario.cuenta_id === cotizacion.cuenta_id && usuario.prospecto_id === cotizacion.prospecto_id) return cotizacion
  if (personal && (usuario.rol === 'Administrador' || (usuario.rol === 'Agente' && usuario.usuario_id === cotizacion.agente_responsable_id))) return cotizacion
  throw error(404, 'Cotización no encontrada')
}

function conceptosVenta(id) {
  return db.prepare(`SELECT producto_codigo, tipo, modelo, clasificacion, cantidad,
    precio_unitario_venta, subtotal_venta FROM cotizacion_version_items WHERE cotizacion_id = ? ORDER BY id`).all(id)
}

function snapshotCotizacion(cotizacion) {
  return {
    id: cotizacion.id, folio: `COT-${String(cotizacion.id).padStart(6, '0')}-V${cotizacion.version}`,
    version: cotizacion.version, emitida_at: cotizacion.emitida_at,
    precio_venta: cotizacion.precio_venta, moneda: 'MXN',
    destinatario: { nombre: cotizacion.nombre, email: cotizacion.email, telefono: cotizacion.telefono },
    direccion: [cotizacion.calle, cotizacion.numero_exterior, cotizacion.numero_interior, cotizacion.colonia,
      cotizacion.codigo_postal, cotizacion.municipio, cotizacion.direccion_estado].filter(Boolean).join(', '),
    items: conceptosVenta(cotizacion.id), conformidad: CONFORMIDAD,
    proyecto: {
      modalidad: cotizacion.modalidad,
      consumo_mensual_kwh: cotizacion.consumo_mensual_kwh,
      consumo_objetivo_kwh: cotizacion.consumo_objetivo_kwh,
      margen_crecimiento_pct: cotizacion.margen_crecimiento_pct,
    },
    nota_precios: 'Precios de venta prorrateados del total aprobado; unitarios hasta 6 decimales y subtotales redondeados a centavos. El total mostrado es el importe final a pagar.',
  }
}

export function resumenCompra(cotizacionId) {
  const cotizacion = obtenerCotizacion(cotizacionId)
  if (!cotizacion) return null
  const firma = db.prepare('SELECT * FROM firmas_cotizacion WHERE cotizacion_id = ?').get(cotizacionId)
  const snapshot = firma?.snapshot_json ? JSON.parse(firma.snapshot_json) : snapshotCotizacion(cotizacion)
  const orden = db.prepare('SELECT * FROM ordenes_pago WHERE cotizacion_id = ?').get(cotizacionId)
  const datosPago = orden?.datos_pago_json ? JSON.parse(orden.datos_pago_json) : null
  const instalacion = orden?.estado === 'pagada' ? db.prepare(`SELECT oi.id, oi.fecha_programada, oi.fecha_fin_real, oi.estatus_obra,
    oi.iniciada_at, u.nombre AS tecnico_nombre FROM ordenes_instalacion oi
    LEFT JOIN usuarios_personal u ON u.id = oi.tecnico_id WHERE oi.cotizacion_id = ?`).get(cotizacionId) : null
  return {
    ...snapshot,
    estado: orden?.estado === 'pagada' ? 'Compra confirmada' : orden ? orden.estado === 'vencida' ? 'Pago vencido' : 'Pago pendiente' : 'Tu cotización está lista',
    firmada: Boolean(firma),
    aceptacion: firma ? { nombre: firma.nombre_firmante, firmada_at: firma.firmada_at, sha256: firma.snapshot_sha256 } : null,
    orden_pago: orden ? {
      id: orden.id, folio: orden.folio, importe: orden.importe, moneda: orden.moneda,
      emitida_at: orden.emitida_at, limite_at: orden.limite_at, estado: orden.estado,
      instrucciones: orden.instrucciones, datos_pago: datosPago,
      instrucciones_pendientes: !orden.instrucciones && !(datosPago?.beneficiario && datosPago?.banco && (datosPago?.clabe || datosPago?.cuenta)),
      pago_fecha: orden.pago_fecha, confirmada_at: orden.confirmada_at,
      pago_simulado: Boolean(orden.pago_simulado),
      permite_pago_simulado: pagoSimuladoHabilitado() && orden.estado === 'pendiente',
    } : null,
    instalacion: instalacion ? { ...instalacion, folio: `INS-${String(instalacion.id).padStart(6, '0')}` } : null,
  }
}

function validarFirma(valor) {
  if (typeof valor !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(valor)) throw error(400, 'La firma debe ser una imagen PNG válida')
  const bytes = Buffer.from(valor.slice('data:image/png;base64,'.length), 'base64')
  if (bytes.length < 70 || bytes.length > 180000 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw error(400, 'Firma PNG inválida o mayor a 180 KB')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (width < 100 || height < 50 || width > 1600 || height > 800 || width * height > 1000000) throw error(400, 'Dimensiones de firma no válidas')
  let png
  try { png = PNG.sync.read(bytes, { checkCRC: true }) } catch { throw error(400, 'No se pudo leer la firma PNG') }
  let puntos = 0, minX = width, maxX = 0, minY = height, maxY = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    if (png.data[i + 3] > 60 && png.data[i] + png.data[i + 1] + png.data[i + 2] < 600) {
      puntos++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
  }
  if (puntos < 30 || maxX - minX < 15 || maxY - minY < 5) throw error(400, 'Traza tu firma; el lienzo está vacío o el trazo es insuficiente')
  return PNG.sync.write(png).toString('base64')
}

function firmar(usuario, cotizacionId, cuerpo, request) {
  const cotizacion = autorizarCotizacion(usuario, cotizacionId)
  const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : ''
  if (nombre.length < 3 || nombre.length > 180) throw error(400, 'Escribe tu nombre completo (3 a 180 caracteres)')
  if (cuerpo.conforme !== true) throw error(400, 'Debes marcar la conformidad con la propuesta')
  const firmaBase64 = validarFirma(cuerpo.firma)
  return transaccion(() => {
    const vigente = autorizarCotizacion(usuario, cotizacionId)
    const ultima = db.prepare('SELECT MAX(id) AS id FROM cotizaciones_versiones WHERE solicitud_id = ?').get(vigente.solicitud_id)
    if (ultima.id !== vigente.id || vigente.estado_flujo !== 'pendiente_respuesta' || vigente.estatus_respuesta !== 'pendiente') throw error(409, 'Esta cotización ya fue aceptada o no está disponible para firma')
    if (db.prepare('SELECT 1 FROM firmas_cotizacion WHERE cotizacion_id = ?').get(vigente.id)) throw error(409, 'La cotización ya está firmada')
    completarPreciosVenta(vigente.id)
    const snapshot = snapshotCotizacion(vigente)
    if (!snapshot.items.length) throw error(409, 'La cotización no tiene conceptos')
    const json = JSON.stringify(snapshot)
    const firmaId = Number(db.prepare(`INSERT INTO firmas_cotizacion
      (cotizacion_id, cuenta_cliente_id, firma_png_b64, direccion_ip, user_agent, nombre_firmante, conformidad_texto, snapshot_json, snapshot_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(vigente.id, usuario.cuenta_id, firmaBase64,
      request.ip, String(request.get('user-agent') || '').slice(0, 500), nombre, CONFORMIDAD, json, sha256(json)).lastInsertRowid)
    const dias = Number(process.env.ATLAS_PAGO_PLAZO_DIAS || 7)
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw error(503, 'El plazo de pago configurado no es válido')
    const instrucciones = process.env.ATLAS_PAGO_INSTRUCCIONES?.trim() || null
    if (instrucciones?.length > 5000) throw error(503, 'Las instrucciones de pago configuradas son demasiado largas')
    const datosPago = datosPagoConfigurados()
    const ordenId = Number(db.prepare(`INSERT INTO ordenes_pago (cotizacion_id, firma_id, folio, importe, instrucciones, datos_pago_json, limite_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`).run(vigente.id, firmaId, `PAG-${vigente.id}-${randomBytes(4).toString('hex').toUpperCase()}`,
      vigente.precio_venta, instrucciones, datosPago ? JSON.stringify(datosPago) : null, `+${dias} days`).lastInsertRowid)
    db.prepare("INSERT INTO pagos_auditoria (orden_pago_id, evento, actor_id, detalle) VALUES (?, 'emitida', ?, ?)").run(ordenId, usuario.cuenta_id, 'Cotización aceptada. Orden emitida sin recepción de dinero.')
    db.prepare("UPDATE cotizaciones_versiones SET estatus_respuesta = 'aprobada' WHERE id = ?").run(vigente.id)
    db.prepare("UPDATE solicitudes_cotizacion SET estado_flujo = 'aceptada_pendiente_pago' WHERE id = ?").run(vigente.solicitud_id)
    return { cotizacion: resumenCompra(cotizacion.id) }
  })
}

function confirmarPago(usuario, ordenId, cuerpo) {
  if (!db.prepare("SELECT id FROM usuarios_personal WHERE id = ? AND rol = 'Administrador' AND activo = 1").get(usuario.usuario_id)) throw error(403, 'Administrador activo requerido')
  const fecha = typeof cuerpo.fecha_pago === 'string' ? cuerpo.fecha_pago : ''
  const instante = new Date(fecha)
  const referencia = typeof cuerpo.referencia === 'string' ? cuerpo.referencia.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*Z$/.test(fecha) || !Number.isFinite(instante.getTime()) || instante.getTime() > Date.now() + 60000) throw error(400, 'Indica la fecha real del pago, sin fechas futuras')
  if (referencia.length < 3 || referencia.length > 250 || cuerpo.verificado !== true) throw error(400, 'Se requiere una referencia y confirmar que verificaste el pago real del importe completo')
  actualizarVencimientos()
  return transaccion(() => {
    const orden = db.prepare('SELECT * FROM ordenes_pago WHERE id = ?').get(idValido(ordenId))
    if (!orden) throw error(404, 'Orden de pago no encontrada')
    if (orden.estado === 'pagada') throw error(409, 'El pago ya fue confirmado')
    const cotizacion = obtenerCotizacion(orden.cotizacion_id)
    if (!cotizacion || cotizacion.estado_flujo !== 'aceptada_pendiente_pago') throw error(409, 'La compra no está disponible para confirmar')
    const motivo = typeof cuerpo.motivo_tardio === 'string' ? cuerpo.motivo_tardio.trim() : ''
    if (orden.estado === 'vencida' && (motivo.length < 5 || motivo.length > 1000)) throw error(400, 'La orden venció: explica por qué procede confirmar este pago tardío')
    if (instante < new Date(orden.emitida_at.replace(' ', 'T') + 'Z')) throw error(400, 'La fecha de pago debe ser posterior a la emisión de la orden')
    db.prepare(`UPDATE ordenes_pago SET estado = 'pagada', pago_fecha = ?, pago_referencia = ?, confirmada_at = CURRENT_TIMESTAMP,
      confirmada_por = ?, motivo_pago_tardio = ? WHERE id = ? AND estado <> 'pagada'`).run(instante.toISOString(), referencia, usuario.usuario_id, orden.estado === 'vencida' ? motivo : null, orden.id)
    registrarConversion(cotizacion)
    db.prepare("INSERT INTO pagos_auditoria (orden_pago_id, evento, actor_id, detalle) VALUES (?, 'confirmada', ?, ?)").run(orden.id, usuario.usuario_id,
      JSON.stringify({ fecha_pago: instante.toISOString(), referencia, importe: orden.importe, motivo_tardio: motivo || null }))
    return { cotizacion: resumenCompra(cotizacion.id) }
  })
}

function registrarConversion(cotizacion) {
  guardarProyeccionCompra(cotizacion.id)
  db.prepare("UPDATE solicitudes_cotizacion SET estado_flujo = 'venta_confirmada' WHERE id = ?").run(cotizacion.solicitud_id)
  db.prepare("UPDATE cotizaciones_versiones SET estatus_respuesta = 'aprobada' WHERE id = ?").run(cotizacion.id)
  db.prepare('UPDATE cuentas_cliente SET cliente_desde = COALESCE(cliente_desde, CURRENT_TIMESTAMP) WHERE id = ?').run(cotizacion.cuenta_id)
  db.prepare("UPDATE prospectos SET estado = 'Cerrado ganado', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(cotizacion.prospecto_id)
  // La orden es una entidad distinta, pero su responsable es el autor de la revisión
  // ligada a la versión aceptada. Nunca se obtiene del navegador ni de otro técnico de la zona.
  db.prepare(`INSERT OR IGNORE INTO ordenes_instalacion (cotizacion_id, tecnico_id)
    SELECT ?, tecnico_id FROM revisiones_tecnicas WHERE id = ?`).run(cotizacion.id, cotizacion.revision_id)
}

function resumenIngresos(usuario) {
  const agente = usuario.rol === 'Agente'
  return db.prepare(`SELECT
      ROUND(COALESCE(SUM(op.importe), 0), 2) AS total,
      ROUND(COALESCE(SUM(CASE WHEN op.pago_simulado = 0 THEN op.importe ELSE 0 END), 0), 2) AS reales,
      ROUND(COALESCE(SUM(CASE WHEN op.pago_simulado = 1 THEN op.importe ELSE 0 END), 0), 2) AS simulados,
      COUNT(*) AS compras
    FROM ordenes_pago op
    JOIN cotizaciones_versiones cv ON cv.id = op.cotizacion_id
    JOIN solicitudes_cotizacion s ON s.id = cv.solicitud_id
    JOIN prospectos p ON p.id = s.prospecto_id
    WHERE op.estado = 'pagada' AND s.estado_flujo = 'venta_confirmada'
      AND p.eliminado_at IS NULL AND s.eliminado_at IS NULL
      ${agente ? 'AND s.agente_responsable_id = ?' : ''}`).get(...(agente ? [usuario.usuario_id] : []))
}

function simularPago(usuario, ordenId) {
  if (!pagoSimuladoHabilitado()) throw error(403, 'La simulación de pago solo está disponible en desarrollo')
  actualizarVencimientos()
  return transaccion(() => {
    const orden = db.prepare('SELECT * FROM ordenes_pago WHERE id = ?').get(idValido(ordenId))
    if (!orden) throw error(404, 'Orden de pago no encontrada')
    const cotizacion = autorizarCotizacion(usuario, orden.cotizacion_id)
    if (orden.estado === 'pagada' && orden.pago_simulado === 1) return { cotizacion: resumenCompra(cotizacion.id), repetida: true }
    if (orden.estado !== 'pendiente' || cotizacion.estado_flujo !== 'aceptada_pendiente_pago') throw error(409, 'La orden ya no está pendiente de pago')
    db.prepare(`UPDATE ordenes_pago SET estado = 'pagada', pago_simulado = 1, simulada_por = ?,
      confirmada_at = CURRENT_TIMESTAMP WHERE id = ? AND estado = 'pendiente'`).run(usuario.cuenta_id, orden.id)
    registrarConversion(cotizacion)
    db.prepare("INSERT INTO pagos_auditoria (orden_pago_id, evento, actor_id, detalle) VALUES (?, 'confirmada', ?, ?)").run(orden.id, usuario.cuenta_id,
      JSON.stringify({ pago_simulado: true, tipo_actor: 'cuenta_cliente', importe: orden.importe, entorno: 'development', detalle: 'Prueba de conversión; no se recibió dinero ni se verificó una transferencia.' }))
    return { cotizacion: resumenCompra(cotizacion.id), repetida: false }
  })
}

export function registrarRutasCompras(app, autenticar, permitirRoles) {
  const envolver = (fn) => async (req, res) => {
    try { await fn(req, res) } catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo completar la operación de compra' }) }
  }
  const pdf = (res, bytes, nombre) => res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(bytes))
  app.get('/api/portal/cotizaciones/:id', autenticar, permitirRoles('Cliente'), envolver((req, res) => {
    actualizarVencimientos(); const cotizacion = autorizarCotizacion(req.usuario, req.params.id); res.json(resumenCompra(cotizacion.id))
  }))
  app.post('/api/portal/cotizaciones/:id/firmar', autenticar, permitirRoles('Cliente'), envolver((req, res) => res.status(201).json(firmar(req.usuario, req.params.id, req.body ?? {}, req))))
  app.get('/api/cotizaciones/:id/pdf', autenticar, permitirRoles('Cliente', 'Administrador', 'Agente'), envolver(async (req, res) => {
    const cotizacion = autorizarCotizacion(req.usuario, req.params.id, true)
    const firma = db.prepare('SELECT * FROM firmas_cotizacion WHERE cotizacion_id = ?').get(cotizacion.id)
    const snapshot = firma?.snapshot_json ? JSON.parse(firma.snapshot_json) : snapshotCotizacion(cotizacion)
    pdf(res, await generarCotizacionPdf(snapshot, firma), snapshot.folio)
  }))
  app.get('/api/portal/ordenes-pago/:id/pdf', autenticar, permitirRoles('Cliente'), envolver(async (req, res) => {
    actualizarVencimientos()
    const orden = db.prepare('SELECT * FROM ordenes_pago WHERE id = ?').get(idValido(req.params.id))
    if (!orden) throw error(404, 'Orden no encontrada')
    const cotizacion = autorizarCotizacion(req.usuario, orden.cotizacion_id)
    pdf(res, await generarOrdenPdf(resumenCompra(cotizacion.id)), orden.folio)
  }))
  app.get('/api/admin/pagos', autenticar, permitirRoles('Administrador'), envolver((_req, res) => {
    actualizarVencimientos()
    const ordenes = db.prepare(`SELECT o.*, p.nombre, p.email FROM ordenes_pago o
      JOIN cotizaciones_versiones cv ON cv.id = o.cotizacion_id JOIN solicitudes_cotizacion s ON s.id = cv.solicitud_id
      JOIN prospectos p ON p.id = s.prospecto_id WHERE p.eliminado_at IS NULL AND s.eliminado_at IS NULL ORDER BY o.id DESC`).all()
    res.json(ordenes.map((orden) => ({ ...orden, auditoria: db.prepare('SELECT * FROM pagos_auditoria WHERE orden_pago_id = ? ORDER BY id').all(orden.id) })))
  }))
  app.post('/api/admin/pagos/:id/confirmar', autenticar, permitirRoles('Administrador'), envolver((req, res) => res.json(confirmarPago(req.usuario, req.params.id, req.body ?? {}))))
  app.post('/api/portal/ordenes-pago/:id/simular', autenticar, permitirRoles('Cliente'), envolver((req, res) => res.json(simularPago(req.usuario, req.params.id))))
  app.get('/api/ventas/resumen', autenticar, permitirRoles('Administrador', 'Agente'), envolver((req, res) => res.json(resumenIngresos(req.usuario))))
}

// Al volver a iniciar se recuperan también los vencimientos ocurridos con el servidor apagado.
actualizarVencimientos()

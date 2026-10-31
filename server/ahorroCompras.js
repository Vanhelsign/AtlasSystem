import { db } from './database.js'
import { proyectarContado } from '../shared/proyeccionContado.js'

const seleccionar = `SELECT cv.id, cv.version, cv.supuestos_ahorro, op.importe,
  op.folio AS folio_pago, op.confirmada_at, s.prospecto_id, c.id AS cuenta_id,
  c.cliente_desde FROM cotizaciones_versiones cv
  JOIN solicitudes_cotizacion s ON s.id = cv.solicitud_id
  JOIN prospectos p ON p.id = s.prospecto_id AND p.eliminado_at IS NULL AND s.eliminado_at IS NULL
  JOIN cuentas_cliente c ON c.prospecto_id = s.prospecto_id
  JOIN ordenes_pago op ON op.cotizacion_id = cv.id AND op.estado = 'pagada'`

// INSERT OR IGNORE congela una sola vez. Las compras antiguas se incorporan
// al consultarlas usando exclusivamente el snapshot de emisión que conservan.
export function guardarProyeccionCompra(id) {
  const existente = db.prepare('SELECT datos_json FROM proyecciones_compra WHERE cotizacion_id = ?').get(id)
  if (existente) return JSON.parse(existente.datos_json)
  const compra = db.prepare(`${seleccionar} WHERE cv.id = ?`).get(id)
  if (!compra) return null
  let supuestos = null
  try { supuestos = JSON.parse(compra.supuestos_ahorro) } catch { /* Snapshot anterior ausente o inválido. */ }
  const calculo = proyectarContado(supuestos, compra.importe)
  const datos = { ...supuestos, ...calculo, resultado: calculo.resultado ?? null,
    version_calculo_contado: 1, calculado_at: new Date().toISOString() }
  db.prepare('INSERT OR IGNORE INTO proyecciones_compra (cotizacion_id, importe_contado, datos_json) VALUES (?, ?, ?)')
    .run(id, compra.importe, JSON.stringify(datos))
  return JSON.parse(db.prepare('SELECT datos_json FROM proyecciones_compra WHERE cotizacion_id = ?').get(id).datos_json)
}

export function registrarRutasAhorro(app, autenticar, permitirRoles) {
  const clienteConfirmado = (req, res, next) => {
    const cuenta = db.prepare('SELECT cliente_desde FROM cuentas_cliente WHERE id = ? AND prospecto_id = ?').get(req.usuario.cuenta_id, req.usuario.prospecto_id)
    if (!cuenta?.cliente_desde) return res.status(403).json({ error: 'El ahorro e inversión está disponible solo para Clientes con una compra confirmada.' })
    res.set('Cache-Control', 'private, no-store')
    next()
  }
  app.get('/api/portal/ahorro', autenticar, permitirRoles('Cliente'), clienteConfirmado, (req, res) => {
    const compras = db.prepare(`${seleccionar} WHERE c.id = ? AND s.prospecto_id = ? ORDER BY op.confirmada_at DESC, cv.id DESC`).all(req.usuario.cuenta_id, req.usuario.prospecto_id)
    res.json(compras.map((c) => ({ cotizacion_id: c.id, version: c.version, folio_pago: c.folio_pago, importe: c.importe, confirmada_at: c.confirmada_at })))
  })
  app.get('/api/portal/ahorro/:id', autenticar, permitirRoles('Cliente'), clienteConfirmado, (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Cotización inválida' })
    const compra = db.prepare(`${seleccionar} WHERE cv.id = ? AND c.id = ? AND s.prospecto_id = ?`).get(id, req.usuario.cuenta_id, req.usuario.prospecto_id)
    if (!compra) return res.status(404).json({ error: 'Compra confirmada no encontrada' })
    const ahorro = guardarProyeccionCompra(id)
    res.json({ id, version: compra.version, precio_venta: compra.importe, ahorro })
  })
}

import { createHash, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { PNG } from 'pngjs'
import { db } from './database.js'
import { ESTADOS_MEXICO } from '../shared/estadosMexico.js'
import { actividadesInstalacion, estadoInstalacion, PARTES_INSTALACION } from '../shared/instalacion.js'
import { progresoCliente } from '../shared/progresoCliente.js'
import { resumenCompra } from './compras.js'

const error = (status, mensaje) => Object.assign(new Error(mensaje), { status })
const id = (valor) => { const n = Number(valor); if (!Number.isSafeInteger(n) || n <= 0) throw error(400, 'Identificador inválido'); return n }
const texto = (valor, max = 500) => { if (valor === undefined || valor === null) return ''; if (typeof valor !== 'string' || valor.trim().length > max) throw error(400, `Texto inválido o mayor a ${max} caracteres`); return valor.trim() }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const codigos = new Set(ESTADOS_MEXICO.map(e => e.codigo))
const carpeta = resolve(process.env.ATLAS_EVIDENCIAS_DIR || join(process.env.ATLAS_DB_PATH ? dirname(resolve(process.env.ATLAS_DB_PATH)) : resolve(dirname(fileURLToPath(import.meta.url)), '../data'), 'evidencias'))
const select = `SELECT oi.*, p.nombre AS cliente_nombre, s.prospecto_id, c.id AS cuenta_id,
  d.estado_codigo, d.estado, d.municipio, d.colonia, d.calle, d.numero_exterior, d.numero_interior, d.codigo_postal,
  cv.version, rt.tecnico_id AS tecnico_dimensionamiento_id, u.nombre AS tecnico_nombre, op.pago_simulado, op.confirmada_at AS pago_confirmado_at
  FROM ordenes_instalacion oi JOIN cotizaciones_versiones cv ON cv.id=oi.cotizacion_id
  JOIN revisiones_tecnicas rt ON rt.id=cv.revision_id
  JOIN solicitudes_cotizacion s ON s.id=cv.solicitud_id JOIN prospectos p ON p.id=s.prospecto_id
  JOIN cuentas_cliente c ON c.prospecto_id=p.id JOIN direcciones_cliente d ON d.prospecto_id=p.id
  JOIN ordenes_pago op ON op.cotizacion_id=cv.id AND op.estado='pagada'
  LEFT JOIN usuarios_personal u ON u.id=oi.tecnico_id
  WHERE p.eliminado_at IS NULL AND s.eliminado_at IS NULL AND s.estado_flujo='venta_confirmada'`
const ordenPorId = (ordenId) => db.prepare(`${select} AND oi.id=?`).get(id(ordenId))
const folio = (orden) => ({ ...orden, folio: `INS-${String(orden.id).padStart(6, '0')}` })
function tecnicoActivo(usuario) {
  const tecnico = db.prepare("SELECT id, estado_trabajo_codigo FROM usuarios_personal WHERE id=? AND rol='Técnico' AND activo=1").get(usuario.usuario_id)
  if (!tecnico || !codigos.has(tecnico.estado_trabajo_codigo)) throw error(403, 'Se requiere un técnico activo con estado de trabajo válido')
  return tecnico
}
function autorizar(usuario, ordenId, editar = false) {
  const tecnico = tecnicoActivo(usuario), orden = ordenPorId(ordenId)
  if (!orden || orden.estado_codigo !== tecnico.estado_trabajo_codigo || orden.tecnico_dimensionamiento_id !== tecnico.id) throw error(404, 'Orden no disponible para tu cuenta y estado de trabajo')
  if (orden.tecnico_id !== null && orden.tecnico_id !== tecnico.id) throw error(403, 'La orden ya está tomada por otro técnico')
  if (editar && orden.tecnico_id !== tecnico.id) throw error(409, 'Primero debes tomar la orden')
  return { orden, tecnico }
}
function abierta(orden) { if (orden.estatus_obra === 'completada') throw error(409, 'La instalación finalizada es de solo consulta') }
const pendientes = (ordenId) => Number(db.prepare("SELECT COUNT(*) AS n FROM incidencias_instalacion WHERE orden_id=? AND estado='pendiente'").get(ordenId).n)
function materialesDe(orden) {
  return db.prepare('SELECT tipo, modelo, clasificacion, cantidad FROM cotizacion_version_items WHERE cotizacion_id=? ORDER BY id').all(orden.cotizacion_id)
}
function actividadesDe(orden) {
  const guardadas = new Map(db.prepare('SELECT * FROM checklist_evidencias WHERE orden_id=? AND actividad_codigo IS NOT NULL').all(orden.id).map(a => [a.actividad_codigo, a]))
  return actividadesInstalacion(materialesDe(orden)).map(a => ({ ...a, completado: Boolean(guardadas.get(a.codigo)?.completado), observaciones: guardadas.get(a.codigo)?.observaciones || '' }))
}
function avance(orden) {
  const actividades = actividadesDe(orden)
  return PARTES_INSTALACION.map((nombre, indice) => {
    const parte = indice + 1, items = actividades.filter(a => a.parte === parte)
    const fotos = Number(db.prepare('SELECT COUNT(*) AS n FROM fotos_instalacion WHERE orden_id=? AND parte=?').get(orden.id, parte).n)
    return { parte, nombre, total: items.length, completadas: items.filter(a => a.completado).length, evidencia: fotos > 0,
      completa: items.every(a => a.completado) && fotos > 0 }
  })
}
function detalle(orden) {
  return { ...folio(orden), estado_visible: estadoInstalacion(orden, pendientes(orden.id)), materiales: materialesDe(orden), actividades: actividadesDe(orden), etapas: avance(orden),
    incidencias: db.prepare('SELECT * FROM incidencias_instalacion WHERE orden_id=? ORDER BY id DESC').all(orden.id),
    fotos: db.prepare('SELECT id, parte, actividad_codigo, incidencia_id, tecnico_id, descripcion, mime, bytes, created_at FROM fotos_instalacion WHERE orden_id=? ORDER BY id').all(orden.id),
    // Filas anteriores sin actividad específica se conservan, sin considerarlas verificaciones de esta versión.
    registros_anteriores: db.prepare('SELECT etapa, completado, observaciones FROM checklist_evidencias WHERE orden_id=? AND actividad_codigo IS NULL').all(orden.id) }
}
function transaccion(fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const resultado = fn(); db.exec('COMMIT'); return resultado } catch (err) { db.exec('ROLLBACK'); throw err }
}
function tocar(ordenId) { db.prepare('UPDATE ordenes_instalacion SET revision_avance=revision_avance+1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(ordenId) }
function sincronizarEstado(ordenId) {
  const o = ordenPorId(ordenId)
  // Un estado heredado de incidencia no equivale a una resolución comprobada.
  if (o.estatus_obra === 'incidencia' && !db.prepare('SELECT 1 FROM incidencias_instalacion WHERE orden_id=?').get(ordenId)) return
  if (o.estatus_obra !== 'completada') db.prepare('UPDATE ordenes_instalacion SET estatus_obra=? WHERE id=?').run(pendientes(ordenId) ? 'incidencia' : o.iniciada_at ? 'en_progreso' : 'asignada', ordenId)
}
function operacion(orden, cuerpo, tipo, fn) {
  const clave = texto(cuerpo.operacion_id, 80)
  if (!/^[A-Za-z0-9-]{16,80}$/.test(clave)) throw error(400, 'Falta una clave de operación válida')
  const contenidoHash = hash(JSON.stringify({ tipo, cuerpo }))
  const existente = db.prepare('SELECT hash FROM operaciones_instalacion WHERE orden_id=? AND clave=?').get(orden.id, clave)
  if (existente) { if (existente.hash !== contenidoHash) throw error(409, 'La clave ya se utilizó con otros datos'); return }
  abierta(orden)
  fn()
  db.prepare('INSERT INTO operaciones_instalacion (orden_id,clave,hash) VALUES (?,?,?)').run(orden.id, clave, contenidoHash)
  tocar(orden.id)
}
function validarActividad(orden, parte, codigo) {
  if (!Number.isInteger(parte) || parte < 1 || parte > 3) throw error(400, 'Parte inválida')
  if (codigo && !actividadesDe(orden).some(a => a.codigo === codigo && a.parte === parte)) throw error(400, 'La actividad no pertenece a esta parte y cotización')
}

// Valida contenido real, dimensiones y tamaño antes de escribir fuera del directorio público.
function imagen(valor) {
  if (typeof valor !== 'string' || valor.length > 7_000_000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(valor)) throw error(400, 'Selecciona una foto PNG o JPEG de máximo 5 MB')
  const bytes = Buffer.from(valor.slice(valor.indexOf(',') + 1), 'base64')
  if (bytes.length < 70 || bytes.length > 5 * 1024 * 1024) throw error(400, 'La foto debe tener un tamaño válido, máximo 5 MB')
  const png = valor.startsWith('data:image/png;')
  const dimensiones = (w, h) => { if (!w || !h || w > 12000 || h > 12000 || w * h > 24_000_000) throw error(400, 'La foto supera el límite de 24 megapíxeles o tiene dimensiones inválidas') }
  try {
    if (png) {
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error()
      dimensiones(bytes.readUInt32BE(16), bytes.readUInt32BE(20)); PNG.sync.read(bytes, { checkCRC: true })
    } else {
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw new Error()
      let posicion = 2, encontrado = false
      while (posicion < bytes.length - 4) {
        if (bytes[posicion++] !== 255) throw new Error()
        while (bytes[posicion] === 255) posicion++
        const marcador = bytes[posicion++]
        if (marcador === 218 || marcador === 217) break
        const largo = bytes.readUInt16BE(posicion)
        if (largo < 2 || posicion + largo > bytes.length) throw new Error()
        if ([192,193,194].includes(marcador)) { dimensiones(bytes.readUInt16BE(posicion + 5), bytes.readUInt16BE(posicion + 3)); encontrado = true }
        posicion += largo
      }
      if (!encontrado) throw new Error()
    }
  } catch (err) { if (err.status) throw err; throw error(400, 'El contenido no corresponde a una foto PNG/JPEG válida') }
  return { bytes, mime: png ? 'image/png' : 'image/jpeg', extension: png ? 'png' : 'jpg' }
}
function guardarFotos(orden, tecnico, parte, fotos, archivosNuevos, incidenciaId = null) {
  if (!Array.isArray(fotos) || fotos.length > 3) throw error(400, 'Adjunta hasta tres fotos por guardado')
  for (const foto of fotos) {
    const clave = texto(foto.clave_carga, 80), descripcion = texto(foto.descripcion)
    if (!/^[A-Za-z0-9-]{16,80}$/.test(clave)) throw error(400, 'Clave de foto inválida')
    const actividad = texto(foto.actividad_codigo, 80) || null
    validarActividad(orden, parte, actividad)
    const archivoImagen = imagen(foto.imagen), sha = hash(archivoImagen.bytes)
    const existente = db.prepare('SELECT * FROM fotos_instalacion WHERE orden_id=? AND clave_carga=?').get(orden.id, clave)
    if (existente) {
      if (existente.sha256 !== sha || existente.parte !== parte || existente.incidencia_id !== incidenciaId || existente.actividad_codigo !== actividad || (existente.descripcion || '') !== descripcion) throw error(409, 'La clave de foto ya corresponde a otra evidencia')
      continue
    }
    mkdirSync(carpeta, { recursive: true })
    const archivo = `${randomUUID()}.${archivoImagen.extension}`, destino = join(carpeta, archivo)
    writeFileSync(destino, archivoImagen.bytes, { flag: 'wx', mode: 0o600 }); archivosNuevos.push(destino)
    db.prepare(`INSERT INTO fotos_instalacion (orden_id,parte,actividad_codigo,incidencia_id,tecnico_id,clave_carga,archivo,mime,bytes,sha256,descripcion)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(orden.id, parte, actividad, incidenciaId, tecnico.id, clave, archivo, archivoImagen.mime, archivoImagen.bytes.length, sha, descripcion)
  }
}
function conArchivos(fn) {
  const nuevos = []
  try { return transaccion(() => fn(nuevos)) } catch (err) { for (const ruta of nuevos) { try { unlinkSync(ruta) } catch { /* No exponer rutas privadas. */ } } throw err }
}
function tomar(usuario, ordenId) {
  return transaccion(() => {
    const { orden, tecnico } = autorizar(usuario, ordenId)
    abierta(orden)
    if (orden.tecnico_id === tecnico.id) {
      db.prepare('UPDATE ordenes_instalacion SET tomada_at=COALESCE(tomada_at,CURRENT_TIMESTAMP) WHERE id=?').run(orden.id)
      return detalle(ordenPorId(orden.id))
    }
    const resultado = db.prepare('UPDATE ordenes_instalacion SET tecnico_id=?, tomada_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tecnico_id IS NULL').run(tecnico.id, orden.id)
    if (resultado.changes !== 1) throw error(409, 'Otro técnico tomó esta orden')
    return detalle(ordenPorId(orden.id))
  })
}
function iniciar(usuario, ordenId, cuerpo) {
  return transaccion(() => {
    const { orden } = autorizar(usuario, ordenId, true); abierta(orden)
    if (orden.iniciada_at && orden.fecha_programada && !orden.postergada_at) return detalle(orden)
    const fecha = cuerpo.fecha_programada || orden.fecha_programada
    if (!fecha || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*Z$/.test(fecha) || !Number.isFinite(new Date(fecha).getTime())) throw error(400, 'Registra una fecha y hora programada válida antes de iniciar')
    db.prepare(`UPDATE ordenes_instalacion SET fecha_programada=?, iniciada_at=COALESCE(iniciada_at,CURRENT_TIMESTAMP), tomada_at=COALESCE(tomada_at,CURRENT_TIMESTAMP), postergada_at=NULL WHERE id=?`).run(new Date(fecha).toISOString(), orden.id)
    sincronizarEstado(orden.id); tocar(orden.id)
    return detalle(ordenPorId(orden.id))
  })
}
function guardarParte(usuario, ordenId, cuerpo) {
  return conArchivos(nuevos => {
    const { orden, tecnico } = autorizar(usuario, ordenId, true)
    operacion(orden, cuerpo, 'avance', () => {
      if (!orden.iniciada_at || !orden.fecha_programada || orden.postergada_at) throw error(409, 'Registra la fecha programada e inicia o reanuda la instalación antes de guardar avances')
      const parte = cuerpo.parte; validarActividad(orden, parte)
      if (parte > orden.parte_actual) throw error(409, 'Completa la parte anterior antes de continuar')
      if (cuerpo.revision_avance !== orden.revision_avance) throw error(409, 'El avance cambió; vuelve a abrir la orden antes de guardar')
      const definiciones = actividadesDe(orden).filter(a => a.parte === parte)
      if (!Array.isArray(cuerpo.actividades) || cuerpo.actividades.length !== definiciones.length || new Set(cuerpo.actividades.map(a => a.codigo)).size !== definiciones.length) throw error(400, 'Envía las actividades de la parte seleccionada sin duplicarlas')
      for (const a of cuerpo.actividades) {
        const definicion = definiciones.find(d => d.codigo === a.codigo)
        if (!definicion || typeof a.completado !== 'boolean') throw error(400, 'Actividad o estado inválido')
        const observaciones = texto(a.observaciones)
        const existente = db.prepare('SELECT id FROM checklist_evidencias WHERE orden_id=? AND actividad_codigo=?').get(orden.id, a.codigo)
        if (existente) db.prepare('UPDATE checklist_evidencias SET completado=?,observaciones=?,tecnico_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(Number(a.completado), observaciones, tecnico.id, existente.id)
        else db.prepare('INSERT INTO checklist_evidencias (orden_id,etapa,actividad_codigo,parte,tecnico_id,completado,observaciones) VALUES (?,?,?,?,?,?,?)').run(orden.id, definicion.etapa, a.codigo, parte, tecnico.id, Number(a.completado), observaciones)
      }
      guardarFotos(orden, tecnico, parte, cuerpo.fotos ?? [], nuevos)
      if (cuerpo.avanzar !== undefined && typeof cuerpo.avanzar !== 'boolean') throw error(400, 'Indicador de avance inválido')
      if (cuerpo.avanzar) {
        const etapa = avance(orden)[parte - 1]
        if (!etapa.completa) throw error(409, 'Completa las actividades y guarda al menos una foto de esta parte para avanzar')
        db.prepare('UPDATE ordenes_instalacion SET parte_actual=MAX(parte_actual,?) WHERE id=?').run(Math.min(3, parte + 1), orden.id)
      }
    })
    return detalle(ordenPorId(orden.id))
  })
}
function incidencia(usuario, ordenId, cuerpo) {
  return conArchivos(nuevos => {
    const { orden, tecnico } = autorizar(usuario, ordenId, true)
    operacion(orden, cuerpo, 'incidencia', () => {
      const parte = cuerpo.parte, actividad = texto(cuerpo.actividad_codigo, 80) || null
      validarActividad(orden, parte, actividad)
      const descripcion = texto(cuerpo.descripcion, 2000)
      if (descripcion.length < 5) throw error(400, 'Describe la incidencia con al menos cinco caracteres')
      const fecha = cuerpo.fecha_ocurrencia ? new Date(cuerpo.fecha_ocurrencia) : new Date()
      if (!Number.isFinite(fecha.getTime()) || fecha.getTime() > Date.now() + 60000) throw error(400, 'La fecha de incidencia no es válida o es futura')
      const incidenciaId = Number(db.prepare('INSERT INTO incidencias_instalacion (orden_id,tecnico_id,parte,actividad_codigo,descripcion,fecha_ocurrencia) VALUES (?,?,?,?,?,?)').run(orden.id, tecnico.id, parte, actividad, descripcion, fecha.toISOString()).lastInsertRowid)
      guardarFotos(orden, tecnico, parte, cuerpo.fotos ?? [], nuevos, incidenciaId)
      sincronizarEstado(orden.id)
    })
    return detalle(ordenPorId(orden.id))
  })
}
function resolver(usuario, ordenId, incidenciaId, cuerpo) {
  return transaccion(() => {
    const { orden, tecnico } = autorizar(usuario, ordenId, true); abierta(orden)
    const fila = db.prepare('SELECT * FROM incidencias_instalacion WHERE orden_id=? AND id=?').get(orden.id, id(incidenciaId))
    if (!fila) throw error(404, 'Incidencia no encontrada')
    if (fila.estado === 'resuelta') return detalle(orden)
    const resolucion = texto(cuerpo.resolucion, 1000)
    if (resolucion.length < 5) throw error(400, 'Describe cómo se resolvió la incidencia')
    db.prepare("UPDATE incidencias_instalacion SET estado='resuelta',resolucion=?,resuelta_por=?,resuelta_at=CURRENT_TIMESTAMP WHERE id=? AND estado='pendiente'").run(resolucion, tecnico.id, fila.id)
    sincronizarEstado(orden.id); tocar(orden.id)
    return detalle(ordenPorId(orden.id))
  })
}
function finalizar(usuario, ordenId) {
  return transaccion(() => {
    const { orden } = autorizar(usuario, ordenId, true)
    if (orden.estatus_obra === 'completada') return detalle(orden)
    if (!orden.fecha_programada) throw error(409, 'Falta la fecha programada. Regístrala en el formulario de esta orden antes de finalizar; tus avances y fotos se conservan')
    if (!orden.iniciada_at || orden.postergada_at) throw error(409, 'Debes iniciar o reanudar la orden antes de finalizar')
    if (pendientes(orden.id)) throw error(409, 'Resuelve todas las incidencias pendientes antes de finalizar')
    if (orden.estatus_obra === 'incidencia') throw error(409, 'La orden conserva una incidencia anterior que debe revisarse antes de finalizar')
    if (!avance(orden).every(e => e.completa)) throw error(409, 'Faltan actividades obligatorias o evidencia fotográfica de alguna de las tres partes')
    db.prepare("UPDATE ordenes_instalacion SET estatus_obra='completada',fecha_fin_real=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,revision_avance=revision_avance+1 WHERE id=? AND estatus_obra<>'completada'").run(orden.id)
    // La fecha real y la relación quedan listas para integración 7. No se generan campañas aquí.
    return detalle(ordenPorId(orden.id))
  })
}

export function registrarRutasInstalaciones(app, autenticar, permitirRoles) {
  const envolver = fn => (req, res, next) => { try { res.set('Cache-Control', 'private, no-store'); fn(req, res) } catch (err) { if (err.status) res.status(err.status).json({ error: err.message }); else next(err) } }
  const tecnico = [autenticar, permitirRoles('Técnico')]
  app.get('/api/portal/proyectos', autenticar, permitirRoles('Cliente'), envolver((req, res) => {
    const compras = db.prepare(`SELECT cv.id, u.nombre AS tecnico_nombre,
        oi.id AS orden_id FROM cotizaciones_versiones cv
      JOIN solicitudes_cotizacion s ON s.id=cv.solicitud_id
      JOIN prospectos p ON p.id=s.prospecto_id
      JOIN cuentas_cliente c ON c.prospecto_id=p.id
      JOIN ordenes_pago op ON op.cotizacion_id=cv.id AND op.estado='pagada'
      JOIN revisiones_tecnicas rt ON rt.id=cv.revision_id
      JOIN usuarios_personal u ON u.id=rt.tecnico_id
      LEFT JOIN ordenes_instalacion oi ON oi.cotizacion_id=cv.id
      WHERE c.id=? AND s.prospecto_id=? AND c.cliente_desde IS NOT NULL
        AND p.eliminado_at IS NULL AND s.eliminado_at IS NULL
      ORDER BY op.confirmada_at DESC,cv.id DESC`).all(req.usuario.cuenta_id, req.usuario.prospecto_id)
    res.json(compras.map(compra => {
      const orden = compra.orden_id ? ordenPorId(compra.orden_id) : null
      const etapas = orden ? avance(orden) : []
      const siguiente = orden ? db.prepare(`SELECT tipo_servicio,fecha_limite FROM mantenimientos_programados
        WHERE orden_id=? AND estatus IN ('pendiente','agendado') AND date(fecha_limite)>=date('now')
        ORDER BY fecha_limite,id LIMIT 1`).get(orden.id) : null
      return { cotizacion: resumenCompra(compra.id), tecnico_nombre: compra.tecnico_nombre,
        orden: orden ? { id: orden.id, folio: folio(orden).folio, fecha_programada: orden.fecha_programada,
          fecha_fin_real: orden.fecha_fin_real, proximo_mantenimiento: siguiente || null,
          seguimiento_anterior: orden.estatus_obra === 'completada' && !db.prepare('SELECT 1 FROM checklist_evidencias WHERE orden_id=? AND actividad_codigo IS NOT NULL').get(orden.id) } : null,
        progreso: progresoCliente(orden, etapas, orden ? pendientes(orden.id) : 0) }
    }))
  }))
  app.get('/api/tecnico/instalaciones', ...tecnico, envolver((req, res) => {
    const t = tecnicoActivo(req.usuario)
    const lista = db.prepare(`${select} AND d.estado_codigo=? AND rt.tecnico_id=?
      AND (oi.tecnico_id IS NULL OR oi.tecnico_id=?) ORDER BY oi.id DESC`).all(t.estado_trabajo_codigo, t.id, t.id)
    res.json(lista.map(o => ({ ...folio(o), estado_visible: estadoInstalacion(o, pendientes(o.id)), puede_editar: o.tecnico_id === t.id, disponible: o.tecnico_id === null })))
  }))
  app.get('/api/tecnico/instalaciones/:id', ...tecnico, envolver((req, res) => res.json(detalle(autorizar(req.usuario, req.params.id).orden))))
  app.post('/api/tecnico/instalaciones/:id/tomar', ...tecnico, envolver((req, res) => res.json(tomar(req.usuario, req.params.id))))
  app.post('/api/tecnico/instalaciones/:id/iniciar', ...tecnico, envolver((req, res) => res.json(iniciar(req.usuario, req.params.id, req.body ?? {}))))
  app.post('/api/tecnico/instalaciones/:id/avance', ...tecnico, envolver((req, res) => res.json(guardarParte(req.usuario, req.params.id, req.body ?? {}))))
  app.post('/api/tecnico/instalaciones/:id/incidencias', ...tecnico, envolver((req, res) => res.status(201).json(incidencia(req.usuario, req.params.id, req.body ?? {}))))
  app.post('/api/tecnico/instalaciones/:id/incidencias/:incidencia/resolver', ...tecnico, envolver((req, res) => res.json(resolver(req.usuario, req.params.id, req.params.incidencia, req.body ?? {}))))
  app.post('/api/tecnico/instalaciones/:id/finalizar', ...tecnico, envolver((req, res) => res.json(finalizar(req.usuario, req.params.id))))
  app.post('/api/tecnico/instalaciones/:id/postergar', ...tecnico, envolver((req, res) => res.json(transaccion(() => {
    const { orden } = autorizar(req.usuario, req.params.id, true); abierta(orden)
    const motivo = texto(req.body?.motivo, 500)
    if (motivo.length < 5) throw error(400, 'Indica el motivo de postergación')
    if (!orden.postergada_at) { db.prepare('UPDATE ordenes_instalacion SET postergada_at=CURRENT_TIMESTAMP,motivo_postergacion=? WHERE id=?').run(motivo, orden.id); tocar(orden.id) }
    return detalle(ordenPorId(orden.id))
  }))))
  app.get('/api/instalaciones/:id/fotos/:foto', autenticar, permitirRoles('Técnico', 'Administrador'), envolver((req, res) => {
    let orden
    if (req.usuario.rol === 'Técnico') {
      orden = autorizar(req.usuario, req.params.id, true).orden
    } else {
      if (!db.prepare("SELECT 1 FROM usuarios_personal WHERE id=? AND activo=1 AND rol='Administrador'").get(req.usuario.usuario_id)) throw error(403, 'Administrador activo requerido')
      orden = ordenPorId(req.params.id)
      if (!orden) throw error(404, 'Orden no encontrada')
    }
    const foto = db.prepare('SELECT archivo,mime FROM fotos_instalacion WHERE orden_id=? AND id=?').get(orden.id, id(req.params.foto))
    if (!foto || !/^[a-f0-9-]+\.(png|jpg)$/.test(foto.archivo) || !existsSync(join(carpeta, foto.archivo))) throw error(404, 'Fotografía no disponible')
    res.set({ 'Content-Type': foto.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="evidencia"' }).send(readFileSync(join(carpeta, foto.archivo)))
  }))
  app.get('/api/portal/instalaciones', autenticar, permitirRoles('Cliente'), envolver((req, res) => {
    const ordenes = db.prepare(`${select} AND c.id=? AND s.prospecto_id=? ORDER BY oi.id DESC`).all(req.usuario.cuenta_id, req.usuario.prospecto_id)
    res.json(ordenes.map(o => ({ id: o.id, folio: folio(o).folio, cotizacion_id: o.cotizacion_id, version: o.version, fecha_programada: o.fecha_programada,
      iniciada_at: o.iniciada_at, fecha_fin_real: o.fecha_fin_real, estado: estadoInstalacion(o, pendientes(o.id)), tecnico_nombre: o.tecnico_nombre,
      seguimiento_anterior: o.estatus_obra === 'completada' && !db.prepare('SELECT 1 FROM checklist_evidencias WHERE orden_id=? AND actividad_codigo IS NOT NULL').get(o.id),
      etapas: avance(o).map(({ parte, nombre, total, completadas, completa }) => ({ parte, nombre, total, completadas, completa })),
      incidencias_pendientes: pendientes(o.id), aviso: pendientes(o.id) || o.estatus_obra === 'incidencia' ? 'Hay una incidencia que puede afectar el avance de tu instalación.' : o.postergada_at ? 'La visita fue postergada; el técnico actualizará la programación.' : null })))
  }))
}

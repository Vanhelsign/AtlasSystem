import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import express from 'express'
import { db, getProspecto, prospectSelect } from './database.js'
import { ESTADOS_MEXICO, normalizarEstadoMexico } from '../shared/estadosMexico.js'

const app = express()
const port = Number(process.env.ATLAS_PORT || 3001)
const estados = new Set(['Nuevo', 'Contactado', 'En seguimiento', 'Cotizado', 'Cerrado ganado', 'Cerrado perdido'])
const ciudades = new Set(['Monterrey', 'Ciudad de México', 'Guadalajara', 'Tijuana', 'Mérida', 'Otra'])
const coberturas = new Set([25, 50, 75, 100])
const margenesCrecimiento = new Set([10, 20, 30, 40, 50])
const codigosEstado = new Set(ESTADOS_MEXICO.map((estado) => estado.codigo))
const tiposProducto = new Set(['Panel', 'Inversor', 'Estructura', 'Cableado', 'Mano de obra', 'Batería', 'Extra'])
const sesiones = new Map()

app.use(express.json({ limit: '100kb' }))

function textoOpcional(value, campo) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${campo} debe ser texto`)
  return value.trim() || null
}

function textoRequerido(value, campo) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${campo} es obligatorio`)
  return value.trim()
}

function numeroPositivo(value, campo) {
  const numero = Number(value)
  if (!Number.isFinite(numero) || numero <= 0) throw new Error(`${campo} debe ser un número mayor que cero`)
  return numero
}

function idValido(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function normalizarEmail(value) {
  const email = textoRequerido(value, 'correo electrónico').toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('correo electrónico no es válido')
  return email
}

function validarEstadoTrabajo(value) {
  if (typeof value !== 'string' || !codigosEstado.has(value)) throw new Error('Selecciona un estado de trabajo válido')
  return value
}

function validarRolPersonal(value) {
  if (typeof value !== 'string') throw new Error('Selecciona un tipo de usuario válido')
  const clave = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  if (clave === 'tecnico') return 'Técnico'
  if (clave === 'agente' || clave === 'agente de ventas') return 'Agente'
  throw new Error('Selecciona un tipo de usuario válido')
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') }
}

function passwordCoincide(password, hash, salt) {
  const esperado = Buffer.from(hash, 'hex')
  const recibido = scryptSync(password, salt, 64)
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido)
}

function asegurarCuentaPersonal({ nombre, email, telefono, rol }) {
  if (db.prepare('SELECT 1 FROM usuarios_personal WHERE email = ? COLLATE NOCASE').get(email)) return
  const credencial = hashPassword('123')
  db.prepare(`
    INSERT INTO usuarios_personal
      (nombre, email, telefono, password_hash, password_salt, rol, activo)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(nombre, email, telefono, credencial.hash, credencial.salt, rol)
}

for (const cuenta of [
  { nombre: 'Admin Master', email: 'admin@atlas.com', telefono: 'No registrado', rol: 'Administrador' },
  { nombre: 'Agente Ventas', email: 'ventas@atlas.com', telefono: 'No registrado', rol: 'Agente' },
  { nombre: 'Juan Técnico', email: 'tecnico@atlas.com', telefono: 'No registrado', rol: 'Técnico' },
]) asegurarCuentaPersonal(cuenta)

function iniciarSesion(cuenta) {
  const token = randomBytes(32).toString('hex')
  sesiones.set(token, cuenta)
  return token
}

function autenticar(request, response, next) {
  const authorization = request.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const sesion = sesiones.get(token)
  if (!sesion) return response.status(401).json({ error: 'Sesión requerida o vencida' })
  request.usuario = sesion
  next()
}

function permitirRoles(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.usuario.rol)) return response.status(403).json({ error: 'No tienes permiso para realizar esta acción' })
    next()
  }
}

const productoSelect = `
  SELECT id, codigo, tipo, modelo, marca, proveedor_id, costo_unitario,
         costo_unitario AS precio, clasificacion, existencias,
         potencia_w, potencia_kw, capacidad_kwh, activo, motivo_baja, created_at, updated_at
  FROM productos_catalogo
`

function getProducto(id) {
  return db.prepare(`${productoSelect} WHERE id = ?`).get(id)
}

function validarProducto(value, actual = {}) {
  const tipo = value.tipo === undefined ? actual.tipo : value.tipo
  if (!tiposProducto.has(tipo)) throw new Error('tipo de producto no válido')
  const modelo = value.modelo === undefined ? actual.modelo : textoRequerido(value.modelo, 'modelo')
  const clasificacion = value.clasificacion === undefined ? actual.clasificacion : value.clasificacion
  if (!['material', 'servicio'].includes(clasificacion)) throw new Error('clasificación no válida')
  if ((tipo === 'Mano de obra') !== (clasificacion === 'servicio')) {
    throw new Error('Mano de obra debe ser servicio y los demás tipos deben ser materiales')
  }

  const costoUnitario = Number(value.costo_unitario ?? value.precio ?? actual.costo_unitario)
  if (!Number.isFinite(costoUnitario) || costoUnitario < 0) throw new Error('costo unitario debe ser un número no negativo')

  let existencias = null
  if (clasificacion === 'material') {
    existencias = Number(value.existencias ?? actual.existencias)
    if (!Number.isInteger(existencias) || existencias < 0) throw new Error('existencias debe ser un entero no negativo para materiales')
  }

  const potenciaWValor = value.potencia_w === undefined ? actual.potencia_w : value.potencia_w
  const potenciaKwValor = value.potencia_kw === undefined ? actual.potencia_kw : value.potencia_kw
  const potenciaW = potenciaWValor === '' || potenciaWValor == null ? null : Number(potenciaWValor)
  const potenciaKw = potenciaKwValor === '' || potenciaKwValor == null ? null : Number(potenciaKwValor)
  if (potenciaW !== null && (!Number.isFinite(potenciaW) || potenciaW <= 0)) throw new Error('potencia en W debe ser mayor que cero')
  if (potenciaKw !== null && (!Number.isFinite(potenciaKw) || potenciaKw <= 0)) throw new Error('potencia en kW debe ser mayor que cero')
  if (tipo === 'Panel' && potenciaW === null) throw new Error('la potencia en W es obligatoria para paneles')
  if (tipo === 'Inversor' && potenciaKw === null) throw new Error('la potencia en kW es obligatoria para inversores')

  const capacidadValor = value.capacidad_kwh === undefined ? actual.capacidad_kwh : value.capacidad_kwh
  const capacidadKwh = capacidadValor === '' || capacidadValor == null ? null : Number(capacidadValor)
  if (capacidadKwh !== null && (!Number.isFinite(capacidadKwh) || capacidadKwh <= 0)) throw new Error('capacidad en kWh debe ser mayor que cero')
  if (tipo === 'Batería' && capacidadKwh === null) throw new Error('la capacidad en kWh es obligatoria para baterías')

  const marca = value.marca === undefined ? actual.marca ?? null : textoOpcional(value.marca, 'marca')
  const proveedorValor = value.proveedor_id === undefined ? actual.proveedor_id : value.proveedor_id
  let proveedorId = null
  if (proveedorValor !== '' && proveedorValor != null) {
    proveedorId = idValido(proveedorValor)
    if (!proveedorId || !getProveedor(proveedorId)) throw new Error('proveedor no válido')
  }

  return { tipo, modelo, marca, proveedorId, costoUnitario, clasificacion, existencias, potenciaW, potenciaKw, capacidadKwh }
}

function getProveedor(id) {
  return db.prepare(`
    SELECT id, nombre, activo, created_at, updated_at
    FROM proveedores WHERE id = ?
  `).get(id)
}

function validarConsumo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Los datos de consumo son obligatorios')
  const consumoKwh = numeroPositivo(value.consumo_kwh, 'consumo_kwh')
  const eficiencia = Number(value.perdidas ?? 80)
  const ciudad = value.ciudad ?? 'Monterrey'
  if (!Number.isInteger(eficiencia) || eficiencia < 1 || eficiencia > 100) throw new Error('perdidas debe ser un entero entre 1 y 100')
  if (typeof ciudad !== 'string' || !ciudades.has(ciudad)) throw new Error('ciudad no es válida')
  return { consumoKwh, ciudad, eficiencia }
}

function calcularHistorial(registros) {
  if (!Array.isArray(registros) || registros.length !== 1) throw new Error('Captura un solo recibo de CFE')
  const registro = registros[0]
  const consumoKwh = numeroPositivo(registro.consumo_kwh, 'consumo del recibo')
  if (!['mensual', 'bimestral'].includes(registro.periodo)) throw new Error('El periodo debe ser mensual o bimestral')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(registro.mes_inicio ?? '')) throw new Error('Selecciona el mes y año del recibo')
  const mesesPeriodo = registro.periodo === 'bimestral' ? 2 : 1
  const consumoMensual = consumoKwh / mesesPeriodo
  const [year, month] = registro.mes_inicio.split('-').map(Number)
  const fechaFin = new Date(Date.UTC(year, month - 1 + mesesPeriodo - 1, 1))
  const mesFin = `${fechaFin.getUTCFullYear()}-${String(fechaFin.getUTCMonth() + 1).padStart(2, '0')}`
  return {
    filas: [{ consumoKwh, periodo: registro.periodo, mesInicio: registro.mes_inicio, mesFin, diasPeriodo: mesesPeriodo * 30 }],
    consumoIntroducido: consumoKwh,
    consumoMensual,
    consumoDiario: consumoMensual / 30,
  }
}

function validarDireccion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La dirección del cliente es obligatoria')
  const direccion = {
    estado: textoRequerido(value.estado, 'estado de la dirección'),
    municipio: textoRequerido(value.municipio, 'ciudad o municipio'),
    colonia: textoRequerido(value.colonia, 'colonia'),
    codigoPostal: textoRequerido(value.codigo_postal, 'código postal'),
    calle: textoRequerido(value.calle, 'calle'),
    numeroExterior: textoRequerido(value.numero_exterior, 'número exterior'),
    numeroInterior: textoOpcional(value.numero_interior, 'número interior'),
  }
  if (!/^\d{5}$/.test(direccion.codigoPostal)) throw new Error('código postal debe contener 5 dígitos')
  const estadoCodigo = normalizarEstadoMexico(direccion.estado)
  const ciudadCalculo = [...ciudades].find((ciudad) => ciudad.toLocaleLowerCase('es-MX') === direccion.municipio.toLocaleLowerCase('es-MX')) ?? 'Otra'
  return { ...direccion, estadoCodigo, ciudadCalculo }
}

function calcularElectrodomesticos(equipos) {
  if (!Array.isArray(equipos) || equipos.length === 0) throw new Error('Agrega al menos un electrodoméstico')
  let consumoDia = 0
  let consumoNoche = 0
  let potenciaConectada = 0

  const filas = equipos.map((equipo) => {
    const tipo = textoRequerido(equipo.tipo, 'tipo de aparato')
    const potenciaW = numeroPositivo(equipo.potencia_w, 'potencia')
    const cantidad = Number(equipo.cantidad)
    if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error('cantidad debe ser un entero mayor que cero')
    if (!['dia', 'noche', 'ambos'].includes(equipo.horario)) throw new Error('horario no es válido')

    const horasDia = equipo.horario === 'noche' ? 0 : Number(equipo.horas_dia)
    const horasNoche = equipo.horario === 'dia' ? 0 : Number(equipo.horas_noche)
    if (!Number.isFinite(horasDia) || !Number.isFinite(horasNoche) || horasDia < 0 || horasNoche < 0 || horasDia + horasNoche <= 0 || horasDia + horasNoche > 24) {
      throw new Error(`Las horas de ${tipo} deben sumar entre 0 y 24`)
    }

    const consumoDiaKwh = potenciaW * cantidad * horasDia / 1000
    const consumoNocheKwh = potenciaW * cantidad * horasNoche / 1000
    consumoDia += consumoDiaKwh
    consumoNoche += consumoNocheKwh
    potenciaConectada += potenciaW * cantidad
    return {
      tipo,
      potenciaW,
      cantidad,
      horario: equipo.horario,
      horasDia,
      horasNoche,
      consumoDiaKwh,
      consumoNocheKwh,
      consumoTotalKwh: consumoDiaKwh + consumoNocheKwh,
    }
  })

  return { filas, consumoDia, consumoNoche, consumoDiario: consumoDia + consumoNoche, potenciaConectada }
}

function validarConfiguracion(configuracion, modalidad, consumoDiario, consumoNocturnoCalculado, ciudad) {
  if (!configuracion || typeof configuracion !== 'object') throw new Error('La configuración es obligatoria')
  const eficiencia = Number(configuracion.eficiencia_pct ?? 80)
  if (!Number.isInteger(eficiencia) || eficiencia < 1 || eficiencia > 100) throw new Error('eficiencia_pct debe estar entre 1 y 100')
  const margenCrecimiento = Number(configuracion.margen_crecimiento_pct)
  if (!margenesCrecimiento.has(margenCrecimiento)) throw new Error('Selecciona un margen de crecimiento válido')
  if (typeof configuracion.cubrir_baterias !== 'boolean') throw new Error('Indica si desea cubrir consumo nocturno con baterías')

  const cubrirBaterias = configuracion.cubrir_baterias
  let coberturaNocturna = null
  let estimacionNocturna = null
  let consumoNocturno = consumoNocturnoCalculado
  let consumoDiurno = modalidad === 'electrodomesticos' ? consumoDiario - consumoNocturnoCalculado : null
  let necesidadBateria = null
  let incluirInterconexion = false

  if (cubrirBaterias) {
    coberturaNocturna = Number(configuracion.cobertura_nocturna_pct)
    if (!coberturas.has(coberturaNocturna)) throw new Error('Selecciona un porcentaje válido de cobertura con baterías')
    if (modalidad === 'historial_cfe') {
      estimacionNocturna = Number(configuracion.estimacion_consumo_nocturno_pct)
      if (!Number.isFinite(estimacionNocturna) || estimacionNocturna <= 0 || estimacionNocturna > 100) {
        throw new Error('Estima qué porcentaje del consumo total ocurre de noche')
      }
      consumoNocturno = consumoDiario * estimacionNocturna / 100
      consumoDiurno = consumoDiario - consumoNocturno
    }
    necesidadBateria = consumoNocturno * coberturaNocturna / 100
  } else {
    incluirInterconexion = Boolean(configuracion.incluir_interconexion)
  }

  return {
    ciudad,
    eficiencia,
    margenCrecimiento,
    cubrirBaterias,
    coberturaNocturna,
    estimacionNocturna,
    consumoDiurno,
    consumoNocturno,
    necesidadBateria,
    incluirInterconexion,
  }
}

function getSolicitud(id) {
  const solicitud = db.prepare('SELECT * FROM solicitudes_cotizacion WHERE id = ?').get(id)
  if (!solicitud) return null
  const revisionTecnica = db.prepare(`
    SELECT rt.*, u.nombre AS tecnico_nombre
    FROM revisiones_tecnicas rt
    JOIN usuarios_personal u ON u.id = rt.tecnico_id
    WHERE rt.solicitud_id = ?
  `).get(id)
  const cotizacion = db.prepare(`
    SELECT cv.*, u.nombre AS agente_nombre
    FROM cotizaciones_versiones cv
    JOIN usuarios_personal u ON u.id = cv.agente_id
    WHERE cv.solicitud_id = ?
    ORDER BY cv.version DESC LIMIT 1
  `).get(id)
  return {
    ...solicitud,
    historial_cfe: db.prepare('SELECT * FROM historial_cfe WHERE solicitud_id = ? ORDER BY id').all(id),
    electrodomesticos: db.prepare('SELECT * FROM electrodomesticos_solicitud WHERE solicitud_id = ? ORDER BY id').all(id),
    revision_tecnica: revisionTecnica ? {
      ...revisionTecnica,
      items: db.prepare('SELECT * FROM revision_tecnica_items WHERE revision_id = ? ORDER BY id').all(revisionTecnica.id),
      devoluciones: db.prepare(`
        SELECT d.*, u.nombre AS agente_nombre
        FROM revision_tecnica_devoluciones d
        JOIN usuarios_personal u ON u.id = d.agente_id
        WHERE d.revision_id = ? ORDER BY d.id
      `).all(revisionTecnica.id),
    } : null,
    cotizacion: cotizacion ? {
      ...cotizacion,
      items: db.prepare('SELECT * FROM cotizacion_version_items WHERE cotizacion_id = ? ORDER BY id').all(cotizacion.id),
    } : null,
  }
}

function getCotizacionPublica(solicitudId) {
  const cotizacion = db.prepare(`
    SELECT id, version, precio_venta, emitida_at
    FROM cotizaciones_versiones
    WHERE solicitud_id = ? AND estado = 'enviada'
    ORDER BY version DESC LIMIT 1
  `).get(solicitudId)
  if (!cotizacion) return null
  return {
    estado: 'Tu cotización está lista',
    version: cotizacion.version,
    precio_venta: cotizacion.precio_venta,
    emitida_at: cotizacion.emitida_at,
    items: db.prepare(`
      SELECT tipo, modelo, clasificacion, cantidad
      FROM cotizacion_version_items
      WHERE cotizacion_id = ? ORDER BY id
    `).all(cotizacion.id),
  }
}

function getTecnicoAutorizado(request) {
  const tecnico = db.prepare(`
    SELECT id, nombre, email, estado_trabajo_codigo
    FROM usuarios_personal
    WHERE id = ? AND rol = 'Técnico' AND activo = 1
  `).get(request.usuario.usuario_id)
  if (!tecnico || !codigosEstado.has(tecnico.estado_trabajo_codigo)) return null
  return tecnico
}

const solicitudTecnicaSelect = `
  SELECT s.*, p.nombre AS prospecto_nombre,
         d.estado AS direccion_estado, d.estado_codigo AS direccion_estado_codigo,
         d.municipio AS direccion_municipio, d.colonia AS direccion_colonia,
         d.codigo_postal AS direccion_codigo_postal, d.calle AS direccion_calle,
         d.numero_exterior AS direccion_numero_exterior,
         d.numero_interior AS direccion_numero_interior,
         rt.id AS revision_tecnica_id, rt.estado AS revision_tecnica_estado,
         rt.tecnico_id AS tecnico_responsable_id, rt.tomada_at AS revision_tomada_at,
         rt.completada_at AS revision_completada_at,
         ut.nombre AS tecnico_responsable,
         (SELECT motivo FROM revision_tecnica_devoluciones
          WHERE revision_id = rt.id AND atendida_at IS NULL
          ORDER BY id DESC LIMIT 1) AS correccion_motivo,
         (SELECT devuelta_at FROM revision_tecnica_devoluciones
          WHERE revision_id = rt.id AND atendida_at IS NULL
          ORDER BY id DESC LIMIT 1) AS correccion_devuelta_at
  FROM solicitudes_cotizacion s
  JOIN prospectos p ON p.id = s.prospecto_id
  JOIN direcciones_cliente d ON d.prospecto_id = s.prospecto_id
  LEFT JOIN revisiones_tecnicas rt ON rt.solicitud_id = s.id
  LEFT JOIN usuarios_personal ut ON ut.id = rt.tecnico_id
`

function getSolicitudTecnica(id, tecnico) {
  const solicitud = db.prepare(`${solicitudTecnicaSelect}
    WHERE s.id = ? AND d.estado_codigo = ?
      AND (s.estado_flujo = 'pendiente_revision_tecnica'
           OR (s.estado_flujo = 'en_preparacion' AND rt.id IS NOT NULL))
  `).get(id, tecnico.estado_trabajo_codigo)
  if (!solicitud) return null
  const revisionItems = solicitud.revision_tecnica_id ? db.prepare(`
    SELECT ri.*, pc.existencias AS catalogo_existencias, pc.activo AS catalogo_activo
    FROM revision_tecnica_items ri
    JOIN productos_catalogo pc ON pc.id = ri.producto_id
    WHERE ri.revision_id = ?
    ORDER BY ri.id
  `).all(solicitud.revision_tecnica_id) : []
  return {
    ...solicitud,
    historial_cfe: db.prepare('SELECT * FROM historial_cfe WHERE solicitud_id = ? ORDER BY id').all(id),
    electrodomesticos: db.prepare('SELECT * FROM electrodomesticos_solicitud WHERE solicitud_id = ? ORDER BY id').all(id),
    revision_items: revisionItems,
  }
}

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))

app.post('/api/login', (request, response) => {
  try {
    const email = normalizarEmail(request.body.email)
    const password = textoRequerido(request.body.password, 'contraseña')
    const personal = db.prepare(`
      SELECT id AS usuario_id, nombre, email, telefono, zona_trabajo, estado_trabajo_codigo,
             password_hash, password_salt, rol, activo
      FROM usuarios_personal
      WHERE email = ? COLLATE NOCASE
    `).get(email)
    if (personal) {
      if (!personal.activo) return response.status(403).json({ error: 'La cuenta está inactiva' })
      if (!passwordCoincide(password, personal.password_hash, personal.password_salt)) {
        return response.status(401).json({ error: 'Credenciales incorrectas' })
      }
      const sesion = {
        usuario_id: personal.usuario_id,
        email: personal.email,
        nombre: personal.nombre,
        rol: personal.rol,
        estado_trabajo_codigo: personal.estado_trabajo_codigo,
      }
      return response.json({ ...sesion, token: iniciarSesion(sesion) })
    }

    const cuenta = db.prepare(`
      SELECT c.email, c.password_hash, c.password_salt, c.rol,
             p.id AS prospecto_id, p.nombre
      FROM cuentas_cliente c
      JOIN prospectos p ON p.id = c.prospecto_id
      WHERE c.email = ? COLLATE NOCASE
    `).get(email)
    if (!cuenta || !passwordCoincide(password, cuenta.password_hash, cuenta.password_salt)) {
      return response.status(401).json({ error: 'Credenciales incorrectas' })
    }
    const sesion = {
      email: cuenta.email,
      nombre: cuenta.nombre,
      rol: cuenta.rol,
      prospecto_id: cuenta.prospecto_id,
    }
    response.json({ ...sesion, token: iniciarSesion(sesion) })
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.post('/api/logout', autenticar, (request, response) => {
  const token = request.get('authorization').slice(7)
  sesiones.delete(token)
  response.status(204).end()
})

app.get('/api/productos', autenticar, permitirRoles('Administrador', 'Agente', 'Técnico'), (request, response) => {
  const condicion = request.usuario.rol === 'Administrador' ? '' : ' WHERE activo = 1'
  response.json(db.prepare(`${productoSelect}${condicion} ORDER BY id`).all())
})

app.post('/api/productos', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const producto = validarProducto(request.body)
    const codigo = `PROD-${randomBytes(5).toString('hex').toUpperCase()}`
    const id = Number(db.prepare(`
      INSERT INTO productos_catalogo (
        codigo, tipo, modelo, marca, proveedor_id, costo_unitario, clasificacion,
        existencias, potencia_w, potencia_kw, capacidad_kwh, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      codigo, producto.tipo, producto.modelo, producto.marca, producto.proveedorId, producto.costoUnitario,
      producto.clasificacion, producto.existencias, producto.potenciaW, producto.potenciaKw, producto.capacidadKwh,
    ).lastInsertRowid)
    response.status(201).json(getProducto(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.patch('/api/productos/:id', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    const actual = getProducto(id)
    if (!actual) return response.status(404).json({ error: 'Producto no encontrado' })
    const producto = validarProducto(request.body, actual)
    db.prepare(`
      UPDATE productos_catalogo
      SET tipo = ?, modelo = ?, marca = ?, proveedor_id = ?, costo_unitario = ?, clasificacion = ?, existencias = ?,
          potencia_w = ?, potencia_kw = ?, capacidad_kwh = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      producto.tipo, producto.modelo, producto.marca, producto.proveedorId, producto.costoUnitario, producto.clasificacion,
      producto.existencias, producto.potenciaW, producto.potenciaKw, producto.capacidadKwh, id,
    )
    response.json(getProducto(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.patch('/api/productos/:id/activo', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    if (typeof request.body.activo !== 'boolean') return response.status(400).json({ error: 'activo debe ser verdadero o falso' })
    if (!getProducto(id)) return response.status(404).json({ error: 'Producto no encontrado' })
    const motivo = request.body.activo ? null : textoRequerido(request.body.motivo, 'motivo de baja')
    db.prepare(`
      UPDATE productos_catalogo
      SET activo = ?, motivo_baja = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(request.body.activo ? 1 : 0, motivo, id)
    response.json(getProducto(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.get('/api/proveedores', autenticar, permitirRoles('Administrador', 'Agente', 'Técnico'), (request, response) => {
  const condicion = request.usuario.rol === 'Administrador' ? '' : ' WHERE activo = 1'
  response.json(db.prepare(`
    SELECT id, nombre, activo, created_at, updated_at
    FROM proveedores${condicion}
    ORDER BY nombre COLLATE NOCASE
  `).all())
})

app.post('/api/proveedores', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const nombre = textoRequerido(request.body.nombre, 'nombre del proveedor')
    const existente = db.prepare('SELECT id FROM proveedores WHERE nombre = ? COLLATE NOCASE').get(nombre)
    if (existente) return response.status(409).json({ error: 'El proveedor ya está registrado' })
    const id = Number(db.prepare('INSERT INTO proveedores (nombre, activo) VALUES (?, 1)').run(nombre).lastInsertRowid)
    response.status(201).json(getProveedor(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.patch('/api/proveedores/:id', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    if (!getProveedor(id)) return response.status(404).json({ error: 'Proveedor no encontrado' })
    const nombre = textoRequerido(request.body.nombre, 'nombre del proveedor')
    const duplicado = db.prepare('SELECT id FROM proveedores WHERE nombre = ? COLLATE NOCASE AND id <> ?').get(nombre, id)
    if (duplicado) return response.status(409).json({ error: 'El proveedor ya está registrado' })
    db.prepare('UPDATE proveedores SET nombre = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nombre, id)
    response.json(getProveedor(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.patch('/api/proveedores/:id/activo', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    if (typeof request.body.activo !== 'boolean') return response.status(400).json({ error: 'activo debe ser verdadero o falso' })
    if (!getProveedor(id)) return response.status(404).json({ error: 'Proveedor no encontrado' })
    db.prepare('UPDATE proveedores SET activo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(request.body.activo ? 1 : 0, id)
    response.json(getProveedor(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.get('/api/tecnico/solicitudes', autenticar, permitirRoles('Técnico'), (request, response) => {
  const tecnico = getTecnicoAutorizado(request)
  if (!tecnico) return response.status(403).json({ error: 'El técnico debe estar activo y tener un estado de trabajo válido' })
  const solicitudes = db.prepare(`${solicitudTecnicaSelect}
    WHERE d.estado_codigo = ?
      AND (s.estado_flujo = 'pendiente_revision_tecnica'
           OR (s.estado_flujo = 'en_preparacion' AND rt.id IS NOT NULL))
    ORDER BY CASE WHEN rt.id IS NULL THEN 0 ELSE 1 END, s.created_at DESC
  `).all(tecnico.estado_trabajo_codigo)
  response.json({ tecnico, solicitudes })
})

app.get('/api/tecnico/solicitudes/:id', autenticar, permitirRoles('Técnico'), (request, response) => {
  const tecnico = getTecnicoAutorizado(request)
  if (!tecnico) return response.status(403).json({ error: 'El técnico debe estar activo y tener un estado de trabajo válido' })
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const solicitud = getSolicitudTecnica(id, tecnico)
  if (!solicitud) return response.status(404).json({ error: 'Solicitud no disponible para tu estado de trabajo' })
  response.json(solicitud)
})

app.post('/api/tecnico/solicitudes/:id/tomar', autenticar, permitirRoles('Técnico'), (request, response) => {
  const tecnico = getTecnicoAutorizado(request)
  if (!tecnico) return response.status(403).json({ error: 'El técnico debe estar activo y tener un estado de trabajo válido' })
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const elegible = db.prepare(`
        SELECT s.id
        FROM solicitudes_cotizacion s
        JOIN direcciones_cliente d ON d.prospecto_id = s.prospecto_id
        WHERE s.id = ? AND s.estado_flujo = 'pendiente_revision_tecnica'
          AND d.estado_codigo = ?
      `).get(id, tecnico.estado_trabajo_codigo)
      if (!elegible) throw new Error('Solicitud no disponible para tu estado de trabajo')
      const resultado = db.prepare(`
        INSERT OR IGNORE INTO revisiones_tecnicas (solicitud_id, tecnico_id, estado)
        VALUES (?, ?, 'en_revision')
      `).run(id, tecnico.id)
      if (resultado.changes !== 1) throw new Error('La solicitud ya fue tomada por otro técnico')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    response.status(201).json(getSolicitudTecnica(id, tecnico))
  } catch (error) {
    const conflicto = error.message.includes('ya fue tomada')
    response.status(conflicto ? 409 : 404).json({ error: error.message })
  }
})

app.put('/api/tecnico/solicitudes/:id/borrador', autenticar, permitirRoles('Técnico'), (request, response) => {
  const tecnico = getTecnicoAutorizado(request)
  if (!tecnico) return response.status(403).json({ error: 'El técnico debe estar activo y tener un estado de trabajo válido' })
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const solicitud = getSolicitudTecnica(id, tecnico)
  if (!solicitud) return response.status(404).json({ error: 'Solicitud no disponible para tu estado de trabajo' })
  if (solicitud.tecnico_responsable_id !== tecnico.id) return response.status(403).json({ error: 'Solo el técnico responsable puede editar esta revisión' })
  if (solicitud.revision_tecnica_estado !== 'en_revision') return response.status(409).json({ error: 'La revisión completada ya no se puede editar' })
  if (!Array.isArray(request.body.items)) return response.status(400).json({ error: 'Los renglones de la propuesta deben ser una lista' })

  try {
    const ids = new Set()
    const existentes = new Map(db.prepare('SELECT * FROM revision_tecnica_items WHERE revision_id = ?').all(solicitud.revision_tecnica_id).map((item) => [item.producto_id, item]))
    const items = request.body.items.map((item) => {
      const productoId = idValido(item.producto_id)
      const cantidad = Number(item.cantidad)
      if (!productoId) throw new Error('Producto inválido')
      if (ids.has(productoId)) throw new Error('No se permite repetir un producto')
      ids.add(productoId)
      if (!Number.isInteger(cantidad) || cantidad < 1) throw new Error('La cantidad debe ser un entero positivo')

      const anterior = existentes.get(productoId)
      if (anterior) return { ...anterior, cantidad, subtotal: Math.round(anterior.costo_unitario_aplicado * cantidad * 100) / 100 }
      const producto = db.prepare(`${productoSelect} WHERE id = ? AND activo = 1`).get(productoId)
      if (!producto) throw new Error('El producto seleccionado no existe o ya no está activo')
      return {
        producto_id: producto.id,
        producto_codigo: producto.codigo,
        tipo_aplicado: producto.tipo,
        modelo_aplicado: producto.modelo,
        clasificacion_aplicada: producto.clasificacion,
        costo_unitario_aplicado: producto.costo_unitario,
        cantidad,
        subtotal: Math.round(producto.costo_unitario * cantidad * 100) / 100,
      }
    })

    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM revision_tecnica_items WHERE revision_id = ?').run(solicitud.revision_tecnica_id)
      const insertar = db.prepare(`
        INSERT INTO revision_tecnica_items (
          revision_id, producto_id, producto_codigo, tipo_aplicado, modelo_aplicado,
          clasificacion_aplicada, costo_unitario_aplicado, cantidad, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of items) insertar.run(
        solicitud.revision_tecnica_id, item.producto_id, item.producto_codigo,
        item.tipo_aplicado, item.modelo_aplicado, item.clasificacion_aplicada,
        item.costo_unitario_aplicado, item.cantidad, item.subtotal,
      )
      db.prepare('UPDATE revisiones_tecnicas SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(solicitud.revision_tecnica_id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    response.json(getSolicitudTecnica(id, tecnico))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.post('/api/tecnico/solicitudes/:id/completar', autenticar, permitirRoles('Técnico'), (request, response) => {
  const tecnico = getTecnicoAutorizado(request)
  if (!tecnico) return response.status(403).json({ error: 'El técnico debe estar activo y tener un estado de trabajo válido' })
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const solicitud = getSolicitudTecnica(id, tecnico)
  if (!solicitud) return response.status(404).json({ error: 'Solicitud no disponible para tu estado de trabajo' })
  if (solicitud.tecnico_responsable_id !== tecnico.id) return response.status(403).json({ error: 'Solo el técnico responsable puede completar esta revisión' })
  if (solicitud.revision_tecnica_estado !== 'en_revision') return response.status(409).json({ error: 'La revisión técnica ya fue completada' })
  if (solicitud.revision_items.length === 0) return response.status(400).json({ error: 'Agrega al menos un material o servicio antes de completar' })

  db.exec('BEGIN')
  try {
    const actualizado = db.prepare(`
      UPDATE revisiones_tecnicas
      SET estado = 'completada', completada_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND tecnico_id = ? AND estado = 'en_revision'
    `).run(solicitud.revision_tecnica_id, tecnico.id)
    if (actualizado.changes !== 1) throw new Error('La revisión técnica ya no se puede completar')
    db.prepare(`
      UPDATE revision_tecnica_devoluciones
      SET atendida_at = CURRENT_TIMESTAMP
      WHERE revision_id = ? AND atendida_at IS NULL
    `).run(solicitud.revision_tecnica_id)
    db.prepare(`
      UPDATE solicitudes_cotizacion SET estado_flujo = 'en_preparacion'
      WHERE id = ? AND estado_flujo = 'pendiente_revision_tecnica'
    `).run(id)
    db.exec('COMMIT')
    response.json(getSolicitudTecnica(id, tecnico))
  } catch (error) {
    db.exec('ROLLBACK')
    response.status(409).json({ error: error.message })
  }
})

app.get('/api/personal', autenticar, permitirRoles('Administrador'), (_request, response) => {
  response.json(db.prepare(`
    SELECT id, nombre, email, telefono, zona_trabajo, estado_trabajo_codigo,
           rol, activo, created_at, updated_at
    FROM usuarios_personal
    WHERE rol IN ('Técnico', 'Agente')
    ORDER BY id DESC
  `).all())
})

app.post('/api/personal', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const nombre = textoRequerido(request.body.nombre, 'nombre completo')
    const email = normalizarEmail(request.body.email)
    const telefono = textoRequerido(request.body.telefono, 'teléfono')
    const rol = validarRolPersonal(request.body.rol)
    const estadoTrabajoCodigo = validarEstadoTrabajo(request.body.estado_trabajo_codigo)
    const correoOcupado = db.prepare(`
      SELECT email FROM usuarios_personal WHERE email = ? COLLATE NOCASE
      UNION ALL
      SELECT email FROM cuentas_cliente WHERE email = ? COLLATE NOCASE
      UNION ALL
      SELECT email FROM prospectos WHERE email = ? COLLATE NOCASE
      LIMIT 1
    `).get(email, email, email)
    if (correoOcupado) return response.status(409).json({ error: 'El correo electrónico ya está registrado' })

    const credencial = hashPassword('123')
    const id = Number(db.prepare(`
      INSERT INTO usuarios_personal
        (nombre, email, telefono, estado_trabajo_codigo, password_hash, password_salt, rol, activo)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(nombre, email, telefono, estadoTrabajoCodigo, credencial.hash, credencial.salt, rol).lastInsertRowid)
    const persona = db.prepare(`
      SELECT id, nombre, email, telefono, zona_trabajo, estado_trabajo_codigo,
             rol, activo, created_at, updated_at
      FROM usuarios_personal WHERE id = ?
    `).get(id)
    response.status(201).json(persona)
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.patch('/api/personal/:id/activo', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    if (typeof request.body.activo !== 'boolean') return response.status(400).json({ error: 'activo debe ser verdadero o falso' })
    const persona = db.prepare("SELECT id FROM usuarios_personal WHERE id = ? AND rol IN ('Técnico', 'Agente')").get(id)
    if (!persona) return response.status(404).json({ error: 'Cuenta de personal no encontrada' })
    db.prepare('UPDATE usuarios_personal SET activo = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(request.body.activo ? 1 : 0, id)
    if (!request.body.activo) {
      for (const [token, sesion] of sesiones) {
        if (sesion.usuario_id === id) sesiones.delete(token)
      }
    }
    response.json(db.prepare(`
      SELECT id, nombre, email, telefono, zona_trabajo, estado_trabajo_codigo,
             rol, activo, created_at, updated_at
      FROM usuarios_personal WHERE id = ?
    `).get(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.patch('/api/personal/:id/estado-trabajo', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    const estadoTrabajoCodigo = validarEstadoTrabajo(request.body.estado_trabajo_codigo)
    const persona = db.prepare("SELECT id FROM usuarios_personal WHERE id = ? AND rol IN ('Técnico', 'Agente')").get(id)
    if (!persona) return response.status(404).json({ error: 'Cuenta de personal no encontrada' })
    db.prepare(`
      UPDATE usuarios_personal
      SET estado_trabajo_codigo = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(estadoTrabajoCodigo, id)
    response.json(db.prepare(`
      SELECT id, nombre, email, telefono, zona_trabajo, estado_trabajo_codigo,
             rol, activo, created_at, updated_at
      FROM usuarios_personal WHERE id = ?
    `).get(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.get('/api/prospectos', autenticar, permitirRoles('Administrador', 'Agente'), (request, response) => {
  const filtro = request.usuario.rol === 'Agente' ? ' WHERE s.agente_responsable_id = ?' : ''
  const parametros = request.usuario.rol === 'Agente' ? [request.usuario.usuario_id] : []
  response.json(db.prepare(`${prospectSelect}${filtro} ORDER BY p.id DESC`).all(...parametros))
})

app.get('/api/prospectos/:id', autenticar, permitirRoles('Administrador', 'Agente'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const prospecto = getProspecto(id)
  if (!prospecto) return response.status(404).json({ error: 'Registro no encontrado' })
  if (request.usuario.rol === 'Agente' && prospecto.agente_responsable_id !== request.usuario.usuario_id) {
    return response.status(404).json({ error: 'Registro no encontrado' })
  }
  response.json(prospecto)
})

app.get('/api/portal/prospectos/:id', autenticar, permitirRoles('Cliente'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  if (request.usuario.prospecto_id !== id) return response.status(403).json({ error: 'No tienes permiso para consultar este registro' })

  const prospecto = getProspecto(id)
  if (!prospecto) return response.status(404).json({ error: 'Registro no encontrado' })

  const solicitudCompleta = prospecto.solicitud_id ? getSolicitud(prospecto.solicitud_id) : null
  const solicitud = solicitudCompleta ? { ...solicitudCompleta, revision_tecnica: undefined, cotizacion: undefined } : null
  const prospectoPublico = {
    id: prospecto.id,
    nombre: prospecto.nombre,
    email: prospecto.email,
    telefono: prospecto.telefono,
    direccion_estado: prospecto.direccion_estado,
    direccion_municipio: prospecto.direccion_municipio,
    direccion_colonia: prospecto.direccion_colonia,
    direccion_codigo_postal: prospecto.direccion_codigo_postal,
    direccion_calle: prospecto.direccion_calle,
    direccion_numero_exterior: prospecto.direccion_numero_exterior,
    direccion_numero_interior: prospecto.direccion_numero_interior,
  }
  response.json({
    prospecto: prospectoPublico,
    solicitud,
    cotizacion_emitida: prospecto.solicitud_id ? getCotizacionPublica(prospecto.solicitud_id) : null,
  })
})

app.get('/api/solicitudes/:id', autenticar, permitirRoles('Administrador', 'Agente'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const solicitud = getSolicitud(id)
  if (!solicitud) return response.status(404).json({ error: 'Solicitud no encontrada' })
  if (request.usuario.rol === 'Agente' && solicitud.agente_responsable_id !== request.usuario.usuario_id) {
    return response.status(404).json({ error: 'Solicitud no encontrada' })
  }
  response.json(solicitud)
})

app.post('/api/agente/solicitudes/:id/aprobar', autenticar, permitirRoles('Agente'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const precioVenta = Number(request.body.precio_venta)
  if (!Number.isFinite(precioVenta) || precioVenta <= 0) return response.status(400).json({ error: 'El precio final de venta debe ser mayor que cero' })

  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const solicitud = db.prepare(`
        SELECT s.*, rt.id AS revision_id, rt.estado AS revision_estado
        FROM solicitudes_cotizacion s
        LEFT JOIN revisiones_tecnicas rt ON rt.solicitud_id = s.id
        WHERE s.id = ?
      `).get(id)
      if (!solicitud) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 })
      if (solicitud.agente_responsable_id !== request.usuario.usuario_id) throw Object.assign(new Error('Solo el agente responsable puede aprobar esta solicitud'), { status: 403 })
      if (solicitud.estado_flujo !== 'en_preparacion' || solicitud.revision_estado !== 'completada') {
        throw Object.assign(new Error('La solicitud no está lista para aprobación'), { status: 409 })
      }
      if (db.prepare('SELECT 1 FROM cotizaciones_versiones WHERE solicitud_id = ?').get(id)) {
        throw Object.assign(new Error('La cotización ya fue aprobada'), { status: 409 })
      }
      const items = db.prepare('SELECT * FROM revision_tecnica_items WHERE revision_id = ? ORDER BY id').all(solicitud.revision_id)
      if (items.length === 0) throw Object.assign(new Error('La revisión técnica no tiene renglones'), { status: 409 })
      const costoInterno = Math.round(items.reduce((total, item) => total + item.subtotal, 0) * 100) / 100
      const version = Number(db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM cotizaciones_versiones WHERE solicitud_id = ?').get(id).version)
      const cotizacionId = Number(db.prepare(`
        INSERT INTO cotizaciones_versiones (
          solicitud_id, revision_id, agente_id, version, costo_interno_total, precio_venta, estado
        ) VALUES (?, ?, ?, ?, ?, ?, 'enviada')
      `).run(id, solicitud.revision_id, request.usuario.usuario_id, version, costoInterno, precioVenta).lastInsertRowid)
      const insertar = db.prepare(`
        INSERT INTO cotizacion_version_items (
          cotizacion_id, producto_codigo, tipo, modelo, clasificacion, cantidad,
          costo_unitario_interno, subtotal_interno
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of items) insertar.run(
        cotizacionId, item.producto_codigo, item.tipo_aplicado, item.modelo_aplicado,
        item.clasificacion_aplicada, item.cantidad, item.costo_unitario_aplicado, item.subtotal,
      )
      const actualizado = db.prepare(`
        UPDATE solicitudes_cotizacion SET estado_flujo = 'pendiente_respuesta'
        WHERE id = ? AND estado_flujo = 'en_preparacion'
      `).run(id)
      if (actualizado.changes !== 1) throw Object.assign(new Error('La solicitud cambió de estado'), { status: 409 })
      db.exec('COMMIT')
      response.json({ solicitud: getSolicitud(id), registro: getProspecto(solicitud.prospecto_id) })
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message })
  }
})

app.post('/api/agente/solicitudes/:id/devolver', autenticar, permitirRoles('Agente'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  let motivo
  try {
    motivo = textoRequerido(request.body.motivo, 'motivo de devolución')
  } catch (error) {
    return response.status(400).json({ error: error.message })
  }

  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const solicitud = db.prepare(`
        SELECT s.*, rt.id AS revision_id, rt.estado AS revision_estado,
               rt.completada_at AS revision_completada_at
        FROM solicitudes_cotizacion s
        LEFT JOIN revisiones_tecnicas rt ON rt.solicitud_id = s.id
        WHERE s.id = ?
      `).get(id)
      if (!solicitud) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 })
      if (solicitud.agente_responsable_id !== request.usuario.usuario_id) throw Object.assign(new Error('Solo el agente responsable puede devolver esta solicitud'), { status: 403 })
      if (solicitud.estado_flujo !== 'en_preparacion' || solicitud.revision_estado !== 'completada') {
        throw Object.assign(new Error('La solicitud no está lista para devolución'), { status: 409 })
      }
      if (db.prepare('SELECT 1 FROM cotizaciones_versiones WHERE solicitud_id = ?').get(id)) {
        throw Object.assign(new Error('Una cotización enviada no puede devolverse como revisión técnica'), { status: 409 })
      }
      db.prepare(`
        INSERT INTO revision_tecnica_devoluciones (
          revision_id, agente_id, motivo, revision_completada_at
        ) VALUES (?, ?, ?, ?)
      `).run(solicitud.revision_id, request.usuario.usuario_id, motivo, solicitud.revision_completada_at)
      db.prepare(`
        UPDATE revisiones_tecnicas
        SET estado = 'en_revision', completada_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND estado = 'completada'
      `).run(solicitud.revision_id)
      db.prepare(`
        UPDATE solicitudes_cotizacion SET estado_flujo = 'pendiente_revision_tecnica'
        WHERE id = ? AND estado_flujo = 'en_preparacion'
      `).run(id)
      db.exec('COMMIT')
      response.json({ solicitud: getSolicitud(id), registro: getProspecto(solicitud.prospecto_id) })
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message })
  }
})

app.post('/api/solicitudes', autenticar, permitirRoles('Agente'), (request, response) => {
  try {
    const cliente = request.body.cliente ?? {}
    const nombre = textoRequerido(cliente.nombre, 'nombre')
    const telefono = textoOpcional(cliente.telefono, 'teléfono')
    const email = normalizarEmail(cliente.email)
    const direccion = validarDireccion(request.body.direccion)
    const modalidad = request.body.modalidad
    if (!['historial_cfe', 'electrodomesticos'].includes(modalidad)) throw new Error('modalidad no válida')

    const calculo = modalidad === 'historial_cfe'
      ? calcularHistorial(request.body.historial_cfe)
      : calcularElectrodomesticos(request.body.electrodomesticos)
    const consumoDiario = calculo.consumoDiario
    const configuracion = validarConfiguracion(
      request.body.configuracion,
      modalidad,
      consumoDiario,
      modalidad === 'electrodomesticos' ? calculo.consumoNoche : null,
      direccion.ciudadCalculo,
    )
    const consumoMensual = modalidad === 'historial_cfe' ? calculo.consumoMensual : consumoDiario * 30
    const consumoIntroducido = modalidad === 'historial_cfe' ? calculo.consumoIntroducido : null
    const consumoObjetivo = Math.round(consumoMensual * (1 + configuracion.margenCrecimiento / 100) * 1_000_000) / 1_000_000

    if (db.prepare('SELECT 1 FROM prospectos WHERE email = ? COLLATE NOCASE').get(email)) {
      return response.status(409).json({ error: 'Ya existe un registro con ese correo electrónico' })
    }
    if (db.prepare('SELECT 1 FROM usuarios_personal WHERE email = ? COLLATE NOCASE').get(email)) {
      return response.status(409).json({ error: 'El correo electrónico ya está registrado como cuenta de personal' })
    }

    db.exec('BEGIN')
    try {
      const prospectoId = Number(db.prepare(`
        INSERT INTO prospectos (nombre, telefono, email, estado)
        VALUES (?, ?, ?, 'Nuevo')
      `).run(nombre, telefono, email).lastInsertRowid)

      db.prepare(`
        INSERT INTO direcciones_cliente (
          prospecto_id, estado, estado_codigo, municipio, colonia, codigo_postal,
          calle, numero_exterior, numero_interior
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        prospectoId,
        direccion.estado,
        direccion.estadoCodigo,
        direccion.municipio,
        direccion.colonia,
        direccion.codigoPostal,
        direccion.calle,
        direccion.numeroExterior,
        direccion.numeroInterior,
      )

      const credencial = hashPassword('123')
      db.prepare(`
        INSERT INTO cuentas_cliente (prospecto_id, email, password_hash, password_salt, rol)
        VALUES (?, ?, ?, ?, 'Cliente')
      `).run(prospectoId, email, credencial.hash, credencial.salt)

      const solicitudId = Number(db.prepare(`
        INSERT INTO solicitudes_cotizacion (
          prospecto_id, modalidad, consumo_diario_kwh, consumo_mensual_kwh,
          consumo_introducido_kwh, margen_crecimiento_pct, consumo_objetivo_kwh,
          consumo_diurno_kwh, consumo_nocturno_kwh, potencia_conectada_w,
          cubrir_baterias, cobertura_nocturna_pct, estimacion_consumo_nocturno_pct,
          necesidad_bateria_kwh_dia, incluir_interconexion, ciudad, eficiencia_pct,
          estado_flujo, agente_responsable_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        prospectoId,
        modalidad,
        consumoDiario,
        consumoMensual,
        consumoIntroducido,
        configuracion.margenCrecimiento,
        consumoObjetivo,
        configuracion.consumoDiurno,
        configuracion.consumoNocturno,
        modalidad === 'electrodomesticos' ? calculo.potenciaConectada : null,
        configuracion.cubrirBaterias ? 1 : 0,
        configuracion.coberturaNocturna,
        configuracion.estimacionNocturna,
        configuracion.necesidadBateria,
        configuracion.incluirInterconexion ? 1 : 0,
        configuracion.ciudad,
        configuracion.eficiencia,
        'pendiente_revision_tecnica',
        request.usuario.usuario_id,
      ).lastInsertRowid)

      if (modalidad === 'historial_cfe') {
        const insertar = db.prepare(`
          INSERT INTO historial_cfe (solicitud_id, consumo_kwh, periodo, mes_inicio, mes_fin, dias_periodo)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        for (const fila of calculo.filas) insertar.run(solicitudId, fila.consumoKwh, fila.periodo, fila.mesInicio, fila.mesFin, fila.diasPeriodo)
      } else {
        const insertar = db.prepare(`
          INSERT INTO electrodomesticos_solicitud (
            solicitud_id, tipo, potencia_w, cantidad, horario, horas_dia, horas_noche,
            consumo_dia_kwh, consumo_noche_kwh, consumo_total_kwh
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const fila of calculo.filas) insertar.run(
          solicitudId, fila.tipo, fila.potenciaW, fila.cantidad, fila.horario,
          fila.horasDia, fila.horasNoche, fila.consumoDiaKwh, fila.consumoNocheKwh, fila.consumoTotalKwh,
        )
      }

      db.prepare(`
        INSERT INTO consumos_prospecto (prospecto_id, consumo_kwh, ciudad, perdidas)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(prospecto_id) DO UPDATE SET
          consumo_kwh = excluded.consumo_kwh,
          ciudad = excluded.ciudad,
          perdidas = excluded.perdidas,
          updated_at = CURRENT_TIMESTAMP
      `).run(prospectoId, consumoObjetivo, configuracion.ciudad, configuracion.eficiencia)

      db.exec('COMMIT')
      response.status(201).json({ registro: getProspecto(prospectoId), solicitud: getSolicitud(solicitudId) })
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    const duplicado = String(error.message).includes('UNIQUE constraint failed')
    response.status(duplicado ? 409 : 400).json({ error: duplicado ? 'El correo electrónico ya está registrado' : error.message })
  }
})

app.post('/api/prospectos', (request, response) => {
  try {
    const nombre = textoRequerido(request.body.nombre, 'nombre')
    const empresa = textoOpcional(request.body.empresa, 'empresa')
    const telefono = textoOpcional(request.body.telefono, 'teléfono')
    const consumo = request.body.consumo == null ? null : validarConsumo(request.body.consumo)
    db.exec('BEGIN')
    try {
      const id = Number(db.prepare(`INSERT INTO prospectos (nombre, empresa, telefono, estado) VALUES (?, ?, ?, 'Nuevo')`).run(nombre, empresa, telefono).lastInsertRowid)
      if (consumo) db.prepare(`INSERT INTO consumos_prospecto (prospecto_id, consumo_kwh, ciudad, perdidas) VALUES (?, ?, ?, ?)`).run(id, consumo.consumoKwh, consumo.ciudad, consumo.eficiencia)
      db.exec('COMMIT')
      response.status(201).json(getProspecto(id))
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.patch('/api/prospectos/:id', (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    const actual = getProspecto(id)
    if (!actual) return response.status(404).json({ error: 'Registro no encontrado' })
    const nombre = request.body.nombre === undefined ? actual.nombre : textoRequerido(request.body.nombre, 'nombre')
    const empresa = request.body.empresa === undefined ? actual.empresa : textoOpcional(request.body.empresa, 'empresa')
    const telefono = request.body.telefono === undefined ? actual.telefono : textoOpcional(request.body.telefono, 'teléfono')
    const estado = request.body.estado ?? actual.estado
    if (!estados.has(estado)) throw new Error('estado no es válido')
    db.prepare(`UPDATE prospectos SET nombre = ?, empresa = ?, telefono = ?, estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nombre, empresa, telefono, estado, id)
    response.json(getProspecto(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.put('/api/prospectos/:id/consumo', (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    if (!getProspecto(id)) return response.status(404).json({ error: 'Registro no encontrado' })
    const consumo = validarConsumo(request.body)
    db.prepare(`
      INSERT INTO consumos_prospecto (prospecto_id, consumo_kwh, ciudad, perdidas)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(prospecto_id) DO UPDATE SET consumo_kwh = excluded.consumo_kwh, ciudad = excluded.ciudad, perdidas = excluded.perdidas, updated_at = CURRENT_TIMESTAMP
    `).run(id, consumo.consumoKwh, consumo.ciudad, consumo.eficiencia)
    response.json(getProspecto(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.use((error, _request, response, next) => {
  void next
  console.error(error)
  response.status(500).json({ error: 'Error interno del servidor' })
})

app.listen(port, () => console.log(`API de ATLAS disponible en http://localhost:${port}`))

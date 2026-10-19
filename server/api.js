import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import express from 'express'
import { db, getProspecto, prospectSelect } from './database.js'
import { ESTADOS_MEXICO, nombreEstadoMexico, normalizarEstadoMexico } from '../shared/estadosMexico.js'
import { estimarAhorro, faltantesDeTarifa, kwpDePaneles, PARAMETROS_POR_DEFECTO, validarBloques } from '../shared/ahorroSolar.js'
import { horasSolaresPico } from '../shared/irradiacion.js'

const app = express()
// Solo se confía en X-Forwarded-For cuando la petición llega desde un proxy local (el de Vite en desarrollo).
// En producción detrás de otro proxy hay que ajustar este valor a la IP o subred de ese proxy.
app.set('trust proxy', 'loopback')
const port = Number(process.env.ATLAS_PORT || 3001)
const estados = new Set(['Nuevo', 'Contactado', 'En seguimiento', 'Cotizado', 'Cerrado ganado', 'Cerrado perdido'])
const ciudades = new Set(['Monterrey', 'Ciudad de México', 'Guadalajara', 'Tijuana', 'Mérida', 'Otra'])
const coberturas = new Set([25, 50, 75, 100])
const margenesCrecimiento = new Set([10, 20, 30, 40, 50])
const codigosEstado = new Set(ESTADOS_MEXICO.map((estado) => estado.codigo))
const tiposProducto = new Set(['Panel', 'Inversor', 'Estructura', 'Cableado', 'Mano de obra', 'Batería', 'Extra'])
const sesiones = new Map()

// La importación de inventario envía hasta 2000 filas; se registra antes del límite general para que este la omita.
app.use('/api/productos/importacion', express.json({ limit: '2mb' }))
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

// Mientras una cuenta de cliente tenga una contraseña temporal, solo puede cambiarla o cerrar sesión.
const RUTAS_CON_CAMBIO_PENDIENTE = new Set(['POST /api/portal/cambiar-contrasena', 'POST /api/logout'])

function autenticar(request, response, next) {
  const authorization = request.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const sesion = sesiones.get(token)
  if (!sesion) {
    const revocada = sesionesRevocadas.get(token)
    if (revocada && Date.now() - revocada.momento < VIGENCIA_REVOCACION_MS && MENSAJES_REVOCACION[revocada.motivo]) {
      return response.status(401).json({ error: MENSAJES_REVOCACION[revocada.motivo], codigo: revocada.motivo })
    }
    return response.status(401).json({ error: 'Sesión requerida o vencida', codigo: 'sesion_vencida' })
  }
  if (sesion.debe_cambiar_password && !RUTAS_CON_CAMBIO_PENDIENTE.has(`${request.method} ${request.baseUrl}${request.path}`)) {
    return response.status(403).json({ error: 'Debes cambiar tu contraseña temporal antes de continuar', codigo: 'debe_cambiar_password' })
  }
  request.usuario = sesion
  request.token = token
  next()
}

// Limitador de intentos fallidos con ventana deslizante por clave. Vive en memoria, igual que las sesiones:
// limitación conocida, se borra al reiniciar el servidor (también con node --watch).
const MAX_CLAVES_LIMITADOR = 10_000
function crearLimitador({ maximo, ventanaMs }) {
  const registros = new Map()
  const vigentes = (clave, ahora = Date.now()) => {
    const lista = (registros.get(clave) ?? []).filter((momento) => ahora - momento < ventanaMs)
    if (lista.length) registros.set(clave, lista)
    else registros.delete(clave)
    return lista
  }
  const recortar = () => {
    if (registros.size <= MAX_CLAVES_LIMITADOR) return
    for (const clave of [...registros.keys()]) vigentes(clave)
    // Si siguen sobrando, se descartan las claves más antiguas para no crecer sin límite.
    for (const clave of registros.keys()) {
      if (registros.size <= MAX_CLAVES_LIMITADOR) break
      registros.delete(clave)
    }
  }
  return {
    maximo,
    ventanaMinutos: Math.round(ventanaMs / 60000),
    // Minutos que faltan para desbloquear la clave, o 0 si no está bloqueada.
    minutosBloqueo(clave) {
      const lista = vigentes(clave)
      return lista.length >= maximo ? Math.max(1, Math.ceil((lista[0] + ventanaMs - Date.now()) / 60000)) : 0
    },
    registrarFallo(clave) {
      const lista = vigentes(clave)
      lista.push(Date.now())
      registros.set(clave, lista)
      recortar()
      return lista.length
    },
    reiniciar(clave) { registros.delete(clave) },
  }
}
const minutosTexto = (minutos) => `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`
const enteroEntorno = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre])
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto
}

// Cambio de contraseña del cliente: 5 contraseñas actuales incorrectas en 10 minutos por cuenta.
const limiteCambioContrasena = crearLimitador({ maximo: 5, ventanaMs: 10 * 60 * 1000 })
// Login: por cuenta (correo, exista o no) y por IP. Ajustables por entorno para las pruebas.
const ventanaLoginMs = enteroEntorno('ATLAS_LOGIN_VENTANA_MIN', 15) * 60 * 1000
const limiteLoginCuenta = crearLimitador({ maximo: enteroEntorno('ATLAS_LOGIN_MAX_CUENTA', 5), ventanaMs: ventanaLoginMs })
const limiteLoginIp = crearLimitador({ maximo: enteroEntorno('ATLAS_LOGIN_MAX_IP', 20), ventanaMs: ventanaLoginMs })

// Tokens cerrados por un motivo conocido, para explicar el 401 en la otra ventana. Se descartan a las 24 h.
const sesionesRevocadas = new Map()
const VIGENCIA_REVOCACION_MS = 24 * 60 * 60 * 1000
function revocarSesion(token, motivo) {
  sesiones.delete(token)
  sesionesRevocadas.set(token, { motivo, momento: Date.now() })
  if (sesionesRevocadas.size > MAX_CLAVES_LIMITADOR) {
    for (const [clave, { momento }] of sesionesRevocadas) {
      if (sesionesRevocadas.size <= MAX_CLAVES_LIMITADOR && Date.now() - momento < VIGENCIA_REVOCACION_MS) break
      sesionesRevocadas.delete(clave)
    }
  }
}
const MENSAJES_REVOCACION = {
  contrasena_cambiada: 'Tu contraseña se cambió en otro dispositivo. Inicia sesión de nuevo.',
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

const proveedorSelect = `
  SELECT pr.id, pr.nombre, pr.activo, pr.created_at, pr.updated_at,
         (SELECT count(*) FROM productos_catalogo pc WHERE pc.proveedor_id = pr.id) AS productos_ligados
  FROM proveedores pr
`

function getProveedor(id) {
  return db.prepare(`${proveedorSelect} WHERE pr.id = ?`).get(id)
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
  // Sin un estado reconocido la solicitud no se podría asignar a ningún técnico: se rechaza en lugar de guardar NULL.
  const estadoCodigo = normalizarEstadoMexico(direccion.estado)
  if (!estadoCodigo) {
    throw new Error(`El estado "${direccion.estado}" no se reconoce. Selecciona uno de los 32 estados de México`)
  }
  // Se guarda el nombre oficial para que la dirección no dependa de cómo se escribió.
  direccion.estado = nombreEstadoMexico(estadoCodigo)
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

// Lo que el prospecto ve de la estimación guardada al emitir; no recalcula ni expone costos internos.
function ahorroPublico(supuestosJson) {
  if (!supuestosJson) return { estado: 'no_disponible', motivo: 'Esta cotización se emitió antes de que ATLAS calculara estimaciones de ahorro.' }
  const supuestos = JSON.parse(supuestosJson)
  return {
    estado: supuestos.estado,
    motivo: supuestos.motivo,
    calculado_at: supuestos.calculado_at,
    consumo_mensual_kwh: supuestos.consumo_mensual_kwh,
    consumo_objetivo_kwh: supuestos.consumo_objetivo_kwh,
    kwp: supuestos.kwp,
    irradiacion: supuestos.irradiacion,
    parametros: supuestos.parametros,
    tarifa: supuestos.tarifa && { codigo: supuestos.tarifa.codigo, nombre: supuestos.tarifa.nombre, pendiente_validar: supuestos.tarifa.pendiente_validar },
    resultado: supuestos.resultado,
  }
}

function getCotizacionPublica(solicitudId) {
  const cotizacion = db.prepare(`
    SELECT id, version, precio_venta, emitida_at, supuestos_ahorro
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
    ahorro: ahorroPublico(cotizacion.supuestos_ahorro),
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
    // Límite de intentos fallidos por IP y por cuenta (correo, exista o no, para no revelar qué cuentas existen).
    // Se revisa antes de verificar la contraseña: mientras dure el bloqueo, ni la correcta entra.
    // request.ip es la IP del navegador solo detrás de un proxy local (trust proxy 'loopback').
    const ip = request.ip ?? 'desconocida'
    const minutosIp = limiteLoginIp.minutosBloqueo(ip)
    if (minutosIp) {
      return response.status(429).json({ error: `Demasiados intentos fallidos desde esta conexión. Espera ${minutosTexto(minutosIp)} e inténtalo de nuevo.`, codigo: 'limite_ip' })
    }
    const minutosCuenta = limiteLoginCuenta.minutosBloqueo(email)
    if (minutosCuenta) {
      return response.status(429).json({ error: `Demasiados intentos fallidos para esta cuenta. Espera ${minutosTexto(minutosCuenta)} e inténtalo de nuevo.`, codigo: 'limite_cuenta' })
    }
    // El 401 de credenciales incorrectas no cambia; solo se cuenta el fallo.
    const credencialesIncorrectas = () => {
      limiteLoginIp.registrarFallo(ip)
      limiteLoginCuenta.registrarFallo(email)
      return response.status(401).json({ error: 'Credenciales incorrectas' })
    }
    const personal = db.prepare(`
      SELECT id AS usuario_id, nombre, email, telefono, zona_trabajo, estado_trabajo_codigo,
             password_hash, password_salt, rol, activo
      FROM usuarios_personal
      WHERE email = ? COLLATE NOCASE
    `).get(email)
    if (personal) {
      if (!personal.activo) return response.status(403).json({ error: 'La cuenta está inactiva' })
      if (!passwordCoincide(password, personal.password_hash, personal.password_salt)) return credencialesIncorrectas()
      limiteLoginCuenta.reiniciar(email)
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
      SELECT c.id AS cuenta_id, c.email, c.password_hash, c.password_salt, c.rol, c.debe_cambiar_password,
             p.id AS prospecto_id, p.nombre
      FROM cuentas_cliente c
      JOIN prospectos p ON p.id = c.prospecto_id
      WHERE c.email = ? COLLATE NOCASE
    `).get(email)
    if (!cuenta || !passwordCoincide(password, cuenta.password_hash, cuenta.password_salt)) return credencialesIncorrectas()
    limiteLoginCuenta.reiniciar(email)
    const sesion = {
      cuenta_id: cuenta.cuenta_id,
      email: cuenta.email,
      nombre: cuenta.nombre,
      rol: cuenta.rol,
      prospecto_id: cuenta.prospecto_id,
      debe_cambiar_password: Boolean(cuenta.debe_cambiar_password),
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

// Cambio de contraseña del cliente. Nunca devuelve ni registra contraseñas.
app.post('/api/portal/cambiar-contrasena', autenticar, permitirRoles('Cliente'), (request, response) => {
  const cuentaId = request.usuario.cuenta_id
  const { actual, nueva, confirmacion } = request.body ?? {}
  if (![actual, nueva, confirmacion].every((valor) => typeof valor === 'string')) {
    return response.status(400).json({ error: 'Faltan datos para cambiar la contraseña' })
  }

  const minutos = limiteCambioContrasena.minutosBloqueo(cuentaId)
  if (minutos) {
    return response.status(429).json({ error: `Demasiados intentos con una contraseña actual incorrecta. Espera ${minutosTexto(minutos)} e inténtalo de nuevo.` })
  }

  if (!actual) return response.status(400).json({ error: 'Escribe tu contraseña actual', campo: 'actual' })
  if (nueva.length < 8) return response.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres', campo: 'nueva' })
  if (nueva.length > 200) return response.status(400).json({ error: 'La nueva contraseña no debe superar 200 caracteres', campo: 'nueva' })
  if (nueva === actual) return response.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual', campo: 'nueva' })
  if (confirmacion !== nueva) return response.status(400).json({ error: 'La confirmación no coincide con la nueva contraseña', campo: 'confirmacion' })

  const cuenta = db.prepare('SELECT id, password_hash, password_salt FROM cuentas_cliente WHERE id = ?').get(cuentaId)
  if (!cuenta) return response.status(404).json({ error: 'Cuenta no encontrada' })
  // passwordCoincide recalcula el scrypt con la sal de la cuenta y compara en tiempo constante.
  if (!passwordCoincide(actual, cuenta.password_hash, cuenta.password_salt)) {
    const restantes = limiteCambioContrasena.maximo - limiteCambioContrasena.registrarFallo(cuentaId)
    return response.status(400).json({
      error: restantes > 0
        ? `La contraseña actual no es correcta. Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`} antes de un bloqueo de 10 minutos.`
        : 'La contraseña actual no es correcta. Alcanzaste el límite de intentos: espera 10 minutos.',
      campo: 'actual',
    })
  }

  const credencial = hashPassword(nueva)
  db.prepare(`
    UPDATE cuentas_cliente
    SET password_hash = ?, password_salt = ?, debe_cambiar_password = 0, password_actualizada_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(credencial.hash, credencial.salt, cuentaId)
  limiteCambioContrasena.reiniciar(cuentaId)

  // Cierra las demás sesiones de la cuenta y conserva la actual. Quedan marcadas para que la otra ventana
  // reciba un 401 que explica el motivo.
  let cerradas = 0
  for (const [token, sesion] of [...sesiones]) {
    if (sesion.cuenta_id === cuentaId && sesion.rol === 'Cliente' && token !== request.token) {
      revocarSesion(token, 'contrasena_cambiada')
      cerradas += 1
    }
  }
  request.usuario.debe_cambiar_password = false
  response.json({ actualizada: true, sesiones_cerradas: cerradas })
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

// Importación masiva del catálogo. El navegador lee el CSV o Excel y envía cada celda como texto;
// aquí se interpreta, se valida con las mismas reglas de validarProducto y se compara con el catálogo.
const LIMITE_FILAS_IMPORTACION = 2000
const columnasImportacionObligatorias = ['codigo', 'clase', 'tipo', 'modelo', 'costo', 'existencias', 'estado']
const camposImportacion = ['tipo', 'modelo', 'clasificacion', 'costo_unitario', 'existencias', 'marca', 'capacidad_kwh', 'potencia_w', 'potencia_kw', 'activo']

const claveImportacion = (valor) => String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const tiposPorClave = new Map([...tiposProducto].map((tipo) => [claveImportacion(tipo), tipo]))
const clasesPorClave = new Map([['material', 'material'], ['material fisico', 'material'], ['servicio', 'servicio']])

function numeroImportacion(texto, campo) {
  let limpio = texto.replace(/[$\s]/g, '')
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(limpio)) limpio = limpio.replaceAll(',', '')
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) throw new Error(`${campo} debe ser numérico`)
  return Number(limpio)
}

function leerSolicitudImportacion(body) {
  const archivo = textoRequerido(body?.archivo, 'nombre del archivo').slice(0, 200)
  if (!Array.isArray(body.columnas)) throw new Error('Faltan las columnas del archivo')
  const faltantes = columnasImportacionObligatorias.filter((columna) => !body.columnas.includes(columna))
  if (faltantes.length) throw new Error(`Faltan columnas obligatorias: ${faltantes.join(', ')}`)
  const filas = body.filas
  if (!Array.isArray(filas) || !filas.length) throw new Error('El archivo no contiene filas para importar')
  if (filas.length > LIMITE_FILAS_IMPORTACION) throw new Error(`El archivo supera el límite de ${LIMITE_FILAS_IMPORTACION} filas`)
  if (filas.some((fila) => !fila || typeof fila !== 'object' || Array.isArray(fila))) throw new Error('Formato de filas no válido')
  return { archivo, filas }
}

function planificarFilaImportacion(entrada, indice, actualPorCodigo, filasPorCodigo, archivo) {
  const errores = []
  const numeroFila = Number.isInteger(entrada.fila) && entrada.fila > 0 ? entrada.fila : indice + 2
  const celda = (campo) => {
    const valor = entrada[campo]
    if (valor === undefined || valor === null) return null
    if (typeof valor !== 'string' && typeof valor !== 'number') {
      errores.push(`${campo} contiene un valor no válido`)
      return null
    }
    return String(valor).trim() || null
  }
  const numero = (campo, etiqueta) => {
    const texto = celda(campo)
    if (texto === null) return null
    try { return numeroImportacion(texto, etiqueta) } catch (error) { errores.push(error.message); return null }
  }

  const codigo = celda('codigo')
  const textoTipo = celda('tipo')
  const modelo = celda('modelo')
  const textoClase = celda('clase')
  const textoExistencias = celda('existencias')
  const textoEstado = celda('estado')
  const costo = numero('costo', 'costo')
  const marca = celda('marca')
  const capacidadKwh = numero('capacidad_kwh', 'capacidad_kwh')
  const potenciaW = numero('potencia_w', 'potencia_w')
  const potenciaKw = numero('potencia_kw', 'potencia_kw')

  if (!codigo) errores.push('código es obligatorio')
  else if (codigo.length > 60) errores.push('código no debe superar 60 caracteres')
  else if (filasPorCodigo.get(codigo.toLowerCase()).length > 1) {
    errores.push(`código repetido en el archivo (filas ${filasPorCodigo.get(codigo.toLowerCase()).join(', ')})`)
  }
  const tipo = textoTipo ? tiposPorClave.get(claveImportacion(textoTipo)) : null
  if (!textoTipo) errores.push('tipo es obligatorio')
  else if (!tipo) errores.push(`tipo "${textoTipo}" no es válido`)
  if (!modelo) errores.push('modelo es obligatorio')
  const clasificacion = textoClase ? clasesPorClave.get(claveImportacion(textoClase)) : null
  if (!textoClase) errores.push('clase es obligatoria')
  else if (!clasificacion) errores.push('clase debe ser material o servicio')
  if (costo === null && !errores.some((error) => error.startsWith('costo'))) errores.push('costo es obligatorio')

  let existencias = null
  if (clasificacion === 'servicio') {
    if (textoExistencias !== null && claveImportacion(textoExistencias) !== 'no aplica') errores.push('los servicios no manejan existencias')
  } else if (clasificacion === 'material') {
    if (textoExistencias === null) errores.push('existencias es obligatorio para materiales')
    else {
      try {
        existencias = numeroImportacion(textoExistencias, 'existencias')
        if (!Number.isInteger(existencias) || existencias < 0) errores.push('existencias debe ser un entero no negativo')
      } catch (error) { errores.push(error.message) }
    }
  }

  const clavesEstado = { activo: 1, inactivo: 0 }
  const activo = textoEstado ? clavesEstado[claveImportacion(textoEstado)] : undefined
  if (!textoEstado) errores.push('el estatus (columna estado) es obligatorio')
  else if (activo === undefined) errores.push('el estatus (columna estado) debe ser Activo o Inactivo')

  const actual = codigo ? actualPorCodigo.get(codigo.toLowerCase()) : undefined
  const base = {
    fila: numeroFila,
    codigo: actual?.codigo ?? codigo,
    tipo: tipo ?? textoTipo,
    modelo,
    clasificacion: clasificacion ?? textoClase,
    costo_unitario: costo,
    existencias: clasificacion === 'material' ? existencias ?? textoExistencias : null,
  }
  if (errores.length) return { ...base, accion: 'invalida', errores, cambios: [] }

  // Las celdas vacías u omitidas llegan como undefined: validarProducto conserva el valor actual.
  let producto
  try {
    producto = validarProducto({
      tipo, modelo, clasificacion, costo_unitario: costo, existencias,
      marca: marca ?? undefined,
      capacidad_kwh: capacidadKwh ?? undefined,
      potencia_w: potenciaW ?? undefined,
      potencia_kw: potenciaKw ?? undefined,
    }, actual ?? {})
  } catch (error) {
    return { ...base, accion: 'invalida', errores: [error.message], cambios: [] }
  }

  const resultado = {
    tipo: producto.tipo,
    modelo: producto.modelo,
    clasificacion: producto.clasificacion,
    costo_unitario: producto.costoUnitario,
    existencias: producto.existencias,
    marca: producto.marca,
    capacidad_kwh: producto.capacidadKwh,
    potencia_w: producto.potenciaW,
    potencia_kw: producto.potenciaKw,
    activo,
    proveedor_id: producto.proveedorId,
  }
  if (!actual) {
    return {
      ...base, ...resultado, accion: 'nuevo', errores: [], cambios: [],
      motivo_baja: activo ? null : `Baja por importación de ${archivo}`,
    }
  }

  const cambios = camposImportacion
    .filter((campo) => (actual[campo] ?? null) !== (resultado[campo] ?? null))
    .map((campo) => ({ campo, antes: actual[campo] ?? null, despues: resultado[campo] ?? null }))
  let motivoBaja = actual.motivo_baja
  if (actual.activo && !activo) motivoBaja = `Baja por importación de ${archivo}`
  if (!actual.activo && activo) motivoBaja = null
  return {
    ...base, ...resultado, id: actual.id, accion: cambios.length ? 'actualizar' : 'sin_cambios',
    errores: [], cambios, motivo_baja: motivoBaja, actualizado_en: actual.updated_at,
  }
}

function planificarImportacion({ archivo, filas }) {
  const productos = db.prepare(productoSelect).all()
  const actualPorCodigo = new Map(productos.map((producto) => [producto.codigo.toLowerCase(), producto]))
  const filasPorCodigo = new Map()
  filas.forEach((entrada, indice) => {
    const codigo = typeof entrada.codigo === 'string' || typeof entrada.codigo === 'number' ? String(entrada.codigo).trim().toLowerCase() : ''
    if (!codigo) return
    const numeroFila = Number.isInteger(entrada.fila) && entrada.fila > 0 ? entrada.fila : indice + 2
    filasPorCodigo.set(codigo, [...(filasPorCodigo.get(codigo) ?? []), numeroFila])
  })
  const plan = filas.map((entrada, indice) => planificarFilaImportacion(entrada, indice, actualPorCodigo, filasPorCodigo, archivo))
  const resumen = { nuevos: 0, actualizar: 0, sin_cambios: 0, invalidas: 0 }
  for (const fila of plan) resumen[fila.accion === 'nuevo' ? 'nuevos' : fila.accion === 'invalida' ? 'invalidas' : fila.accion] += 1
  // La firma resume el plan y el estado de los productos afectados; si cambia antes de confirmar, se rechaza.
  const firma = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
  return { archivo, filas: plan, resumen, firma }
}

app.post('/api/productos/importacion/previsualizar', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    response.json(planificarImportacion(leerSolicitudImportacion(request.body)))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.post('/api/productos/importacion/confirmar', autenticar, permitirRoles('Administrador'), (request, response) => {
  let solicitud
  try {
    solicitud = leerSolicitudImportacion(request.body)
    if (typeof request.body.firma !== 'string') throw new Error('Falta la revisión previa del archivo')
  } catch (error) {
    return response.status(400).json({ error: error.message })
  }

  db.exec('BEGIN IMMEDIATE')
  let transaccionAbierta = true
  let plan
  try {
    plan = planificarImportacion(solicitud)
    if (plan.firma !== request.body.firma) {
      transaccionAbierta = false
      db.exec('ROLLBACK')
      return response.status(409).json({
        error: 'El catálogo o el archivo cambiaron desde la revisión. Revisa de nuevo antes de confirmar.',
        revision: plan,
      })
    }
    const insertar = db.prepare(`
      INSERT INTO productos_catalogo (
        codigo, tipo, modelo, marca, proveedor_id, costo_unitario, clasificacion,
        existencias, potencia_w, potencia_kw, capacidad_kwh, activo, motivo_baja
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const actualizar = db.prepare(`
      UPDATE productos_catalogo
      SET tipo = ?, modelo = ?, marca = ?, costo_unitario = ?, clasificacion = ?, existencias = ?,
          potencia_w = ?, potencia_kw = ?, capacidad_kwh = ?, activo = ?, motivo_baja = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    for (const fila of plan.filas) {
      if (fila.accion === 'nuevo') {
        insertar.run(
          fila.codigo, fila.tipo, fila.modelo, fila.marca, fila.proveedor_id, fila.costo_unitario, fila.clasificacion,
          fila.existencias, fila.potencia_w, fila.potencia_kw, fila.capacidad_kwh, fila.activo, fila.motivo_baja,
        )
      } else if (fila.accion === 'actualizar') {
        actualizar.run(
          fila.tipo, fila.modelo, fila.marca, fila.costo_unitario, fila.clasificacion, fila.existencias,
          fila.potencia_w, fila.potencia_kw, fila.capacidad_kwh, fila.activo, fila.motivo_baja, fila.id,
        )
      }
    }
    db.exec('COMMIT')
    transaccionAbierta = false
  } catch (error) {
    if (transaccionAbierta) db.exec('ROLLBACK')
    console.error(error.stack ?? String(error))
    return response.status(500).json({ error: `No se aplicó ningún cambio del archivo: ${error.message}` })
  }

  response.json({
    agregados: plan.resumen.nuevos,
    actualizados: plan.resumen.actualizar,
    omitidos: plan.resumen.sin_cambios + plan.resumen.invalidas,
    productos: db.prepare(`${productoSelect} ORDER BY id`).all(),
  })
})

app.get('/api/proveedores', autenticar, permitirRoles('Administrador', 'Agente', 'Técnico'), (request, response) => {
  const condicion = request.usuario.rol === 'Administrador' ? '' : ' WHERE pr.activo = 1'
  response.json(db.prepare(`${proveedorSelect}${condicion} ORDER BY pr.nombre COLLATE NOCASE`).all())
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

// Borrado permanente. La llave foránea ON DELETE SET NULL deja sin proveedor a los productos ligados;
// los productos y su historial se conservan.
app.delete('/api/proveedores/:id', autenticar, permitirRoles('Administrador'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  let proveedor
  db.exec('BEGIN IMMEDIATE')
  try {
    proveedor = getProveedor(id)
    if (proveedor) db.prepare('DELETE FROM proveedores WHERE id = ?').run(id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  if (!proveedor) return response.status(404).json({ error: 'Proveedor no encontrado' })
  response.json({ id, nombre: proveedor.nombre, productos_sin_proveedor: proveedor.productos_ligados })
})

// ─── Integración 6: tarifas CFE, parámetros y estimación de ahorro ───
const tiposTarifa = new Set(['domestica', 'dac', 'comercial'])
const rangosParametros = {
  eficiencia: [0.01, 1, 'La eficiencia debe estar entre 0.01 y 1'],
  degradacion_anual: [0, 0.2, 'La degradación anual debe estar entre 0 y 0.2 (20%)'],
  alza_tarifa_anual: [-0.5, 1, 'El alza anual de tarifa debe estar entre -0.5 y 1'],
  iva: [0, 1, 'El IVA debe estar entre 0 y 1'],
  meses_verano: [0, 12, 'Los meses de verano deben estar entre 0 y 12'],
}

function getTarifa(id) {
  const tarifa = db.prepare('SELECT * FROM tarifas_cfe WHERE id = ?').get(id)
  if (!tarifa) return null
  tarifa.bloques = db.prepare(`
    SELECT temporada, orden, desde_kwh, hasta_kwh, precio_kwh, origen_precio FROM tarifas_bloques
    WHERE tarifa_id = ? ORDER BY temporada, orden
  `).all(id)
  tarifa.estados = db.prepare('SELECT estado_codigo FROM tarifas_estados WHERE tarifa_id = ? ORDER BY estado_codigo').all(id).map((fila) => fila.estado_codigo)
  tarifa.faltantes = faltantesDeTarifa(tarifa)
  return tarifa
}

function listarTarifas() {
  return db.prepare("SELECT id FROM tarifas_cfe ORDER BY CASE tipo WHEN 'domestica' THEN 1 WHEN 'dac' THEN 2 ELSE 3 END, codigo").all().map((fila) => getTarifa(fila.id))
}

function getParametrosAhorro() {
  const parametros = { ...PARAMETROS_POR_DEFECTO }
  for (const fila of db.prepare('SELECT clave, valor FROM parametros_ahorro').all()) parametros[fila.clave] = fila.valor
  return parametros
}

function numeroOpcional(valor, campo, { minimo = 0, mayorQue = false } = {}) {
  if (valor === undefined || valor === null || valor === '') return null
  const numero = Number(valor)
  if (!Number.isFinite(numero) || (mayorQue ? numero <= minimo : numero < minimo)) {
    throw new Error(`${campo} debe ser un número ${mayorQue ? 'mayor que' : 'mayor o igual a'} ${minimo}`)
  }
  return numero
}

function validarTarifa(body, idActual = null) {
  const codigo = textoRequerido(body.codigo, 'código de la tarifa').toUpperCase()
  if (codigo.length > 20) throw new Error('El código de la tarifa no debe superar 20 caracteres')
  const nombre = textoRequerido(body.nombre, 'nombre de la tarifa')
  const tipo = body.tipo
  if (!tiposTarifa.has(tipo)) throw new Error('Tipo de tarifa no válido')
  const domestica = tipo === 'domestica'
  const limiteDac = domestica ? numeroOpcional(body.limite_dac_kwh, 'El límite DAC', { mayorQue: true }) : null
  let tarifaDacId = null
  if (domestica && body.tarifa_dac_id !== undefined && body.tarifa_dac_id !== null && body.tarifa_dac_id !== '') {
    tarifaDacId = idValido(body.tarifa_dac_id)
    const dac = tarifaDacId && db.prepare("SELECT id FROM tarifas_cfe WHERE id = ? AND tipo = 'dac'").get(tarifaDacId)
    if (!dac || tarifaDacId === idActual) throw new Error('La tarifa DAC asignada no es válida')
  }
  const cargoFijo = numeroOpcional(body.cargo_fijo_mensual, 'El cargo fijo mensual')
  const origenCargoFijo = cargoFijo === null ? null : origenPrecio(body.origen_cargo_fijo, 'del cargo fijo')
  const vigencia = body.vigencia_desde ? String(body.vigencia_desde) : null
  if (vigencia && !/^\d{4}-\d{2}-\d{2}$/.test(vigencia)) throw new Error('La vigencia debe tener el formato AAAA-MM-DD')
  if (!Array.isArray(body.bloques)) throw new Error('Faltan los bloques de la tarifa')
  const bloques = body.bloques.map((bloque) => {
    const precio = numeroOpcional(bloque.precio_kwh, 'El precio por kWh')
    return {
      temporada: bloque.temporada,
      orden: Number(bloque.orden),
      desde_kwh: numeroOpcional(bloque.desde_kwh, 'El inicio del bloque') ?? 0,
      hasta_kwh: numeroOpcional(bloque.hasta_kwh, 'El límite del bloque'),
      precio_kwh: precio,
      // Un bloque sin precio no tiene origen.
      origen_precio: precio === null ? null : origenPrecio(bloque.origen_precio, `del bloque ${bloque.orden}`),
    }
  })
  const errores = validarBloques(bloques)
  if (errores.length) throw new Error(errores.join('. '))
  const tarifa = {
    codigo, nombre, tipo, limite_dac_kwh: limiteDac, tarifa_dac_id: tarifaDacId, cargo_fijo_mensual: cargoFijo,
    origen_cargo_fijo: origenCargoFijo,
    vigencia_desde: vigencia, activa: body.activa === false ? 0 : 1, pendiente_validar: body.pendiente_validar === false ? 0 : 1,
    notas: textoOpcional(body.notas, 'notas'), bloques,
  }
  if (!tarifa.pendiente_validar) {
    // Solo se marca como validada una tarifa con todos sus precios capturados y tomados de un recibo.
    const faltantes = faltantesDeTarifa(tarifa)
    if (faltantes.length) throw new Error(`No puedes marcarla como validada; falta: ${faltantes.join(', ')}`)
    const etiquetas = { todo_el_anio: '', verano: ' (verano)', fuera_verano: ' (fuera de verano)' }
    const noDeRecibo = [
      ...(tarifa.origen_cargo_fijo === 'recibo' ? [] : ['cargo fijo']),
      ...bloques.filter((bloque) => bloque.origen_precio !== 'recibo').map((bloque) => `bloque ${bloque.orden}${etiquetas[bloque.temporada]}`),
    ]
    if (noDeRecibo.length) throw new Error(`Solo puedes marcarla como validada si todos los precios se tomaron de un recibo; no lo están: ${noDeRecibo.join(', ')}`)
  }
  return tarifa
}

function origenPrecio(valor, descripcion) {
  if (valor === undefined || valor === null || valor === '') return null
  if (!['prueba', 'recibo'].includes(valor)) throw new Error(`El origen del precio ${descripcion} debe ser "prueba" o "recibo"`)
  return valor
}

function guardarBloques(tarifaId, bloques) {
  db.prepare('DELETE FROM tarifas_bloques WHERE tarifa_id = ?').run(tarifaId)
  const insertar = db.prepare('INSERT INTO tarifas_bloques (tarifa_id, temporada, orden, desde_kwh, hasta_kwh, precio_kwh, origen_precio) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const bloque of bloques) insertar.run(tarifaId, bloque.temporada, bloque.orden, bloque.desde_kwh, bloque.hasta_kwh, bloque.precio_kwh, bloque.origen_precio)
}

function respuestaConflicto(error, response) {
  if (String(error.message).includes('UNIQUE') && String(error.message).includes('codigo')) {
    return response.status(409).json({ error: 'Ya existe una tarifa con ese código' })
  }
  return response.status(error.status || 400).json({ error: error.message, ...(error.datos ?? {}) })
}

app.get('/api/tarifas', autenticar, permitirRoles('Administrador', 'Agente'), (_request, response) => {
  response.json({
    tarifas: listarTarifas(),
    estados: db.prepare('SELECT estado_codigo, tarifa_id FROM tarifas_estados ORDER BY estado_codigo').all(),
    parametros: getParametrosAhorro(),
  })
})

app.post('/api/tarifas', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const tarifa = validarTarifa(request.body)
    db.exec('BEGIN IMMEDIATE')
    try {
      const id = Number(db.prepare(`
        INSERT INTO tarifas_cfe (codigo, nombre, tipo, limite_dac_kwh, tarifa_dac_id, cargo_fijo_mensual, origen_cargo_fijo, vigencia_desde, activa, pendiente_validar, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(tarifa.codigo, tarifa.nombre, tarifa.tipo, tarifa.limite_dac_kwh, tarifa.tarifa_dac_id, tarifa.cargo_fijo_mensual, tarifa.origen_cargo_fijo,
        tarifa.vigencia_desde, tarifa.activa, tarifa.pendiente_validar, tarifa.notas).lastInsertRowid)
      guardarBloques(id, tarifa.bloques)
      db.exec('COMMIT')
      response.status(201).json(getTarifa(id))
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } catch (error) {
    respuestaConflicto(error, response)
  }
})

app.put('/api/tarifas/:id', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    const actual = getTarifa(id)
    if (!actual) return response.status(404).json({ error: 'Tarifa no encontrada' })
    const tarifa = validarTarifa(request.body, id)
    if (!tarifa.activa && actual.estados.length) {
      throw Object.assign(new Error(`La tarifa está asignada a ${actual.estados.length} estado(s); reasígnalos antes de desactivarla`), { status: 409, datos: { estados: actual.estados } })
    }
    if (tarifa.tipo !== 'dac' && actual.tipo === 'dac' && db.prepare('SELECT 1 FROM tarifas_cfe WHERE tarifa_dac_id = ?').get(id)) {
      throw Object.assign(new Error('Otras tarifas usan esta tarifa como DAC; cámbialas antes de modificar su tipo'), { status: 409 })
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      // Las cotizaciones ya emitidas no cambian: guardan su propia copia en supuestos_ahorro.
      db.prepare(`
        UPDATE tarifas_cfe SET codigo = ?, nombre = ?, tipo = ?, limite_dac_kwh = ?, tarifa_dac_id = ?, cargo_fijo_mensual = ?,
          origen_cargo_fijo = ?, vigencia_desde = ?, activa = ?, pendiente_validar = ?, notas = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(tarifa.codigo, tarifa.nombre, tarifa.tipo, tarifa.limite_dac_kwh, tarifa.tarifa_dac_id, tarifa.cargo_fijo_mensual,
        tarifa.origen_cargo_fijo, tarifa.vigencia_desde, tarifa.activa, tarifa.pendiente_validar, tarifa.notas, id)
      guardarBloques(id, tarifa.bloques)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    response.json(getTarifa(id))
  } catch (error) {
    respuestaConflicto(error, response)
  }
})

app.delete('/api/tarifas/:id', autenticar, permitirRoles('Administrador'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const tarifa = getTarifa(id)
  if (!tarifa) return response.status(404).json({ error: 'Tarifa no encontrada' })
  if (tarifa.estados.length) {
    return response.status(409).json({ error: `La tarifa está asignada a ${tarifa.estados.length} estado(s); reasígnalos a otra tarifa antes de eliminarla`, estados: tarifa.estados })
  }
  const dependientes = db.prepare('SELECT codigo FROM tarifas_cfe WHERE tarifa_dac_id = ?').all(id).map((fila) => fila.codigo)
  if (dependientes.length) {
    return response.status(409).json({ error: `Las tarifas ${dependientes.join(', ')} usan esta tarifa como DAC; cámbialas antes de eliminarla` })
  }
  db.prepare('DELETE FROM tarifas_cfe WHERE id = ?').run(id)
  response.json({ id, codigo: tarifa.codigo })
})

app.put('/api/tarifas-estados/:codigo', autenticar, permitirRoles('Administrador'), (request, response) => {
  const codigo = request.params.codigo
  if (!codigosEstado.has(codigo)) return response.status(400).json({ error: 'Estado no válido' })
  const tarifaId = idValido(request.body.tarifa_id)
  const tarifa = tarifaId && db.prepare("SELECT id, codigo FROM tarifas_cfe WHERE id = ? AND activa = 1 AND tipo IN ('domestica', 'comercial')").get(tarifaId)
  if (!tarifa) return response.status(400).json({ error: 'Elige una tarifa doméstica o comercial activa' })
  db.prepare(`
    INSERT INTO tarifas_estados (estado_codigo, tarifa_id) VALUES (?, ?)
    ON CONFLICT(estado_codigo) DO UPDATE SET tarifa_id = excluded.tarifa_id, updated_at = CURRENT_TIMESTAMP
  `).run(codigo, tarifaId)
  response.json({ estado_codigo: codigo, tarifa_id: tarifaId })
})

app.put('/api/parametros-ahorro', autenticar, permitirRoles('Administrador'), (request, response) => {
  try {
    const cambios = Object.entries(request.body ?? {})
    if (!cambios.length) throw new Error('No hay parámetros para guardar')
    const valores = cambios.map(([clave, valor]) => {
      const rango = rangosParametros[clave]
      if (!rango) throw new Error(`Parámetro desconocido: ${clave}`)
      const numero = Number(valor)
      if (valor === '' || valor === null || !Number.isFinite(numero) || numero < rango[0] || numero > rango[1]) throw new Error(rango[2])
      if (clave === 'meses_verano' && !Number.isInteger(numero)) throw new Error('Los meses de verano deben ser un número entero')
      return [clave, numero]
    })
    db.exec('BEGIN IMMEDIATE')
    try {
      const actualizar = db.prepare('UPDATE parametros_ahorro SET valor = ?, updated_at = CURRENT_TIMESTAMP WHERE clave = ?')
      for (const [clave, numero] of valores) actualizar.run(numero, clave)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    response.json(getParametrosAhorro())
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

const copiaTarifa = (tarifa) => tarifa && ({
  id: tarifa.id, codigo: tarifa.codigo, nombre: tarifa.nombre, tipo: tarifa.tipo, limite_dac_kwh: tarifa.limite_dac_kwh,
  cargo_fijo_mensual: tarifa.cargo_fijo_mensual, origen_cargo_fijo: tarifa.origen_cargo_fijo, vigencia_desde: tarifa.vigencia_desde,
  pendiente_validar: Boolean(tarifa.pendiente_validar), bloques: tarifa.bloques,
})

// Calcula la estimación de una solicitud y devuelve la copia completa de supuestos y resultados,
// que es lo que se guarda al emitir para que la cotización no cambie si después cambian tarifas o precios.
function construirEstimacion(solicitudId, tarifaIdSolicitada, precioVenta) {
  const solicitud = db.prepare(`
    SELECT s.id, s.consumo_mensual_kwh, s.consumo_objetivo_kwh, d.estado_codigo, rt.id AS revision_id
    FROM solicitudes_cotizacion s
    LEFT JOIN direcciones_cliente d ON d.prospecto_id = s.prospecto_id
    LEFT JOIN revisiones_tecnicas rt ON rt.solicitud_id = s.id
    WHERE s.id = ?
  `).get(solicitudId)
  const tarifaSugeridaId = solicitud.estado_codigo
    ? db.prepare('SELECT tarifa_id FROM tarifas_estados WHERE estado_codigo = ?').get(solicitud.estado_codigo)?.tarifa_id ?? null
    : null
  const tarifaId = tarifaIdSolicitada ?? tarifaSugeridaId
  const tarifa = tarifaId ? getTarifa(tarifaId) : null
  if (tarifaIdSolicitada && (!tarifa || !tarifa.activa || tarifa.tipo === 'dac')) {
    throw Object.assign(new Error('Elige una tarifa doméstica o comercial activa'), { status: 400 })
  }
  const tarifaDac = tarifa?.tarifa_dac_id ? getTarifa(tarifa.tarifa_dac_id) : null
  const paneles = solicitud.revision_id ? db.prepare(`
    SELECT ri.producto_codigo, ri.modelo_aplicado AS modelo, ri.cantidad, pc.potencia_w
    FROM revision_tecnica_items ri
    JOIN productos_catalogo pc ON pc.id = ri.producto_id
    WHERE ri.revision_id = ? AND ri.tipo_aplicado = 'Panel'
    ORDER BY ri.id
  `).all(solicitud.revision_id) : []
  const kwp = kwpDePaneles(paneles.filter((panel) => panel.potencia_w))
  const irradiacion = horasSolaresPico(solicitud.estado_codigo)
  const parametros = getParametrosAhorro()

  let resultado
  if (!tarifa) resultado = { estado: 'sin_tarifa', motivo: 'No hay una tarifa asignada al estado de la dirección; elige una tarifa para estimar el ahorro.' }
  else {
    try {
      resultado = estimarAhorro({ consumoMensualKwh: solicitud.consumo_mensual_kwh, kwp, hsp: irradiacion.hsp, parametros, tarifa, tarifaDac, precioVenta })
    } catch (error) {
      resultado = { estado: 'sin_datos', motivo: `No se pudo estimar el ahorro: ${error.message}.` }
    }
  }
  const cifras = { ...resultado }
  delete cifras.parametros
  return {
    tarifa_sugerida_id: tarifaSugeridaId,
    supuestos: {
      version_calculo: 1,
      calculado_at: new Date().toISOString(),
      estado: resultado.estado,
      motivo: resultado.motivo ?? null,
      consumo_mensual_kwh: solicitud.consumo_mensual_kwh,
      consumo_objetivo_kwh: solicitud.consumo_objetivo_kwh,
      estado_codigo: solicitud.estado_codigo,
      irradiacion: { hsp: irradiacion.hsp, fuente: irradiacion.fuente, fecha: irradiacion.fecha, conocido: irradiacion.conocido },
      paneles,
      kwp,
      parametros,
      tarifa: copiaTarifa(tarifa),
      tarifa_dac: copiaTarifa(tarifaDac),
      resultado: resultado.estado === 'calculada' ? cifras : null,
    },
  }
}

app.get('/api/agente/solicitudes/:id/estimacion', autenticar, permitirRoles('Agente'), (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })
  const solicitud = db.prepare('SELECT agente_responsable_id FROM solicitudes_cotizacion WHERE id = ?').get(id)
  if (!solicitud || solicitud.agente_responsable_id !== request.usuario.usuario_id) return response.status(404).json({ error: 'Solicitud no encontrada' })
  const precioVenta = Number(request.query.precio_venta)
  if (!Number.isFinite(precioVenta) || precioVenta <= 0) return response.status(400).json({ error: 'Ingresa un precio de venta mayor que cero para estimar el ahorro' })
  const tarifaId = request.query.tarifa_id ? idValido(request.query.tarifa_id) : null
  if (request.query.tarifa_id && !tarifaId) return response.status(400).json({ error: 'Tarifa no válida' })
  try {
    response.json(construirEstimacion(id, tarifaId, precioVenta))
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message })
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
  const tarifaId = request.body.tarifa_id === undefined || request.body.tarifa_id === null || request.body.tarifa_id === '' ? null : idValido(request.body.tarifa_id)
  if (request.body.tarifa_id && !tarifaId) return response.status(400).json({ error: 'Tarifa no válida' })

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
      // La estimación se calcula dentro de la misma transacción y se guarda con todos sus supuestos.
      const { supuestos } = construirEstimacion(id, tarifaId, precioVenta)
      const cotizacionId = Number(db.prepare(`
        INSERT INTO cotizaciones_versiones (
          solicitud_id, revision_id, agente_id, version, costo_interno_total, precio_venta, estado,
          ahorro_anual_est, retorno_inversion_anios, supuestos_ahorro
        ) VALUES (?, ?, ?, ?, ?, ?, 'enviada', ?, ?, ?)
      `).run(
        id, solicitud.revision_id, request.usuario.usuario_id, version, costoInterno, precioVenta,
        supuestos.resultado?.ahorro_anual ?? null, supuestos.resultado?.retorno_inversion_anios ?? null, JSON.stringify(supuestos),
      ).lastInsertRowid)
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

// Rutas antiguas de prospectos: desde la corrección de seguridad exigen sesión de Administrador o Agente.
app.post('/api/prospectos', autenticar, permitirRoles('Administrador', 'Agente'), (request, response) => {
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

app.patch('/api/prospectos/:id', autenticar, permitirRoles('Administrador', 'Agente'), (request, response) => {
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

app.put('/api/prospectos/:id/consumo', autenticar, permitirRoles('Administrador', 'Agente'), (request, response) => {
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
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'El contenido enviado supera el tamaño permitido' })
  }
  // El error de JSON mal formado trae el cuerpo crudo (podría incluir una contraseña): no se registra.
  if (error.type === 'entity.parse.failed') return response.status(400).json({ error: 'El contenido enviado no es JSON válido' })
  // Solo el stack: console.error(error) imprimiría también propiedades adjuntas al error.
  console.error(error.stack ?? String(error))
  response.status(500).json({ error: 'Error interno del servidor' })
})

app.listen(port, () => console.log(`API de ATLAS disponible en http://localhost:${port}`))

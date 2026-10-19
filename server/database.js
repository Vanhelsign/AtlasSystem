import { mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import process from 'node:process'
import { ESTADOS_MEXICO, normalizarEstadoMexico } from '../shared/estadosMexico.js'

const serverDir = dirname(fileURLToPath(import.meta.url))
const dataDir = join(serverDir, '..', 'data')
const databasePath = process.env.ATLAS_DB_PATH ? resolve(process.env.ATLAS_DB_PATH) : join(dataDir, 'atlas.sqlite')

mkdirSync(dirname(databasePath), { recursive: true })

export const db = new DatabaseSync(databasePath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')
db.exec(readFileSync(join(serverDir, 'schema.sql'), 'utf8'))

const columnasProspecto = db.prepare('PRAGMA table_info(prospectos)').all()
if (!columnasProspecto.some((columna) => columna.name === 'email')) {
  db.exec('ALTER TABLE prospectos ADD COLUMN email TEXT;')
}

const columnasPersonal = db.prepare('PRAGMA table_info(usuarios_personal)').all()
if (!columnasPersonal.some((columna) => columna.name === 'estado_trabajo_codigo')) {
  db.exec('ALTER TABLE usuarios_personal ADD COLUMN estado_trabajo_codigo TEXT;')
}

const columnasDireccion = db.prepare('PRAGMA table_info(direcciones_cliente)').all()
if (!columnasDireccion.some((columna) => columna.name === 'estado_codigo')) {
  db.exec('ALTER TABLE direcciones_cliente ADD COLUMN estado_codigo TEXT;')
}

const actualizarEstadoPersonal = db.prepare('UPDATE usuarios_personal SET estado_trabajo_codigo = ? WHERE id = ?')
for (const cuenta of db.prepare(`
  SELECT id, zona_trabajo
  FROM usuarios_personal
  WHERE estado_trabajo_codigo IS NULL AND zona_trabajo IS NOT NULL
`).all()) {
  const codigo = normalizarEstadoMexico(cuenta.zona_trabajo)
  if (codigo) actualizarEstadoPersonal.run(codigo, cuenta.id)
}

const actualizarEstadoDireccion = db.prepare('UPDATE direcciones_cliente SET estado_codigo = ? WHERE prospecto_id = ?')
for (const direccion of db.prepare(`
  SELECT prospecto_id, estado
  FROM direcciones_cliente
  WHERE estado_codigo IS NULL
`).all()) {
  const codigo = normalizarEstadoMexico(direccion.estado)
  if (codigo) actualizarEstadoDireccion.run(codigo, direccion.prospecto_id)
}

const columnasSolicitud = db.prepare('PRAGMA table_info(solicitudes_cotizacion)').all()
for (const [nombre, tipo] of [
  ['consumo_introducido_kwh', 'REAL'],
  ['margen_crecimiento_pct', 'INTEGER'],
  ['consumo_objetivo_kwh', 'REAL'],
  ['estado_flujo', "TEXT NOT NULL DEFAULT 'pendiente_revision_tecnica'"],
  ['agente_responsable_id', 'INTEGER REFERENCES usuarios_personal(id) ON DELETE SET NULL'],
]) {
  if (!columnasSolicitud.some((columna) => columna.name === nombre)) {
    db.exec(`ALTER TABLE solicitudes_cotizacion ADD COLUMN ${nombre} ${tipo};`)
  }
}

// ATLAS v2, Fase A: columnas nuevas, todas con NULL o valor por defecto para conservar los registros existentes.
for (const [tabla, columnas] of [
  ['prospectos', [
    ['etapa_cliente', "TEXT NOT NULL DEFAULT 'prospecto' CHECK (etapa_cliente IN ('prospecto', 'cliente_instalado'))"],
  ]],
  ['productos_catalogo', [
    ['marca', 'TEXT'],
    ['proveedor_id', 'INTEGER REFERENCES proveedores(id) ON DELETE SET NULL'],
  ]],
  ['cotizaciones_versiones', [
    ['ahorro_anual_est', 'REAL CHECK (ahorro_anual_est IS NULL OR ahorro_anual_est >= 0)'],
    ['retorno_inversion_anios', 'REAL CHECK (retorno_inversion_anios IS NULL OR retorno_inversion_anios >= 0)'],
    ['estatus_respuesta', "TEXT NOT NULL DEFAULT 'pendiente' CHECK (estatus_respuesta IN ('pendiente', 'aprobada', 'rechazada', 'pago_vencido'))"],
    // Integración 6: copia de los supuestos de la estimación de ahorro al emitir la cotización.
    ['supuestos_ahorro', 'TEXT CHECK (supuestos_ahorro IS NULL OR json_valid(supuestos_ahorro))'],
  ]],
]) {
  const existentes = db.prepare(`PRAGMA table_info(${tabla})`).all()
  for (const [nombre, tipo] of columnas) {
    if (!existentes.some((columna) => columna.name === nombre)) {
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo};`)
    }
  }
}

function respaldarBase(etiqueta) {
  const directorio = join(dirname(databasePath), 'backups')
  mkdirSync(directorio, { recursive: true })
  const fecha = new Date().toISOString().replace(/[:.]/g, '-')
  const destino = join(directorio, `${basename(databasePath, extname(databasePath))}-${etiqueta}-${fecha}.sqlite`)
  // VACUUM INTO genera una copia consistente que incluye lo pendiente en el WAL.
  db.exec(`VACUUM INTO '${destino.replaceAll("'", "''")}';`)
  console.log(`Respaldo de la base creado en ${destino}`)
}

// Procedimiento de reconstrucción recomendado por SQLite: las llaves foráneas se desactivan fuera de la
// transacción para que DROP no afecte a revision_tecnica_items, y se verifican antes de confirmar.
function reconstruirProductosCatalogo() {
  const columnas = `id, codigo, tipo, modelo, marca, proveedor_id, costo_unitario, clasificacion,
    existencias, potencia_w, potencia_kw, activo, motivo_baja, created_at, updated_at`
  db.exec('PRAGMA foreign_keys = OFF;')
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const total = db.prepare('SELECT count(*) AS n FROM productos_catalogo').get().n
      const secuencia = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'productos_catalogo'").get()?.seq ?? 0

      db.exec(`
        CREATE TABLE productos_catalogo_v1 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT NOT NULL COLLATE NOCASE UNIQUE,
          tipo TEXT NOT NULL CHECK (tipo IN ('Panel', 'Inversor', 'Estructura', 'Cableado', 'Mano de obra', 'Batería', 'Extra')),
          modelo TEXT NOT NULL CHECK (length(trim(modelo)) > 0),
          marca TEXT,
          proveedor_id INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
          costo_unitario REAL NOT NULL CHECK (costo_unitario >= 0),
          clasificacion TEXT NOT NULL CHECK (clasificacion IN ('material', 'servicio')),
          existencias INTEGER,
          potencia_w REAL CHECK (potencia_w IS NULL OR potencia_w > 0),
          potencia_kw REAL CHECK (potencia_kw IS NULL OR potencia_kw > 0),
          capacidad_kwh REAL CHECK (capacidad_kwh IS NULL OR capacidad_kwh > 0),
          activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
          motivo_baja TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (
            (clasificacion = 'material' AND existencias IS NOT NULL AND existencias >= 0 AND typeof(existencias) = 'integer')
            OR (clasificacion = 'servicio' AND existencias IS NULL)
          )
        );
      `)
      db.exec(`INSERT INTO productos_catalogo_v1 (${columnas}) SELECT ${columnas} FROM productos_catalogo;`)
      db.exec('DROP TABLE productos_catalogo;')
      db.exec('ALTER TABLE productos_catalogo_v1 RENAME TO productos_catalogo;')

      // Conserva el contador de AUTOINCREMENT para no reutilizar identificadores ya emitidos.
      db.prepare("DELETE FROM sqlite_sequence WHERE name = 'productos_catalogo'").run()
      db.prepare(`
        INSERT INTO sqlite_sequence (name, seq)
        VALUES ('productos_catalogo', max(?, (SELECT ifnull(max(id), 0) FROM productos_catalogo)))
      `).run(secuencia)

      if (db.prepare('SELECT count(*) AS n FROM productos_catalogo').get().n !== total) {
        throw new Error('La reconstrucción de productos_catalogo no conservó todos los registros')
      }
      const violaciones = db.prepare('PRAGMA foreign_key_check').all()
      if (violaciones.length) {
        throw new Error(`La reconstrucción de productos_catalogo dejó llaves foráneas inválidas: ${JSON.stringify(violaciones)}`)
      }
      db.exec('PRAGMA user_version = 1;')
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;')
  }
}

// ATLAS v2, Fase B (user_version 1): productos_catalogo acepta Batería y Extra, y agrega capacidad_kwh.
// Una base nueva ya nace con esa definición desde schema.sql; solo una existente se respalda y reconstruye.
if (db.prepare('PRAGMA user_version').get().user_version < 1) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'productos_catalogo'").get()
  if (sql.includes("'Batería'")) {
    db.exec('PRAGMA user_version = 1;')
  } else {
    respaldarBase('antes-v1')
    reconstruirProductosCatalogo()
  }
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS prospectos_email_unico
  ON prospectos(email COLLATE NOCASE)
  WHERE email IS NOT NULL;
`)

// ATLAS v2 (user_version 2): el catálogo y los proveedores iniciales se cargan una sola vez por base.
// Así un proveedor eliminado no reaparece al reiniciar y los INSERT ignorados ya no consumen identificadores.
// Una base existente en v1 ya tiene estos registros; la carga no la altera y solo marca la versión.
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  db.exec('BEGIN')
  try {
    const insertarProductoInicial = db.prepare(`
      INSERT OR IGNORE INTO productos_catalogo (
        codigo, tipo, modelo, costo_unitario, clasificacion,
        existencias, potencia_w, potencia_kw, activo
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `)
    for (const producto of [
      ['PANEL-JA-550', 'Panel', 'JA Solar 550W Mono', 3200, 'material', 80, 550, null],
      ['INV-GROWATT-5KW', 'Inversor', 'Growatt 5kW String', 14500, 'material', 12, null, 5],
      ['EST-ALUMINIO', 'Estructura', 'Estructura aluminio', 420, 'material', 200, null, null],
      ['CABLE-PROTECCIONES', 'Cableado', 'Cableado + protecciones', 3500, 'material', 999, null, null],
      ['SERV-INST-ESTANDAR', 'Mano de obra', 'Instalación estándar', 8000, 'servicio', null, null, null],
    ]) insertarProductoInicial.run(...producto)

    const insertarProveedorInicial = db.prepare('INSERT OR IGNORE INTO proveedores (nombre, activo) VALUES (?, 1)')
    for (const nombre of [
      'SolarCenter (Paneles)',
      'Krannich Solar (Inversores)',
      'Exel Solar (Estructuras y Cableado)',
      'BayWa r.e. (Almacenamiento)',
    ]) insertarProveedorInicial.run(nombre)

    db.exec('PRAGMA user_version = 2;')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// ATLAS v2, Integración 6 (user_version 3): estructura de tarifas de ejemplo y parámetros de ahorro, una sola vez.
// Los precios y cargos fijos quedan vacíos y todas las tarifas "pendientes de validar": el administrador
// captura los valores reales desde la app con un recibo de CFE. Los límites de los bloques también son de ejemplo.
if (db.prepare('PRAGMA user_version').get().user_version < 3) {
  db.exec('BEGIN')
  try {
    const nota = 'Estructura de ejemplo. Capture precios, cargo fijo y límites con un recibo de CFE antes de validarla.'
    const insertarTarifa = db.prepare(`
      INSERT OR IGNORE INTO tarifas_cfe (codigo, nombre, tipo, limite_dac_kwh, cargo_fijo_mensual, activa, pendiente_validar, notas)
      VALUES (?, ?, ?, ?, NULL, 1, 1, ?)
    `)
    const idTarifa = (codigo) => db.prepare('SELECT id FROM tarifas_cfe WHERE codigo = ?').get(codigo).id
    const insertarBloque = db.prepare(`
      INSERT OR IGNORE INTO tarifas_bloques (tarifa_id, temporada, orden, desde_kwh, hasta_kwh, precio_kwh)
      VALUES (?, ?, ?, ?, ?, NULL)
    `)
    const cargarBloques = (codigo, temporada, limites) => {
      const tarifaId = idTarifa(codigo)
      limites.forEach((hasta, indice) => insertarBloque.run(tarifaId, temporada, indice + 1, indice === 0 ? 0 : limites[indice - 1], hasta))
    }

    insertarTarifa.run('DAC', 'Doméstica de alto consumo (DAC)', 'dac', null, nota)
    insertarTarifa.run('1', 'Doméstica 1 (ejemplo)', 'domestica', 250, nota)
    insertarTarifa.run('1C', 'Doméstica 1C (Nuevo León)', 'domestica', 850, nota)
    insertarTarifa.run('COM', 'Comercial (precio plano)', 'comercial', null, nota)
    db.prepare("UPDATE tarifas_cfe SET tarifa_dac_id = ? WHERE codigo IN ('1', '1C') AND tarifa_dac_id IS NULL").run(idTarifa('DAC'))

    cargarBloques('DAC', 'todo_el_anio', [null])
    cargarBloques('COM', 'todo_el_anio', [null])
    cargarBloques('1', 'todo_el_anio', [75, 140, null])
    cargarBloques('1C', 'verano', [150, 300, 450, null])
    cargarBloques('1C', 'fuera_verano', [75, 175, null])

    const asignarEstado = db.prepare('INSERT OR IGNORE INTO tarifas_estados (estado_codigo, tarifa_id) VALUES (?, ?)')
    for (const { codigo } of ESTADOS_MEXICO) asignarEstado.run(codigo, idTarifa(codigo === 'MX-NLE' ? '1C' : '1'))

    const insertarParametro = db.prepare('INSERT OR IGNORE INTO parametros_ahorro (clave, valor, descripcion) VALUES (?, ?, ?)')
    insertarParametro.run('eficiencia', 0.8, 'Eficiencia global del sistema (pérdidas por temperatura, cableado, inversor y suciedad)')
    insertarParametro.run('degradacion_anual', 0.005, 'Pérdida anual de generación de los paneles')
    insertarParametro.run('alza_tarifa_anual', 0, 'Incremento anual supuesto de la tarifa eléctrica')
    insertarParametro.run('iva', 0.16, 'IVA aplicado al recibo de CFE')
    insertarParametro.run('meses_verano', 6, 'Meses de temporada de verano en tarifas con dos temporadas')

    db.exec('PRAGMA user_version = 3;')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const prospectSelect = `
  SELECT
    p.id,
    p.nombre,
    p.empresa,
    p.telefono,
    p.email,
    p.estado,
    d.estado AS direccion_estado,
    d.estado_codigo AS direccion_estado_codigo,
    d.municipio AS direccion_municipio,
    d.colonia AS direccion_colonia,
    d.codigo_postal AS direccion_codigo_postal,
    d.calle AS direccion_calle,
    d.numero_exterior AS direccion_numero_exterior,
    d.numero_interior AS direccion_numero_interior,
    c.consumo_kwh,
    c.ciudad,
    c.perdidas,
    s.id AS solicitud_id,
    s.modalidad,
    s.consumo_diario_kwh,
    s.consumo_mensual_kwh,
    s.consumo_introducido_kwh,
    s.margen_crecimiento_pct,
    s.consumo_objetivo_kwh,
    s.consumo_diurno_kwh,
    s.consumo_nocturno_kwh,
    s.potencia_conectada_w,
    s.cubrir_baterias,
    s.cobertura_nocturna_pct,
    s.estimacion_consumo_nocturno_pct,
    s.necesidad_bateria_kwh_dia,
    s.incluir_interconexion,
    s.created_at AS solicitud_fecha,
    s.estado_flujo,
    s.agente_responsable_id,
    u.nombre AS agente_responsable,
    rt.id AS revision_tecnica_id,
    rt.estado AS revision_tecnica_estado,
    rt.tecnico_id AS tecnico_responsable_id,
    rt.tomada_at AS revision_tomada_at,
    rt.completada_at AS revision_completada_at,
    tecnico.nombre AS tecnico_responsable,
    (SELECT motivo FROM revision_tecnica_devoluciones
      WHERE revision_id = rt.id ORDER BY id DESC LIMIT 1) AS revision_ultimo_motivo_devolucion,
    (SELECT devuelta_at FROM revision_tecnica_devoluciones
      WHERE revision_id = rt.id ORDER BY id DESC LIMIT 1) AS revision_ultima_devolucion_at,
    cv.id AS cotizacion_version_id,
    cv.version AS cotizacion_version,
    cv.precio_venta,
    cv.emitida_at AS cotizacion_emitida_at,
    (SELECT periodo FROM historial_cfe WHERE solicitud_id = s.id ORDER BY id LIMIT 1) AS recibo_periodo,
    (SELECT mes_inicio FROM historial_cfe WHERE solicitud_id = s.id ORDER BY id LIMIT 1) AS recibo_mes_inicio
  FROM prospectos p
  LEFT JOIN direcciones_cliente d ON d.prospecto_id = p.id
  LEFT JOIN consumos_prospecto c ON c.prospecto_id = p.id
  LEFT JOIN solicitudes_cotizacion s ON s.id = (
    SELECT id
    FROM solicitudes_cotizacion
    WHERE prospecto_id = p.id
    ORDER BY id DESC
    LIMIT 1
  )
  LEFT JOIN usuarios_personal u ON u.id = s.agente_responsable_id
  LEFT JOIN revisiones_tecnicas rt ON rt.solicitud_id = s.id
  LEFT JOIN usuarios_personal tecnico ON tecnico.id = rt.tecnico_id
  LEFT JOIN cotizaciones_versiones cv ON cv.id = (
    SELECT id FROM cotizaciones_versiones
    WHERE solicitud_id = s.id ORDER BY version DESC LIMIT 1
  )
`

export function getProspecto(id) {
  return db.prepare(`${prospectSelect} WHERE p.id = ?`).get(id)
}

export function seedDemoData() {
  const demo = db.prepare(`
    SELECT id
    FROM prospectos
    WHERE nombre = ? AND telefono = ?
  `).get('Erik Aguilar Martínez', '81-1234-5678')

  db.exec('BEGIN')
  try {
    const prospectoId = demo?.id ?? Number(db.prepare(`
      INSERT INTO prospectos (nombre, empresa, telefono, estado)
      VALUES (?, ?, ?, ?)
    `).run('Erik Aguilar Martínez', 'Sunrise Energy', '81-1234-5678', 'Nuevo').lastInsertRowid)

    db.prepare(`
      INSERT OR IGNORE INTO consumos_prospecto
        (prospecto_id, consumo_kwh, ciudad, perdidas)
      VALUES (?, ?, ?, ?)
    `).run(prospectoId, 850, 'Monterrey', 80)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

seedDemoData()

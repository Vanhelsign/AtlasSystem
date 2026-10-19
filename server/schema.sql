PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS prospectos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  empresa TEXT,
  telefono TEXT,
  email TEXT,
  estado TEXT NOT NULL DEFAULT 'Nuevo',
  etapa_cliente TEXT NOT NULL DEFAULT 'prospecto' CHECK (etapa_cliente IN ('prospecto', 'cliente_instalado')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usuarios_personal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  telefono TEXT NOT NULL,
  zona_trabajo TEXT,
  estado_trabajo_codigo TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('Administrador', 'Agente', 'Técnico')),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS productos_catalogo (
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

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nombre)) > 0),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consumos_prospecto (
  prospecto_id INTEGER PRIMARY KEY,
  consumo_kwh REAL NOT NULL CHECK (consumo_kwh > 0),
  ciudad TEXT NOT NULL DEFAULT 'Monterrey',
  perdidas INTEGER NOT NULL DEFAULT 80 CHECK (perdidas BETWEEN 1 AND 100),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospecto_id) REFERENCES prospectos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cuentas_cliente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospecto_id INTEGER NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'Cliente',
  -- 1 = al iniciar sesión solo puede cambiar su contraseña (contraseña temporal).
  debe_cambiar_password INTEGER NOT NULL DEFAULT 0 CHECK (debe_cambiar_password IN (0, 1)),
  password_actualizada_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospecto_id) REFERENCES prospectos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS direcciones_cliente (
  prospecto_id INTEGER PRIMARY KEY,
  estado TEXT NOT NULL,
  estado_codigo TEXT,
  municipio TEXT NOT NULL,
  colonia TEXT NOT NULL,
  codigo_postal TEXT NOT NULL,
  calle TEXT NOT NULL,
  numero_exterior TEXT NOT NULL,
  numero_interior TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospecto_id) REFERENCES prospectos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS solicitudes_cotizacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospecto_id INTEGER NOT NULL,
  modalidad TEXT NOT NULL CHECK (modalidad IN ('historial_cfe', 'electrodomesticos')),
  consumo_diario_kwh REAL NOT NULL CHECK (consumo_diario_kwh > 0),
  consumo_mensual_kwh REAL NOT NULL CHECK (consumo_mensual_kwh > 0),
  consumo_introducido_kwh REAL,
  margen_crecimiento_pct INTEGER,
  consumo_objetivo_kwh REAL,
  consumo_diurno_kwh REAL,
  consumo_nocturno_kwh REAL,
  potencia_conectada_w REAL,
  cubrir_baterias INTEGER NOT NULL CHECK (cubrir_baterias IN (0, 1)),
  cobertura_nocturna_pct INTEGER,
  estimacion_consumo_nocturno_pct INTEGER,
  necesidad_bateria_kwh_dia REAL,
  incluir_interconexion INTEGER NOT NULL DEFAULT 0 CHECK (incluir_interconexion IN (0, 1)),
  ciudad TEXT NOT NULL,
  eficiencia_pct INTEGER NOT NULL DEFAULT 80 CHECK (eficiencia_pct BETWEEN 1 AND 100),
  estado_flujo TEXT NOT NULL DEFAULT 'pendiente_revision_tecnica' CHECK (estado_flujo IN (
    'informacion_incompleta', 'pendiente_revision_tecnica', 'en_preparacion',
    'pendiente_respuesta', 'aceptada_pendiente_pago', 'venta_confirmada'
  )),
  agente_responsable_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospecto_id) REFERENCES prospectos(id) ON DELETE CASCADE,
  FOREIGN KEY (agente_responsable_id) REFERENCES usuarios_personal(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS historial_cfe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  consumo_kwh REAL NOT NULL CHECK (consumo_kwh > 0),
  periodo TEXT NOT NULL CHECK (periodo IN ('mensual', 'bimestral')),
  mes_inicio TEXT NOT NULL,
  mes_fin TEXT NOT NULL,
  dias_periodo INTEGER NOT NULL CHECK (dias_periodo > 0),
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_cotizacion(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS electrodomesticos_solicitud (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  potencia_w REAL NOT NULL CHECK (potencia_w > 0),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  horario TEXT NOT NULL CHECK (horario IN ('dia', 'noche', 'ambos')),
  horas_dia REAL NOT NULL DEFAULT 0 CHECK (horas_dia >= 0),
  horas_noche REAL NOT NULL DEFAULT 0 CHECK (horas_noche >= 0),
  consumo_dia_kwh REAL NOT NULL DEFAULT 0,
  consumo_noche_kwh REAL NOT NULL DEFAULT 0,
  consumo_total_kwh REAL NOT NULL CHECK (consumo_total_kwh > 0),
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_cotizacion(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS revisiones_tecnicas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL UNIQUE,
  tecnico_id INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en_revision' CHECK (estado IN ('en_revision', 'completada')),
  tomada_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completada_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_cotizacion(id) ON DELETE CASCADE,
  FOREIGN KEY (tecnico_id) REFERENCES usuarios_personal(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS revision_tecnica_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL,
  producto_id INTEGER NOT NULL,
  producto_codigo TEXT NOT NULL,
  tipo_aplicado TEXT NOT NULL,
  modelo_aplicado TEXT NOT NULL,
  clasificacion_aplicada TEXT NOT NULL CHECK (clasificacion_aplicada IN ('material', 'servicio')),
  costo_unitario_aplicado REAL NOT NULL CHECK (costo_unitario_aplicado >= 0),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0 AND typeof(cantidad) = 'integer'),
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (revision_id, producto_id),
  FOREIGN KEY (revision_id) REFERENCES revisiones_tecnicas(id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos_catalogo(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS revisiones_tecnico_idx ON revisiones_tecnicas(tecnico_id, estado);
CREATE INDEX IF NOT EXISTS revision_items_revision_idx ON revision_tecnica_items(revision_id);

CREATE TABLE IF NOT EXISTS revision_tecnica_devoluciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL,
  agente_id INTEGER NOT NULL,
  motivo TEXT NOT NULL CHECK (length(trim(motivo)) > 0),
  revision_completada_at TEXT,
  devuelta_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atendida_at TEXT,
  FOREIGN KEY (revision_id) REFERENCES revisiones_tecnicas(id) ON DELETE CASCADE,
  FOREIGN KEY (agente_id) REFERENCES usuarios_personal(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS cotizaciones_versiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  agente_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  costo_interno_total REAL NOT NULL CHECK (costo_interno_total >= 0),
  precio_venta REAL NOT NULL CHECK (precio_venta > 0),
  ahorro_anual_est REAL CHECK (ahorro_anual_est IS NULL OR ahorro_anual_est >= 0),
  retorno_inversion_anios REAL CHECK (retorno_inversion_anios IS NULL OR retorno_inversion_anios >= 0),
  supuestos_ahorro TEXT CHECK (supuestos_ahorro IS NULL OR json_valid(supuestos_ahorro)),
  estado TEXT NOT NULL DEFAULT 'enviada' CHECK (estado IN ('enviada')),
  estatus_respuesta TEXT NOT NULL DEFAULT 'pendiente' CHECK (estatus_respuesta IN (
    'pendiente', 'aprobada', 'rechazada', 'pago_vencido'
  )),
  emitida_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (solicitud_id, version),
  FOREIGN KEY (solicitud_id) REFERENCES solicitudes_cotizacion(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES revisiones_tecnicas(id) ON DELETE RESTRICT,
  FOREIGN KEY (agente_id) REFERENCES usuarios_personal(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS cotizacion_version_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL,
  producto_codigo TEXT NOT NULL,
  tipo TEXT NOT NULL,
  modelo TEXT NOT NULL,
  clasificacion TEXT NOT NULL CHECK (clasificacion IN ('material', 'servicio')),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0 AND typeof(cantidad) = 'integer'),
  costo_unitario_interno REAL NOT NULL CHECK (costo_unitario_interno >= 0),
  subtotal_interno REAL NOT NULL CHECK (subtotal_interno >= 0),
  FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones_versiones(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS devoluciones_revision_idx ON revision_tecnica_devoluciones(revision_id, devuelta_at);
CREATE INDEX IF NOT EXISTS cotizaciones_solicitud_idx ON cotizaciones_versiones(solicitud_id, version);

CREATE TABLE IF NOT EXISTS firmas_cotizacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL UNIQUE,
  cuenta_cliente_id INTEGER NOT NULL,
  firma_png_b64 TEXT NOT NULL CHECK (length(firma_png_b64) > 0),
  direccion_ip TEXT,
  user_agent TEXT,
  firmada_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones_versiones(id) ON DELETE RESTRICT,
  FOREIGN KEY (cuenta_cliente_id) REFERENCES cuentas_cliente(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ordenes_instalacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL UNIQUE,
  tecnico_id INTEGER,
  fecha_programada TEXT,
  fecha_fin_real TEXT,
  estatus_obra TEXT NOT NULL DEFAULT 'asignada' CHECK (estatus_obra IN (
    'asignada', 'en_progreso', 'incidencia', 'completada'
  )),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (estatus_obra <> 'completada' OR fecha_fin_real IS NOT NULL),
  FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones_versiones(id) ON DELETE RESTRICT,
  FOREIGN KEY (tecnico_id) REFERENCES usuarios_personal(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS checklist_evidencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id INTEGER NOT NULL,
  etapa TEXT NOT NULL CHECK (etapa IN (
    'estructura', 'paneles', 'inversor', 'cableado', 'baterias', 'interconexion', 'pruebas'
  )),
  completado INTEGER NOT NULL DEFAULT 0 CHECK (completado IN (0, 1)),
  ruta_foto TEXT,
  observaciones TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (orden_id) REFERENCES ordenes_instalacion(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mantenimientos_programados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id INTEGER NOT NULL,
  tipo_servicio TEXT NOT NULL CHECK (tipo_servicio IN ('semestral', 'anual')),
  fecha_limite TEXT NOT NULL,
  estatus TEXT NOT NULL DEFAULT 'pendiente' CHECK (estatus IN ('pendiente', 'agendado', 'realizado', 'vencido')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (orden_id, tipo_servicio),
  FOREIGN KEY (orden_id) REFERENCES ordenes_instalacion(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS registro_notificaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospecto_id INTEGER,
  destinatario_email TEXT NOT NULL,
  tipo_correo TEXT NOT NULL CHECK (tipo_correo IN ('credenciales', 'cotizacion_lista', 'recordatorio')),
  estado_envio TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_envio IN ('pendiente', 'aceptado', 'fallido', 'entregado')),
  detalle_error TEXT,
  enviado_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (prospecto_id) REFERENCES prospectos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ordenes_tecnico_idx ON ordenes_instalacion(tecnico_id, estatus_obra);
CREATE INDEX IF NOT EXISTS checklist_orden_idx ON checklist_evidencias(orden_id);
CREATE INDEX IF NOT EXISTS mantenimientos_fecha_idx ON mantenimientos_programados(estatus, fecha_limite);
CREATE INDEX IF NOT EXISTS notificaciones_prospecto_idx ON registro_notificaciones(prospecto_id, created_at);

-- Integración 6: tarifas CFE por bloques y parámetros para estimar ahorro y retorno de inversión.
-- Los precios se guardan sin IVA. Un precio o cargo fijo vacío (NULL) significa "todavía no capturado".
CREATE TABLE IF NOT EXISTS tarifas_cfe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(codigo)) > 0),
  nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
  tipo TEXT NOT NULL CHECK (tipo IN ('domestica', 'dac', 'comercial')),
  limite_dac_kwh REAL CHECK (limite_dac_kwh IS NULL OR limite_dac_kwh > 0),
  tarifa_dac_id INTEGER REFERENCES tarifas_cfe(id) ON DELETE SET NULL,
  cargo_fijo_mensual REAL CHECK (cargo_fijo_mensual IS NULL OR cargo_fijo_mensual >= 0),
  origen_cargo_fijo TEXT CHECK (origen_cargo_fijo IS NULL OR origen_cargo_fijo IN ('prueba', 'recibo')),
  vigencia_desde TEXT,
  activa INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  pendiente_validar INTEGER NOT NULL DEFAULT 1 CHECK (pendiente_validar IN (0, 1)),
  notas TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tarifas_bloques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tarifa_id INTEGER NOT NULL,
  temporada TEXT NOT NULL DEFAULT 'todo_el_anio' CHECK (temporada IN ('todo_el_anio', 'verano', 'fuera_verano')),
  orden INTEGER NOT NULL CHECK (orden BETWEEN 1 AND 4),
  desde_kwh REAL NOT NULL CHECK (desde_kwh >= 0),
  hasta_kwh REAL CHECK (hasta_kwh IS NULL OR hasta_kwh > desde_kwh),
  precio_kwh REAL CHECK (precio_kwh IS NULL OR precio_kwh >= 0),
  -- Origen del precio: 'prueba' (dato de prueba) o 'recibo' (tomado de un recibo); NULL = sin especificar.
  origen_precio TEXT CHECK (origen_precio IS NULL OR origen_precio IN ('prueba', 'recibo')),
  UNIQUE (tarifa_id, temporada, orden),
  FOREIGN KEY (tarifa_id) REFERENCES tarifas_cfe(id) ON DELETE CASCADE
);

-- Tarifa propuesta por defecto según el estado de la dirección. RESTRICT impide borrar una tarifa asignada.
CREATE TABLE IF NOT EXISTS tarifas_estados (
  estado_codigo TEXT PRIMARY KEY,
  tarifa_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tarifa_id) REFERENCES tarifas_cfe(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS parametros_ahorro (
  clave TEXT PRIMARY KEY CHECK (clave IN ('eficiencia', 'degradacion_anual', 'alza_tarifa_anual', 'iva', 'meses_verano')),
  valor REAL NOT NULL,
  descripcion TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS tarifas_bloques_tarifa_idx ON tarifas_bloques(tarifa_id, temporada, orden);

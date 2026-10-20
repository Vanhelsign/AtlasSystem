# Registro de cambios de ATLAS CRM

Entradas de la más reciente a la más antigua. Cada una indica commit o estado, qué se hizo y por qué, archivos, base de datos, rutas de la API, decisiones, limitaciones y cómo probarlo.

Reglas del archivo: no incluir contraseñas reales, correos reales, datos de recibos de CFE (nombres, direcciones, números de servicio) ni secretos. Los usuarios de demostración (`admin@atlas.com`, `ventas@atlas.com`, `tecnico@atlas.com`) y la contraseña `123` sí pueden aparecer.

Fuentes de la reconstrucción: `git log`, `git diff --stat` y el código actual. Lo que no consta en el código o en git se marca como "no consta".

Contenido:

- Supuestos pendientes de validar
- Limitaciones conocidas
- Mapa de rutas de la API
- Esquema de la base de datos
- Historial

---

## Supuestos pendientes de validar

Se mantiene al día con cada cambio.

Tarifas y ahorro (Integración 6):

- Precios por kWh y cargos fijos de las tarifas 1, 1C, DAC y COM: se cargaron vacíos y "pendientes de validar". Se capturan desde la app con un recibo de CFE.
- Límites de los bloques de ejemplo: 1 (75 / 140 kWh), 1C verano (150 / 300 / 450 kWh), 1C fuera de verano (75 / 175 kWh). Son estructura de ejemplo.
- Límites DAC: 250 kWh/mes para la tarifa 1 y 850 kWh/mes para la 1C.
- Asignación de tarifa por estado: 31 estados con la tarifa de ejemplo "1" y Nuevo León con "1C".
- Parámetros: eficiencia 0.80, degradación 0.5 % anual, alza de tarifa 0 % anual, IVA 16 %, 6 meses de verano.
- Simplificaciones del cálculo, también mostradas al cliente en "Ahorro e inversión":
  - generación mensual uniforme (sin estacionalidad);
  - cálculo mensual aunque el recibo sea bimestral;
  - DAC evaluado con un solo mes, no con el promedio de 12 meses de CFE;
  - sin cobro mínimo ni derecho de alumbrado público;
  - potencia de los paneles tomada del catálogo al aprobar la cotización;
  - la energía excedente no se paga ni se acumula.
- Precios con origen "sin especificar": las tarifas que tenían precios antes de la Fase 2 (commit `4ad4702`) quedaron así hasta que se editen.

Irradiación solar:

- `shared/irradiacion.js` contiene horas solares pico consultadas en PVGIS 5.3 con la base PVGIS-ERA5 (2005–2023), plano con inclinación óptima, en la capital de cada estado. Fecha de consulta registrada: 2026-10-19. Entraron en el commit `6e5e658`.
- Las coordenadas de las capitales en `scripts/cargar-irradiacion.mjs` son aproximadas (alrededor de 0.05°).
- ERA5 es un reanálisis climático; su precisión es menor que la de bases satelitales. Conviene compararlo con una fuente local.
- La capital representa a todo el estado.

Seguridad:

- Límites del login: 5 intentos fallidos por cuenta y 20 por IP, en una ventana de 15 minutos. Son valores iniciales; se pueden ajustar con `ATLAS_LOGIN_MAX_CUENTA`, `ATLAS_LOGIN_MAX_IP` y `ATLAS_LOGIN_VENTANA_MIN`.
- Límite del cambio de contraseña del cliente: 5 contraseñas actuales incorrectas en 10 minutos por cuenta (valor fijo en el código).
- `trust proxy: 'loopback'` supone que, en desarrollo, el único proxy es el de Vite en la misma máquina.

Correo (Fase 4):

- Enlace "Crea tu contraseña": token de 32 bytes, vigencia de 48 horas y 10 tokens no válidos por IP en 15 minutos. Son valores iniciales, ajustables con `ATLAS_ENLACE_VIGENCIA_HORAS` y `ATLAS_ENLACE_MAX_IP`.
- Tiempo máximo de 15 s por envío.
- Remitente por defecto `ATLAS CRM <no-responder@atlas.example>` y `APP_URL` por defecto `http://localhost:5173`, mientras no se configuren en `.env`.
- "Aceptado" significa que el servidor SMTP recibió el mensaje, no que llegó al buzón. `entregado` no se usa.
- El correo de "cotización lista" va a la cuenta de cliente; si no existe, al correo del prospecto.
- Reenvíos y reintentos: 3 por hora por cuenta de cliente, sumando ambos (`ATLAS_REENVIO_MAX_HORA`). Valor inicial.

Papelera de clientes:

- Los registros en la papelera no vencen: se quedan ahí hasta que un administrador los restaure o los elimine definitivamente.
- Motivo de eliminación opcional, de hasta 500 caracteres.

Otros:

- Inventario: el CSV conserva la columna `estado` del documento (Activo/Inactivo); la interfaz la muestra como "Estatus" y la importación acepta también `estatus`.

## Limitaciones conocidas

Se mantiene al día con cada cambio.

Seguridad y sesiones:

- Las sesiones viven en memoria: se pierden al reiniciar el servidor, incluido cada reinicio de `node --watch`. No tienen caducidad ni renovación.
- Los contadores de intentos (login por cuenta y por IP, y cambio de contraseña) viven en memoria: se borran al reiniciar el servidor o con `node --watch`. En desarrollo, reiniciar el backend desbloquea las cuentas.
- El bloqueo por cuenta permite que otra persona bloquee una cuenta ajena durante la ventana de 15 minutos con solo fallar el login con ese correo. Es el costo de impedir que se adivine la contraseña.
- Una red compartida (oficina, escuela, NAT) puede agotar entre varias personas el límite de 20 fallos por IP y bloquear el login para todos los que salen por esa IP durante la ventana.
- `trust proxy` está configurado como `'loopback'`: solo se acepta `X-Forwarded-For` de un proxy en la misma máquina (el de Vite en desarrollo). En producción, detrás de otro proxy o balanceador, hay que ajustarlo a la IP o subred de ese proxy; si no, todas las peticiones contarán como la IP del proxy y el límite por IP se volverá global.
- Los tokens cerrados por un cambio de contraseña se recuerdan en memoria hasta 24 horas para explicar el motivo del 401. Tras un reinicio del servidor ese motivo se pierde y el mensaje es el genérico ("Tu sesión se cerró").
- El login revisa si una cuenta de personal está inactiva antes de verificar la contraseña: responder "La cuenta está inactiva" revela que ese correo existe. Comportamiento existente desde el commit inicial; no se cambió.
- El indicador "debe cambiar contraseña" se lee al iniciar sesión: una sesión abierta antes de activarlo no se bloquea.
- El personal de demostración y las cuentas de cliente creadas antes de la Fase 4 usan la contraseña `123`, sin cambio obligatorio (decisión explícita). Las cuentas de cliente nuevas reciben un enlace para crear su contraseña.
- El enlace del correo apunta a `APP_URL`. Con el valor por defecto (`http://localhost:5173`) solo funciona en la máquina que corre la app; para que un cliente lo abra desde otro equipo, `APP_URL` debe ser una dirección pública o de la red local.
- Si el enlace vence (48 horas) o el correo de una cuenta nueva falla, el cliente queda sin acceso hasta que el agente responsable o el administrador reenvíen el enlace (Fase 4b).
- En modo simulado, cada `.eml` de credenciales contiene el enlace con su token en texto claro dentro de `data/correos/`; es la única copia fuera del correo real. La carpeta está en `.gitignore`, pero cualquiera con acceso a la máquina puede leerla y usar el enlace mientras esté vigente; conviene vaciarla cuando ya no se necesite.
- Las cuentas creadas con la primera versión de la Fase 4a (commit `7c059c7`) tienen una contraseña temporal en su `.eml`; no se migraron. Como tienen la marca "debe cambiar contraseña", el botón "Reenviar enlace de acceso" les aparece, y su contraseña temporal vieja sigue funcionando hasta que la cambien (con el enlace o con "Crea tu nueva contraseña").
- El límite de reenvíos (3 por hora por cuenta, sumando reenvíos y reintentos) vive en memoria: se borra al reiniciar el servidor, también con `node --watch`.
- El límite de enlaces no válidos es por IP y vive en memoria, igual que los del login: se borra al reiniciar el servidor y una red compartida lo agota entre todos.

Funcionalidad:

- La calculadora (`CalculadoraSolar`) no tiene ningún acceso desde los menús; solo se llega por código. Su código se conserva. La ruta que usa (`PUT /api/prospectos/:id/consumo`) ahora exige sesión de Administrador o Agente, y la calculadora ya enviaba el token.
- Tickets técnicos, reactivación comercial y evidencias fotográficas siguen en memoria del navegador (`useState`); la evidencia es simulada.
- El recordatorio de mantenimiento no tiene disparador porque el módulo de mantenimientos no existe, y en la pantalla Notificaciones no se puede reintentar.
- Reintentar reutiliza la misma fila de `registro_notificaciones` (sube `intentos`); no queda historial de cada intento por separado. Un reenvío desde el detalle sí crea una fila nueva.
- La pantalla Notificaciones muestra hasta 50 por página, sin búsqueda por destinatario.
- El envío ocurre dentro de la petición, después del COMMIT: con SMTP lento, el registro de una solicitud o la aprobación pueden tardar hasta el tiempo máximo (15 s) antes de responder.
- `detalle_error` también guarda el detalle "Modo simulado…" de los correos simulados, que no son errores. La tabla no tiene una columna de detalle aparte.
- Las tablas `firmas_cotizacion`, `ordenes_instalacion`, `checklist_evidencias` y `mantenimientos_programados` existen desde la Fase A, pero ninguna ruta las usa todavía.
- En "Editar tarifa", lo escrito en "Desde un recibo" sin pulsar "Aplicar" no cuenta como cambio sin guardar.
- `README.md` no se ha actualizado desde el commit inicial: no describe las integraciones 2 y 6 ni las fases recientes.
- `server/index.js` solo importa `api.js` y conserva código antiguo comentado.
- `npm audit` reporta 14 vulnerabilidades (11 altas, 2 moderadas, 1 baja), todas en herramientas de desarrollo: Vite 8.0.x, Tailwind 3, PostCSS, Babel y sus dependencias. `npm audit --omit=dev` da 0. Revisado de nuevo el 2026-10-19 al instalar `nodemailer`. Se atenderán después de la Fase 4 con `npm audit fix` sin `--force`; `braces` (vía Tailwind 3) solo se corrige pasando a `tailwindcss@4`, que no se hará.

Papelera y eliminación definitiva:

- Cada eliminación definitiva crea un respaldo completo de la base en `data/backups/`, que **conserva los datos del cliente eliminado** (nombre, correo, dirección, solicitudes). Los respaldos no se borran solos: hay que limpiarlos a mano cuando ya no se necesiten.
- En Windows, si la ruta completa del respaldo supera unos 260 caracteres, `VACUUM INTO` falla ("unable to open database") y no se elimina nada. Con la ruta actual del proyecto (unos 160 caracteres) no ocurre.
- Siguen existiendo otros borrados físicos aprobados antes, de otras entidades: proveedores, tarifas y el reemplazo de tokens al emitir uno nuevo. En clientes y estimaciones, el único DELETE es la eliminación definitiva.
- Un cliente sin correo (como el prospecto de demostración) se confirma escribiendo su nombre.
- El prospecto de demostración (`seedDemoData`) se vuelve a crear en cada arranque si no existe: si se elimina definitivamente, reaparece al reiniciar el servidor. Si solo está en la papelera, se queda ahí.
- Solo se borran los `.eml` registrados en `registro_notificaciones.archivo`. Si alguien copió o movió un `.eml` fuera de `data/correos/`, esa copia queda.
- La interfaz solo crea una solicitud por cliente; varias solicitudes por cliente (y por tanto "eliminar aparte" y luego restaurar al cliente) se probaron insertando la segunda en la base de prueba.

Datos:

- Una dirección capturada antes de la corrección de estados puede tener el texto del estado dañado por codificación (por ejemplo, una "ó" sustituida); se muestra el nombre oficial a partir de `estado_codigo`, sin reescribir el texto.

---

## Mapa de rutas de la API

Base: `http://localhost:3001/api` (en desarrollo, Vite reenvía `/api` y agrega `X-Forwarded-For`). Todas las rutas salvo `GET /api/health`, `POST /api/login`, `POST /api/portal/validar-enlace` y `POST /api/portal/crear-contrasena` requieren `Authorization: Bearer <token>`.

Respuestas comunes:

- 401 sin sesión válida, con `codigo`:
  - `contrasena_cambiada`: la sesión se cerró porque la contraseña se cambió en otra sesión;
  - `sesion_vencida`: cualquier otro caso.

  El frontend vuelve al login con un aviso ante cualquiera de los dos.
- 403 con `codigo: debe_cambiar_password`: la cuenta de cliente tiene la marca de cambio obligatorio. Toda ruta responde así salvo `POST /api/portal/cambiar-contrasena` y `POST /api/logout`.

| Método | Ruta | Rol permitido | Propósito |
|---|---|---|---|
| GET | /api/health | Público | Estado del servidor |
| POST | /api/login | Público | Inicia sesión de personal o cliente; devuelve token. 401 "Credenciales incorrectas"; 429 por límite de intentos (`codigo: limite_cuenta` o `limite_ip`) |
| POST | /api/logout | Cualquier sesión | Cierra la sesión actual |
| POST | /api/portal/validar-enlace | Público | Dice si el token del enlace "Crea tu contraseña" sigue vigente, sin consumirlo. 400 genérico `enlace_invalido`; 429 `limite_enlace` |
| POST | /api/portal/crear-contrasena | Público | Con token, contraseña y confirmación: consume el token (un solo uso), guarda la contraseña, cierra las sesiones de la cuenta y no inicia sesión. Errores por campo sin consumir el token; 400 genérico `enlace_invalido`; 429 `limite_enlace` |
| POST | /api/solicitudes/:id/reenviar-credenciales | Agente responsable, Administrador | Token nuevo (invalida el anterior), cierra sesiones y envía el enlace; responde `{ correo }` sin token. 409 `acceso_creado`; 429 `limite_reenvio`; 404 en papelera u otro agente |
| GET | /api/solicitudes/:id/notificaciones | Agente responsable, Administrador | Correos de la solicitud y `acceso_pendiente`. 404 en papelera u otro agente |
| GET | /api/notificaciones | Administrador | `?estado=&tipo=&pagina=`, 50 por página; clientes eliminados anonimizados |
| POST | /api/notificaciones/:id/reintentar | Administrador | Solo fallidas de clientes activos; misma fila (`intentos` + 1); credenciales con token nuevo. 409 con el motivo; 429 `limite_reenvio` |
| POST | /api/portal/cambiar-contrasena | Cliente | Cambia la contraseña; cierra las demás sesiones de la cuenta (su 401 dirá `contrasena_cambiada`); 429 tras 5 contraseñas actuales incorrectas en 10 minutos |
| GET | /api/portal/prospectos/:id | Cliente (solo el suyo) | Datos del portal, solicitud y cotización emitida con su estimación de ahorro guardada |
| GET | /api/productos | Administrador, Agente, Técnico | Catálogo (el administrador ve también inactivos) |
| POST | /api/productos | Administrador | Crea producto o servicio |
| PATCH | /api/productos/:id | Administrador | Edita producto |
| PATCH | /api/productos/:id/activo | Administrador | Baja lógica (con motivo) o reactivación |
| POST | /api/productos/importacion/previsualizar | Administrador | Revisa filas de CSV o Excel sin guardar |
| POST | /api/productos/importacion/confirmar | Administrador | Aplica la importación en una sola transacción; 409 si el catálogo cambió |
| GET | /api/proveedores | Administrador, Agente, Técnico | Lista proveedores con productos ligados |
| POST | /api/proveedores | Administrador | Registra proveedor |
| PATCH | /api/proveedores/:id | Administrador | Renombra proveedor |
| PATCH | /api/proveedores/:id/activo | Administrador | Baja o reactivación |
| DELETE | /api/proveedores/:id | Administrador | Borrado permanente; sus productos quedan sin proveedor |
| GET | /api/tarifas | Administrador, Agente | Tarifas con bloques, asignación por estado y parámetros |
| POST | /api/tarifas | Administrador | Crea tarifa |
| PUT | /api/tarifas/:id | Administrador | Edita tarifa y bloques; valida origen de precios |
| DELETE | /api/tarifas/:id | Administrador | Borra tarifa (409 si está asignada a un estado o es DAC de otra) |
| PUT | /api/tarifas-estados/:codigo | Administrador | Asigna tarifa a un estado |
| PUT | /api/parametros-ahorro | Administrador | Edita parámetros de la estimación |
| GET | /api/personal | Administrador | Lista personal |
| POST | /api/personal | Administrador | Registra técnico o agente. 409 `correo_en_papelera` si el correo es de un cliente en la papelera |
| GET | /api/admin/clientes | Administrador | Lista de clientes `?estado=activos\|eliminados&q=` |
| GET | /api/admin/clientes/:id | Administrador | Detalle (también de la papelera) con solicitudes y conteos de impacto |
| POST | /api/admin/clientes/:id/eliminar | Administrador | Manda al cliente y sus solicitudes activas a la papelera (`{ motivo? }`); cierra sus sesiones y vence sus enlaces |
| POST | /api/admin/clientes/:id/restaurar | Administrador | Restaura al cliente y las solicitudes de su lote |
| POST | /api/admin/clientes/:id/eliminar-definitivamente | Administrador | `{ entiendo: true, confirmacion }`; solo desde la papelera (409 si no). Respaldo, borrado físico, notificaciones anonimizadas y `.eml` borrados |
| POST | /api/admin/solicitudes/:id/eliminar | Administrador | Manda una estimación a la papelera (`{ motivo? }`) |
| POST | /api/admin/solicitudes/:id/restaurar | Administrador | Restaura una estimación (409 si su cliente está en la papelera) |
| POST | /api/admin/solicitudes/:id/eliminar-definitivamente | Administrador | `{ entiendo: true }`; solo desde la papelera. Respaldo y borrado físico de la estimación |
| PATCH | /api/personal/:id/activo | Administrador | Activa o desactiva cuenta |
| PATCH | /api/personal/:id/estado-trabajo | Administrador | Asigna estado de trabajo |
| GET | /api/prospectos | Administrador, Agente (solo los suyos) | Lista prospectos y solicitudes |
| GET | /api/prospectos/:id | Administrador, Agente (solo los suyos) | Detalle de prospecto |
| POST | /api/prospectos | Administrador, Agente | Registra prospecto (ruta antigua; ninguna pantalla la usa) |
| PATCH | /api/prospectos/:id | Administrador, Agente | Actualiza prospecto (ruta antigua; ninguna pantalla la usa) |
| PUT | /api/prospectos/:id/consumo | Administrador, Agente | Consumo para la calculadora (sin acceso desde los menús) |
| POST | /api/solicitudes | Agente | Registra solicitud, dirección y cuenta del cliente (contraseña desconocida y marca de cambio) y emite el token del enlace; rechaza estados no reconocidos. Después del COMMIT envía el correo con el enlace y responde `correo` con su estado (nunca el enlace ni el token) |
| GET | /api/solicitudes/:id | Administrador, Agente (solo las suyas) | Detalle de solicitud |
| GET | /api/agente/solicitudes/:id/estimacion | Agente responsable | Vista previa del ahorro con la tarifa elegida o la sugerida |
| POST | /api/agente/solicitudes/:id/aprobar | Agente responsable | Emite la cotización y guarda la estimación de ahorro. Después del COMMIT avisa "cotización lista" y responde `correo` |
| POST | /api/agente/solicitudes/:id/devolver | Agente responsable | Devuelve la revisión al técnico con motivo |
| GET | /api/tecnico/solicitudes | Técnico | Solicitudes de su estado de trabajo |
| GET | /api/tecnico/solicitudes/:id | Técnico | Detalle con la misma restricción por estado |
| POST | /api/tecnico/solicitudes/:id/tomar | Técnico | Toma la solicitud |
| PUT | /api/tecnico/solicitudes/:id/borrador | Técnico responsable | Guarda materiales y servicios |
| POST | /api/tecnico/solicitudes/:id/completar | Técnico responsable | Completa la revisión técnica |

---

## Esquema de la base de datos

SQLite en `data/atlas.sqlite` (o `ATLAS_DB_PATH`). `server/schema.sql` crea lo que falta en cada arranque y `server/database.js` agrega columnas con `ALTER TABLE ... ADD COLUMN` si no existen. `PRAGMA user_version` solo se usa para pasos que deben correr una vez.

Versiones de `user_version`:

- 0: esquema sin versión (commit inicial `c57aaea` y Fase A `28fa1da`).
- 1: Fase B (`137a4dd`): reconstrucción de `productos_catalogo` para aceptar Batería y Extra y agregar `capacidad_kwh`, con respaldo previo en `data/backups/`.
- 2: Integración 2 v2 (`3783711`): carga única del catálogo y los proveedores iniciales.
- 3: Integración 6 (`6e5e658`): carga única de tarifas de ejemplo, asignación por estado y parámetros de ahorro.

Columnas agregadas sin cambiar `user_version` (idempotentes, en cada arranque):

- Fase A (`28fa1da`): `prospectos.etapa_cliente`; `productos_catalogo.marca` y `proveedor_id`; `cotizaciones_versiones.ahorro_anual_est`, `retorno_inversion_anios` y `estatus_respuesta`.
- Integración 6 (`6e5e658`): `cotizaciones_versiones.supuestos_ahorro` (JSON).
- Fase 2 del plan actual (`4ad4702`): `tarifas_bloques.origen_precio`, `tarifas_cfe.origen_cargo_fijo`.
- Fase 3 del plan actual (`861e96c`): `cuentas_cliente.debe_cambiar_password`, `password_actualizada_at`.
- Fase 4a (`7c059c7`): `registro_notificaciones.solicitud_id`, `intentos`, `ultimo_intento_at`, `archivo` e índice `notificaciones_solicitud_idx`.
- Cambio de la Fase 4a (`b09bf67`): tabla nueva `tokens_cuenta` (con `CREATE TABLE IF NOT EXISTS`, sin migración de columnas).
- Papelera de clientes (`527894e`): `prospectos` y `solicitudes_cotizacion` reciben `eliminado_at`, `eliminado_por`, `motivo_eliminacion` y `eliminacion_lote` (NULL por defecto), con índices `prospectos_eliminado_idx` y `solicitudes_eliminado_idx`.
- Corrección de estados (`2dd526a`): no agrega columnas; en cada arranque completa `direcciones_cliente.estado_codigo` cuando el texto se reconoce y reporta las que no.

Tablas y en qué commit aparecieron:

| Tabla | Desde | Uso actual |
|---|---|---|
| prospectos | c57aaea | Prospectos y clientes |
| usuarios_personal | c57aaea | Administrador, agentes y técnicos |
| productos_catalogo | c57aaea (reconstruida en user_version 1) | Catálogo de materiales y servicios |
| proveedores | c57aaea | Directorio de proveedores |
| consumos_prospecto | c57aaea | Consumo usado por la calculadora antigua |
| cuentas_cliente | c57aaea | Acceso de clientes al portal |
| direcciones_cliente | c57aaea | Dirección de instalación (una por prospecto) |
| solicitudes_cotizacion | c57aaea | Solicitud y análisis de consumo |
| historial_cfe | c57aaea | Recibo capturado en la solicitud |
| electrodomesticos_solicitud | c57aaea | Censo de aparatos |
| revisiones_tecnicas | c57aaea | Revisión del técnico |
| revision_tecnica_items | c57aaea | Materiales y servicios propuestos |
| revision_tecnica_devoluciones | c57aaea | Devoluciones del agente |
| cotizaciones_versiones | c57aaea | Cotización emitida y su estimación de ahorro |
| cotizacion_version_items | c57aaea | Copia de los renglones emitidos |
| firmas_cotizacion | 28fa1da | Sin uso todavía |
| ordenes_instalacion | 28fa1da | Sin uso todavía |
| checklist_evidencias | 28fa1da | Sin uso todavía |
| mantenimientos_programados | 28fa1da | Sin uso todavía |
| registro_notificaciones | 28fa1da | Correos de credenciales y de cotización lista, con su estado de envío (Fase 4a) |
| tarifas_cfe | 6e5e658 | Tarifas de CFE |
| tarifas_bloques | 6e5e658 | Bloques por temporada |
| tarifas_estados | 6e5e658 | Tarifa sugerida por estado |
| parametros_ahorro | 6e5e658 | Parámetros de la estimación |
| tokens_cuenta | b09bf67 | Hash de los tokens de un solo uso del enlace "Crea tu contraseña" |

---

## Historial

### Fase 4b: reenvío del enlace de acceso, pantalla "Notificaciones" y correos en el detalle

- Estado: **implementado. Sin commit.**
- Por qué: cerrar la Fase 4. Sin reenvío, un enlace vencido o un correo fallido dejaba al cliente sin acceso, y el administrador no tenía dónde ver ni reintentar los correos.
- Reenviar enlace de acceso:
  - botón "Reenviar enlace de acceso" en el bloque "Correos al cliente" del detalle de la solicitud (Cotizaciones Emitidas), visible para el agente responsable y el administrador, solo mientras el cliente no haya creado su contraseña (`debe_cambiar_password = 1`). Confirmación en `Modal`; el resultado se muestra con el aviso de correo existente (aceptado, modo simulado con su `.eml`, o ámbar si falla);
  - `POST /api/solicitudes/:id/reenviar-credenciales`: emite un token nuevo con `emitirTokenCuenta` (borra los anteriores), cierra las sesiones de la cuenta, envía el correo con el enlace y crea una fila nueva en `registro_notificaciones`. Responde `{ correo }`, sin token ni enlace;
  - 409 `acceso_creado` si el cliente ya creó su contraseña; 404 si la solicitud o el cliente están en la papelera; 404 para otro agente (igual que el detalle); 403 para el técnico.
- Límite: 3 envíos por hora por cuenta de cliente, sumando reenvíos y reintentos (`ATLAS_REENVIO_MAX_HORA`), en memoria. 429 `limite_reenvio`: "Ya se enviaron 3 correos a esta cuenta en la última hora. Espera N minutos e inténtalo de nuevo." Solo cuentan los envíos que se hacen; un 404 o un 409 no consumen cupo.
- Correos en el detalle: `GET /api/solicitudes/:id/notificaciones` (agente responsable o administrador; mismo filtro de papelera, 404) devuelve tipo, fechas, estado, intentos y detalle de cada correo de esa solicitud, y `acceso_pendiente` para decidir si se muestra el botón.
- Pantalla "Notificaciones" (solo Administrador; menú con el ícono ✉️):
  - tabla con número, destinatario (y nombre del cliente), tipo, fecha, estado, intentos y detalle; filtros por estado y tipo; 50 por página con "Anterior / Siguiente";
  - "Reintentar" solo en fallidas de clientes activos: credenciales emite un token nuevo (el anterior nunca se guardó) mientras el cliente no haya creado su contraseña; "cotización lista" reenvía el aviso si la solicitud tiene cotización. Reutiliza la misma fila (`intentos` + 1). Mismo límite que el reenvío;
  - las de clientes en la papelera aparecen con la etiqueta "En papelera" y sin reintento; las de clientes eliminados definitivamente aparecen con el destinatario anonimizado (`eliminado-<id>@anonimo.invalid`), sin nombre, sin detalle, sin solicitud y sin reintento;
  - `GET /api/notificaciones?estado=&tipo=&pagina=` y `POST /api/notificaciones/:id/reintentar` (409 con el motivo si no se puede reintentar).
- Lo que nunca aparece: ninguna respuesta de la API, fila de `registro_notificaciones`, texto de la interfaz ni salida del servidor contiene el token ni el enlace (comprobado en las pruebas y en el HTML de la página en la prueba de interfaz). Los avisos de la pantalla Notificaciones mencionan el número de notificación, nunca el correo, y los datos de clientes eliminados definitivamente ya llegan anonimizados desde el servidor.
- Base de datos: sin cambios de esquema. Se usan las columnas existentes de `registro_notificaciones` (`intentos`, `ultimo_intento_at`, `estado_envio`, `detalle_error`) y `tokens_cuenta`.
- Archivos: `src/Notificaciones.jsx`, `src/CorreosSolicitud.jsx`, `src/correosComunes.js`, `server/notificaciones.test.js`, `server/pruebas/smtpFalso.js` (nuevos; el SMTP falso se movió desde `correo.test.js` y ahora puede cambiar de modo); `server/api.js`, `server/correo.js` (`reintentarNotificacion`), `server/correo.test.js`, `src/App.jsx` (solo la entrada del menú, la sección y el bloque de correos del detalle, que contiene el botón).
- Pruebas (`server/notificaciones.test.js`, 13): reenvío válido con enlace anterior invalidado, correos en el detalle para agente y administrador, permisos (401, 403 técnico, 404 otro agente, 403 a la pantalla de administrador), agente que solo ve sus solicitudes, 409 si ya creó su contraseña, 404 con cliente o estimación en la papelera, límite de 3 sumando reenvío y reintento, reintento de credenciales (misma fila y token nuevo) y de cotización lista, sin reintento para papelera y eliminados (anonimizados), filtros y paginación, SMTP que rechaza y luego acepta al reintentar, y ningún token en respuestas, registros, `tokens_cuenta` ni consola. Base, correos y respaldos temporales.
- Cómo probar en la interfaz (modo simulado, sin `.env`):
  1. Como `ventas@atlas.com`, registra una solicitud y abre su detalle en Cotizaciones Emitidas: el bloque "Correos al cliente" muestra "Enlace de acceso · Pendiente" y el botón "Reenviar enlace de acceso".
  2. Reenvía: confirma en el modal; el aviso indica el `.eml` nuevo y la lista muestra dos correos. El enlace del primer `.eml` ya no sirve; el del segundo sí.
  3. Reenvía dos veces más: la cuarta vez en la misma hora responde con el mensaje del límite.
  4. Crea la contraseña con el último enlace y vuelve a abrir el detalle: el botón ya no aparece.
  5. Como `admin@atlas.com`, abre Notificaciones: filtra por estado y tipo. En modo simulado no hay fallidas; para ver "Reintentar", configura en `.env` un SMTP inalcanzable (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=9`), reinicia, registra una solicitud (queda "Fallido"), quita esas líneas, reinicia y pulsa "Reintentar".

### Clientes y papelera: borrado lógico, restauración y eliminación definitiva

- Estado: **implementado.** Commit `527894e`.
- Por qué: el administrador necesita gestionar clientes y estimaciones (por ejemplo, limpiar registros de prueba) sin perder información por error. Primero van a una papelera de la que se pueden restaurar; el borrado físico solo ocurre desde ahí y con confirmación explícita.
- Pantalla "Clientes" (solo Administrador; menú con el ícono 🗂️, visible con el menú contraído):
  - tabla con nombre, correo, estado geográfico, número de solicitudes, estatus de la solicitud más reciente y fecha de alta (o de eliminación y motivo en "Eliminados"), buscador por nombre o correo y selector "Activos / Eliminados";
  - modal de detalle con datos, cuenta del portal, dirección y solicitudes con su estatus, cotización emitida y, si están en la papelera, cuándo y por qué;
  - acciones: Eliminar cliente, Restaurar cliente, Eliminar estimación, Restaurar estimación y, en la papelera, Eliminar definitivamente;
  - cada confirmación indica cuántas solicitudes y cotizaciones se afectan y acepta un motivo opcional (máximo 500 caracteres, recortado); con motivo escrito, cerrar sin confirmar pide "¿Descartar los cambios?";
  - la eliminación definitiva muestra el conteo exacto por tipo de registro, avisa que se crea un respaldo con los datos del cliente y que los respaldos se limpian a mano, exige la casilla "Entiendo que no se puede deshacer" y, para clientes, escribir su correo (o su nombre si no tiene correo). El botón queda deshabilitado hasta cumplir ambas.
- Borrado lógico:
  - columnas `eliminado_at`, `eliminado_por`, `motivo_eliminacion` y `eliminacion_lote` en `prospectos` y `solicitudes_cotizacion`, todas NULL por defecto (no cambia datos existentes);
  - eliminar un cliente marca al cliente y a sus solicitudes activas con un mismo lote (UUID), en una transacción; restaurarlo solo restaura las solicitudes de ese lote, así que una estimación eliminada aparte sigue en la papelera. Eliminar una estimación sola no toca al cliente. Una estimación cuyo cliente está en la papelera no se puede restaurar sola (409: "restaura primero al cliente");
  - un cliente en la papelera no puede iniciar sesión (mismo 401 "Credenciales incorrectas"), se cierran sus sesiones y sus enlaces "Crea tu contraseña" pendientes vencen (UPDATE de `expira_at`, sin borrar); al restaurarlo, esos enlaces no reviven;
  - su correo queda reservado: el agente recibe "Ya existe un cliente con ese correo electrónico" (el mismo mensaje que para un cliente activo) y el administrador, al dar de alta personal con ese correo, recibe la explicación de la papelera (`codigo: correo_en_papelera`);
  - `registro_notificaciones`, las cotizaciones emitidas y sus copias no se modifican con el borrado lógico.
- Consultas filtradas (excluyen la papelera; con el id de un registro eliminado responden 404):
  - `prospectSelect` y `getProspecto` (`server/database.js`): excluyen clientes eliminados, y la subconsulta de la "solicitud más reciente" ignora las eliminadas. Cubren `GET /api/prospectos` (Cotizaciones Emitidas y dashboard, para agente y administrador), `GET /api/prospectos/:id` y las rutas antiguas `PATCH /api/prospectos/:id` y `PUT /api/prospectos/:id/consumo`;
  - `getSolicitud`: `GET /api/solicitudes/:id`, el portal del cliente y las respuestas de aprobar y devolver;
  - cola del técnico: `GET /api/tecnico/solicitudes`, `GET /api/tecnico/solicitudes/:id` (y por tanto borrador y completar) y la consulta propia de `POST …/tomar`;
  - estimación previa: `GET /api/agente/solicitudes/:id/estimacion` y `construirEstimacion`;
  - aprobar y devolver: sus consultas dentro de la transacción;
  - `GET /api/portal/prospectos/:id` (vía `getProspecto`), el login del cliente, `buscarTokenVigente` (enlaces "Crea tu contraseña") y el destinatario del correo "cotización lista".
  - No aplica: "Reactivación Comercial" usa datos de ejemplo en memoria del navegador, no la base. Las rutas de notificaciones por solicitud son de la Fase 4b y nacerán con el filtro.
- Eliminación definitiva (único borrado físico de clientes y estimaciones):
  - solo para registros que ya están en la papelera (409 si no);
  - antes de borrar crea un respaldo con `VACUUM INTO` en `data/backups/` (fuera de la transacción, porque SQLite no lo permite dentro). Si el respaldo falla, no se borra nada;
  - en una transacción `BEGIN IMMEDIATE` borra en este orden, porque hay llaves RESTRICT que la cascada no resuelve: `firmas_cotizacion` → `ordenes_instalacion` (con `checklist_evidencias` y `mantenimientos_programados` en cascada) → `cotizaciones_versiones` (con `cotizacion_version_items`; va antes de las revisiones por el RESTRICT de `revision_id`) → `revisiones_tecnicas` (con renglones y devoluciones) → `historial_cfe` → `electrodomesticos_solicitud` → `solicitudes_cotizacion`; para clientes, además `tokens_cuenta` → `cuentas_cliente` → `direcciones_cliente` → `consumos_prospecto` → `prospectos`;
  - `registro_notificaciones` se conserva: `prospecto_id` y `solicitud_id` quedan en NULL. Al eliminar un cliente, además `destinatario_email` pasa a `eliminado-<id>@anonimo.invalid` y `detalle_error` se vacía; tipo, estado, fechas, intentos y nombre de archivo se conservan. Al eliminar solo una estimación, el cliente sigue existiendo y no se anonimiza;
  - `PRAGMA foreign_key_check` antes del COMMIT; si encuentra filas o algo falla, ROLLBACK y el mensaje "Se deshizo todo y no se eliminó nada";
  - después del COMMIT se borran los `.eml` del cliente usando `registro_notificaciones.archivo`, solo si la ruta resuelta queda dentro de `data/correos/` (cualquier nombre que se salga, por ejemplo con `..`, se rechaza). Un fallo al borrar un archivo no deshace la base: se informa en la respuesta y en un aviso;
  - después, el correo queda libre para registrar otro cliente.
- Rutas nuevas (solo Administrador; 400 id inválido, 404 inexistente, 409 estado incorrecto): `GET /api/admin/clientes`, `GET /api/admin/clientes/:id`, `POST /api/admin/clientes/:id/eliminar`, `…/restaurar`, `…/eliminar-definitivamente`, `POST /api/admin/solicitudes/:id/eliminar`, `…/restaurar`, `…/eliminar-definitivamente`.
- Archivos: `server/papelera.js`, `server/papelera.test.js`, `src/Clientes.jsx` (nuevos); `server/api.js`, `server/database.js` (columnas, índices, filtro en `prospectSelect` y `respaldarBase` exportada), `server/correo.js` (`borrarArchivosCorreo`), `server/tokensCuenta.js`, `server/pruebas/servidorPrueba.js` (ayudantes de revisión y aprobación, movidos desde `correo.test.js`), `server/correo.test.js`, `src/App.jsx` (solo la entrada del menú, la sección y la recarga de prospectos al cambiar algo en Clientes).
- Base de datos: 4 columnas en `prospectos` y 4 en `solicitudes_cotizacion`, e índices `prospectos_eliminado_idx` y `solicitudes_eliminado_idx`. Patrón idempotente de `ALTER TABLE`; `user_version` sigue en 3.
- Pruebas (`server/papelera.test.js`, 12): solo Administrador (401/403), ids (400/404), eliminar y restaurar con conteos y 409, motivo de más de 500 caracteres, lote que no restaura lo eliminado aparte, login bloqueado con mensaje genérico, sesiones cerradas y enlaces invalidados, ocultamiento en cada pantalla y 404 en cada ruta filtrada, correo reservado y liberado tras la eliminación definitiva, 409 y confirmaciones de la eliminación definitiva, orden de borrado con firmas, órdenes, evidencias, mantenimientos y devoluciones insertados a mano, integridad (`foreign_key_check` vacío), respaldo creado, notificaciones conservadas y anonimizadas, `.eml` borrados (y uno con `../` rechazado), falla simulada a mitad que deshace todo, y eliminación definitiva de una sola estimación. La base, los correos y los respaldos viven en una carpeta temporal; la prueba compara antes y después la metadata de `data/backups/` y `data/correos/` reales.
- Cómo probar en la interfaz (como `admin@atlas.com`):
  1. Clientes → Ver detalle de un cliente → Eliminar cliente: revisa el conteo, escribe un motivo y prueba Escape (pide descartar); confirma. Desaparece de Activos y de Cotizaciones Emitidas, y ya no puede iniciar sesión.
  2. En un cliente activo, Eliminar estimación y luego Restaurar estimación: el cliente no cambia.
  3. Eliminados → Ver detalle → Restaurar cliente: vuelve con sus solicitudes.
  4. Elimínalo otra vez y, en Eliminados → Ver detalle → Eliminar definitivamente: revisa el conteo, marca la casilla y escribe su correo. Desaparece de la papelera, se crea un respaldo en `data/backups/` y su correo queda libre.

### Fase 4a, cambio: enlace "Crea tu contraseña" en lugar de contraseña temporal

- Estado: **implementado.** Commit `b09bf67`. Cambia el correo de credenciales de la entrada siguiente (Fase 4a, commit `7c059c7`). La Fase 4b sigue pendiente.
- Por qué: una contraseña temporal en el correo queda legible en el buzón y en cualquier reenvío. Un enlace de un solo uso con vencimiento reduce esa exposición, y la contraseña la elige solo el cliente.
- Diseño:
  - **cuentas nuevas:** se crean con una contraseña aleatoria de 32 bytes de la que solo se guarda el hash con sal; nadie la conoce. Quedan con `debe_cambiar_password = 1`. Ya no existe contraseña temporal en ningún lugar (se eliminó `generarContrasenaTemporal`);
  - **token:** `crypto.randomBytes(32)` en base64url. La base guarda solo su hash SHA-256 en `tokens_cuenta`. Vence a las 48 horas (`ATLAS_ENLACE_VIGENCIA_HORAS`). Emitir uno nuevo **borra** los anteriores de esa cuenta;
  - **enlace:** `APP_URL/#crear-contrasena=<token>`. El fragmento (#) no llega al servidor ni a los registros de acceso ni viaja en `Referer`. La app lo lee una sola vez al cargar (y en `hashchange`), lo quita de la barra con `history.replaceState` y muestra "Crea tu contraseña";
  - **abrir o validar el enlace no lo consume:** solo lo consume el envío del formulario;
  - **consumo atómico:** en una transacción `BEGIN IMMEDIATE`, un `UPDATE … WHERE usado_at IS NULL AND expira_at > ahora` marca el token; solo la petición que cambia exactamente una fila guarda la contraseña. Con dos envíos simultáneos, uno recibe 200 y el otro el error genérico;
  - **al crear la contraseña:** hash con sal nueva, apaga `debe_cambiar_password`, cierra las sesiones abiertas de esa cuenta y **no** inicia sesión. La app vuelve al login con "Contraseña creada. Inicia sesión.";
  - **errores:** token inexistente, con formato inválido, vencido o ya usado responden igual: "El enlace no es válido o venció. Pide a tu agente que lo reenvíe." Los errores de la contraseña (mínimo 8 caracteres, confirmación igual) salen por campo y no consumen el token;
  - **límite:** 10 tokens no válidos por IP en 15 minutos, sumando las dos rutas (`ATLAS_ENLACE_MAX_IP`), con el limitador existente. El 429 dice "Demasiados intentos con enlaces no válidos desde esta conexión. Espera N minutos e inténtalo de nuevo." (`codigo: limite_enlace`) y se aplica igual exista o no el token, así que no revela nada. Los errores de contraseña con un token válido no cuentan.
- Dónde está el token: solo en el correo y, en modo simulado, en el `.eml` de `data/correos/`, que es la única otra copia. Nunca se escribe en la consola del servidor, en `registro_notificaciones`, en `tokens_cuenta` (solo el hash), en respuestas de la API ni en mensajes de error:
  - las dos rutas reciben el token en el cuerpo JSON, nunca en la URL;
  - el manejador de errores registra solo el stack, y ninguna excepción incluye el cuerpo de la petición; un JSON mal formado responde 400 sin registrar nada;
  - el servidor no tiene registro de peticiones (sin morgan ni similar).
- Plantilla del correo: asunto "Crea tu contraseña del portal de ATLAS", botón "Crear mi contraseña", el enlace en texto plano, el correo de acceso, la vigencia de 48 horas, que funciona una sola vez y "Si no solicitaste este registro, ignora este correo". Sin contraseña. "Cotización lista" no cambia.
- Compatibilidad: el personal y los clientes con `123` no cambian. La pantalla "Crea tu nueva contraseña" (cambio obligatorio con la contraseña actual) sigue funcionando para cuentas con la marca. Las cuentas creadas con la versión anterior de la 4a no se migran: su contraseña temporal sigue en su `.eml`.
- Interfaz:
  - `src/CrearContrasena.jsx` (nuevo): pantalla pública con validación del enlace, contraseña y confirmación con mostrar/ocultar (`CampoContrasena`, ahora exportado de `CambiarContrasena.jsx`), mensaje genérico si el enlace no sirve y "Ir al inicio de sesión";
  - `src/enlaceAcceso.js` (nuevo): `tomarTokenDeEnlace`, que lee y borra el fragmento;
  - `src/App.jsx`: lee el enlace al cargar el módulo, atiende `hashchange`, muestra la pantalla antes del login (si había una sesión abierta en esa pestaña, la cierra al salir) y el aviso del login. El modal "Solicitud registrada" dice "Se envió un enlace de acceso para que el cliente cree su contraseña" y, en modo simulado, el `.eml`;
  - `src/AvisoCorreo.jsx`: "el correo con el enlace de acceso".
- Archivos: `server/tokensCuenta.js`, `server/enlaces.test.js`, `src/CrearContrasena.jsx`, `src/enlaceAcceso.js`, `src/enlaceAcceso.test.js` (nuevos); `server/schema.sql`, `server/api.js`, `server/correo.js`, `server/correoUtil.js`, `server/plantillasCorreo.js`, `server/correo.test.js`, `server/plantillasCorreo.test.js`, `src/App.jsx`, `src/AvisoCorreo.jsx`, `src/CambiarContrasena.jsx`, `.env.example`.
- Base de datos: tabla nueva `tokens_cuenta` (`cuenta_id` con llave foránea a `cuentas_cliente` y borrado en cascada, `tipo` = `crear_contrasena`, `token_hash` único, `expira_at`, `usado_at`, `created_at`) e índice `tokens_cuenta_idx`. Se crea con `CREATE TABLE IF NOT EXISTS`; `user_version` sigue en 3.
- Rutas nuevas (públicas): `POST /api/portal/validar-enlace` y `POST /api/portal/crear-contrasena`.
- Pruebas:
  - `server/enlaces.test.js` (12): validar sin consumir (varias veces), inexistente o mal formado con el mismo error, crear y entrar sin sesión automática, un solo uso, vencido, vigencia de 48 horas, contraseña corta o distinta sin consumir, dos envíos simultáneos, emitir uno nuevo invalida el anterior, sesiones cerradas, límite por IP con el 429 sin revelar el token, y el token ausente de la consola, `registro_notificaciones`, `tokens_cuenta` y las respuestas de error. Emite tokens con el mismo módulo del servidor contra la base temporal, tras comprobar que no es `data/atlas.sqlite`;
  - `server/correo.test.js` y `server/plantillasCorreo.test.js`: el correo lleva el enlace y la vigencia y no contiene contraseña; el token no está en la respuesta, la base ni la consola;
  - `src/enlaceAcceso.test.js` (2): lectura y borrado del fragmento.
- Cómo probar en la interfaz (sin `.env`, modo simulado):
  1. Como `ventas@atlas.com`, registra una solicitud. El modal dice que se envió un enlace de acceso e indica el `.eml`.
  2. Abre el `.eml` y copia el enlace "Crear mi contraseña". Ábrelo en el navegador de la misma máquina: la barra queda sin `#…` y aparece "Crea tu contraseña".
  3. Prueba una contraseña corta y una confirmación distinta (errores junto al campo), luego crea una válida. Vuelves al login con "Contraseña creada. Inicia sesión." y entras directo al portal.
  4. Abre otra vez el mismo enlace: "El enlace no es válido o venció. Pide a tu agente que lo reenvíe."

### Fase 4a: notificaciones por correo (plantillas y modo simulado)

- Estado: **implementado.** Commit `7c059c7`. Primera parte de la Fase 4. El correo de credenciales con contraseña temporal descrito aquí se reemplazó por el enlace "Crea tu contraseña" (entrada anterior). Quedan para la Fase 4b: reenviar credenciales, pantalla "Notificaciones" del administrador con reintento y correos en el detalle del agente.
- Por qué: diseño de la sección 3.2.3 del documento y tabla `registro_notificaciones`. Hasta ahora las cuentas de cliente nuevas se creaban con la contraseña `123` y no se enviaba ningún correo.
- Dependencia nueva: `nodemailer@10.0.14`, versión exacta (sin `^` ni `~`), aprobada.
  - Revisión antes de instalar (2026-10-19): publicada el 2026-10-03 (16.5 días), sin dependencias propias, `npm audit` sin vulnerabilidades al auditarla sola y sin hallazgos nuevos al agregarla al proyecto.
  - Las 14 vulnerabilidades que ya tenía el proyecto en herramientas de desarrollo siguen igual. Se atenderán aparte, después de la Fase 4, con `npm audit fix` sin `--force` y sin pasar a `tailwindcss@4`.
- Configuración:
  - `server/entorno.js` carga `.env` con `process.loadEnvFile` de Node, sin dependencia. Se importa antes que cualquier otro módulo; las variables ya definidas en el entorno tienen prioridad. No imprime ni registra el contenido.
  - Variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `CORREO_REMITENTE`, `APP_URL` y, opcional, `CORREO_TIEMPO_MAX_MS`. Documentadas en `.env.example`, sin valores reales.
  - `.gitignore` agrega `.env` y `data/correos/`.
  - Al arrancar, el servidor solo dice "Correo en modo simulado…" o "Correo: SMTP configurado". No muestra host, usuario ni contraseña.
- Estados de envío:
  - **sin `SMTP_HOST` (modo simulado):** cada correo se guarda como `.eml` en `data/correos/` y queda `pendiente` con el detalle "Modo simulado: no se envió. Archivo: …". Nunca se marca como aceptado ni entregado;
  - **con SMTP:** `aceptado` (con `enviado_at`) cuando el servidor SMTP acepta el mensaje; `fallido` con `detalle_error` si falla, rechaza al destinatario o se agota el tiempo;
  - `entregado` no se usa: requiere una confirmación del proveedor que no existe;
  - el detalle de error oculta el usuario y la contraseña SMTP y se acota a 300 caracteres.
- Tiempo máximo: 15 s por envío (`CORREO_TIEMPO_MAX_MS`). Si el servidor acepta el mensaje después del límite, el registro se corrige de `fallido` a `aceptado`.
- Flujos:
  - **Credenciales:** al registrar una solicitud, la cuenta del cliente se crea con una contraseña temporal aleatoria de 12 caracteres (sin caracteres ambiguos como 0/O o 1/l) y con "debe cambiar contraseña" activo. El correo con el acceso, la contraseña temporal y la URL se envía **después** del COMMIT.
  - **Cotización lista:** al aprobar, el cliente recibe un aviso con la URL del portal, sin precios ni costos. También se envía después del COMMIT.
  - **Recordatorio:** solo la plantilla (`plantillaRecordatorio`) y la función `enviarRecordatorio` en `server/correo.js`. No tiene disparador: depende del módulo de mantenimientos, que aún no existe.
  - Si el envío falla, la solicitud o la aprobación quedan guardadas igual; el fallo queda en `registro_notificaciones` y la respuesta lo informa.
  - La contraseña temporal no se guarda en la base, no se devuelve en la respuesta, no se imprime en la consola y no aparece en pantalla. Solo viaja en el correo (y, en modo simulado, dentro del `.eml`).
  - El personal de demostración y las cuentas de cliente ya creadas siguen con `123` sin cambio obligatorio.
- Interfaz:
  - el modal "Solicitud registrada" ya no muestra "123". Indica que la contraseña es temporal y fue enviada por correo. En modo simulado muestra la ruta del archivo (`data/correos/<archivo>.eml`); si el envío falla, muestra un aviso ámbar con el detalle;
  - al aprobar, el detalle de la solicitud muestra el mismo tipo de aviso para "cotización lista";
  - `src/AvisoCorreo.jsx` (nuevo) muestra esos avisos. En `src/App.jsx` solo cambiaron el modal "Solicitud registrada" y el aviso tras aprobar.
- Archivos: `server/entorno.js`, `server/correo.js`, `server/correoUtil.js`, `server/plantillasCorreo.js`, `src/AvisoCorreo.jsx`, `.env.example` (nuevos); `server/api.js`, `server/database.js`, `server/schema.sql`, `src/App.jsx`, `.gitignore`, `package.json`, `package-lock.json`.
- Base de datos: columnas nuevas en `registro_notificaciones`: `solicitud_id` (con llave foránea a la solicitud), `intentos`, `ultimo_intento_at` y `archivo` (nombre del `.eml` simulado), más el índice `notificaciones_solicitud_idx`. Se agregan en el arranque con el patrón idempotente de `ALTER TABLE`; `user_version` sigue en 3. Probado sobre la copia de una base anterior: las columnas se agregan y no hay errores de llaves foráneas.
- Rutas:
  - `POST /api/solicitudes` responde además `correo: { id, estado, simulado, archivo?, detalle? }`;
  - `POST /api/agente/solicitudes/:id/aprobar` responde además `correo` (o `null` si el cliente no tiene correo).
- Pruebas:
  - `server/plantillasCorreo.test.js` (7): plantillas en texto y HTML, cotización sin precios ni contraseñas, escape de HTML, configuración, contraseña temporal y limpieza del detalle de error;
  - `server/correo.test.js` (9): modo simulado (archivo y registro pendiente), contraseña ausente de la respuesta, la base y la consola, cambio obligatorio con la temporal, personal con `123`, "cotización lista" al aprobar, SMTP falso que acepta, SMTP inalcanzable que no bloquea el registro, destinatario rechazado y servidor que no responde (se corta en el tiempo máximo);
  - el ayudante de pruebas ignora el `.env` real (`ATLAS_ENV_ARCHIVO` apunta a un archivo inexistente), quita las variables SMTP heredadas y guarda los correos en la carpeta temporal (`ATLAS_CORREOS_DIR`). Nunca toca `data/atlas.sqlite` ni `data/correos/`;
  - `registrarSolicitudPrueba` deja por defecto la cuenta como las creadas antes de la Fase 4 (`123`, sin cambio obligatorio), para las pruebas de contraseñas y sesiones; con `{ contrasena: null }` conserva la temporal.
- Cómo probar en la interfaz (sin `.env`, es decir, en modo simulado):
  1. Como `ventas@atlas.com`, registra una solicitud con un correo de ejemplo. El modal "Solicitud registrada" muestra `data/correos/<fecha>-credenciales-<n>.eml`.
  2. Abre ese archivo con un cliente de correo o un editor de texto y copia la contraseña temporal.
  3. Inicia sesión con ese correo: `123` es rechazada; con la temporal aparece "Crea tu nueva contraseña" y, al cambiarla, el portal.
  4. Completa la revisión técnica y aprueba la cotización: el detalle muestra el aviso de "cotización lista" con su `.eml`. El correo no incluye precios.
  5. Para ver el aviso de falla sin un SMTP real: en `.env` pon `SMTP_HOST=127.0.0.1` y `SMTP_PORT=9`, reinicia el backend y registra otra solicitud. El modal muestra "No se pudo enviar…" y la solicitud queda registrada. Quita esas dos líneas al terminar.

### Confirmación al cerrar con cambios sin guardar en inventario, proveedores, importación y parámetros

- Estado: **implementado.** Commit `7e90240`.
- Por qué: varios modales de captura se cerraban con Escape, clic fuera, ✕ o "Cancelar" y perdían lo escrito sin avisar. Se aplican las mismas reglas que en "Editar tarifa".
- Regla común: el modal guarda una copia de los valores con que se abrió. Si alguno difiere, cualquier forma de cerrar (Escape, clic fuera, ✕ y el botón "Cancelar" o "Cerrar") pide "¿Descartar los cambios?" con "Seguir editando" o "Descartar y cerrar". Volver a escribir el valor original ya no cuenta como cambio. Guardar con éxito cierra sin preguntar.
- Modales protegidos:
  - **Nuevo producto y Editar producto:** cualquier campo distinto del inicial;
  - **Editar fila (vista previa de la importación):** cualquier campo distinto de como estaba la fila al abrir (con sus correcciones previas, si las tenía). "Restaurar valores del archivo" cuenta como cambio solo si deja la fila distinta de como se abrió;
  - **Parámetros de la estimación:** cualquier valor distinto del inicial;
  - **Dar de baja:** solo si ya hay un motivo escrito (los espacios no cuentan);
  - **Proveedores:** solo si hay un nombre escrito en "Nuevo proveedor" o un renombre abierto con un nombre distinto del actual. La búsqueda, el orden y abrir "Renombrar" sin cambiar el nombre no cuentan.
- Sin protección, a propósito: Exportar, Reactivar, Eliminar (tarifa o proveedor), Confirmar importación, emitir cotización y tickets.
- Archivos: `src/InventarioFisico.jsx` (`ModalProducto`, `ModalFilaImportacion`, `ModalBaja`, `ModalProveedores`) y `src/TarifasCfe.jsx` (`ModalParametros`). `Modal.jsx` no cambió.
- Base de datos y rutas de la API: sin cambios.
- Cómo probar:
  - en Inventario Físico, abrir "Nuevo producto", escribir un modelo y pulsar Escape: aparece la confirmación. "Seguir editando" conserva lo escrito; "Descartar y cerrar" cierra ambos;
  - abrir "Editar" de un producto y cerrar sin cambiar nada: cierra directo;
  - "Dar de baja" con el motivo vacío cierra directo; con motivo pide confirmar y el producto sigue activo;
  - en "Proveedores", buscar u ordenar y cerrar: directo. Escribir un nombre nuevo, o cambiar un nombre en "Renombrar" sin guardar, y cerrar: pide confirmar;
  - importar `docs/ejemplos/inventario_ejemplo.xlsx`, revisar, editar la fila 7, cambiar el modelo y pulsar Cancelar: pide confirmar;
  - en Tarifas y ahorro, "Editar" parámetros, cambiar un valor y pulsar Escape: pide confirmar;
  - Exportar y Reactivar cierran sin preguntar.

### A, B y C: manejo global de 401, límite de intentos del login y protección de rutas antiguas

- Estado: **implementado.** Commit `d360ef6`.
- Por qué:
  - tras cambiar la contraseña en otra ventana, la ventana vieja recibía 401 y lo mostraba dentro del formulario en lugar de volver al login;
  - `/api/login` no limitaba intentos;
  - tres rutas de prospectos respondían sin sesión desde el commit inicial.
- Archivos:
  - `server/api.js`: limitador en memoria reutilizable, límites del login, tokens revocados con motivo, `trust proxy`, rutas de prospectos protegidas;
  - `vite.config.js`: `xfwd: true` en el proxy de `/api`;
  - `src/sesionApi.js` (nuevo): interceptor global de `fetch`;
  - `src/App.jsx`: instala el interceptor una sola vez, limpia la sesión y muestra el aviso en el login;
  - `server/pruebas/servidorPrueba.js`: variables de entorno por prueba y opción `ip` (envía `X-Forwarded-For`);
  - `server/sesiones.test.js` y `src/sesionApi.test.js` (nuevos);
  - `package.json`: `npm test` incluye `src/**/*.test.js`.
- Base de datos: sin cambios. `user_version` sigue igual.
- A. Manejo global de 401:
  - el servidor recuerda 24 horas los tokens cerrados por cambio de contraseña y responde 401 con `codigo: contrasena_cambiada` y el mensaje "Tu contraseña se cambió en otro dispositivo. Inicia sesión de nuevo."; cualquier otro 401 de sesión lleva `codigo: sesion_vencida`;
  - en el cliente, `instalarManejoSesion` envuelve `window.fetch` una sola vez desde `App`. Ante un 401 de `/api/*` (excepto `/api/login`) que lleve el token de la sesión actual, limpia la sesión y vuelve al login con un aviso;
  - sin cambios: el 401 "Credenciales incorrectas" del login y el 403 `debe_cambiar_password`.
- B. Límite de intentos del login:
  - aplica a clientes y a personal (Administrador, Agente, Técnico);
  - por cuenta: 5 fallos en 15 minutos. Se revisa antes de verificar la contraseña, así que la correcta también recibe 429 mientras dure el bloqueo;
  - por IP: 20 fallos en 15 minutos;
  - un correo inexistente cuenta igual que uno existente;
  - un login correcto reinicia el contador de la cuenta, no el de la IP;
  - respuesta 429 con `codigo: limite_cuenta` o `limite_ip` y el texto "Demasiados intentos fallidos … Espera N minutos e inténtalo de nuevo.";
  - `app.set('trust proxy', 'loopback')` en Express y `xfwd: true` en Vite, para que el servidor vea la IP real detrás del proxy de desarrollo. En producción detrás de otro proxy hay que ajustarlo (ver "Limitaciones conocidas");
  - contadores en memoria; ajustables con `ATLAS_LOGIN_MAX_CUENTA`, `ATLAS_LOGIN_MAX_IP` y `ATLAS_LOGIN_VENTANA_MIN`.
- C. Rutas antiguas de prospectos:
  - búsqueda de uso: `POST /api/prospectos` y `PATCH /api/prospectos/:id` no se usan en el frontend; `PUT /api/prospectos/:id/consumo` solo la usa `CalculadoraSolar`, que no tiene acceso desde los menús; en `server/index.js` solo aparecen en código comentado;
  - como ninguna es alcanzable, las tres exigen ahora sesión de Administrador o Agente (401 sin token, 403 con otro rol);
  - la calculadora no se borró y ya enviaba el token.
  - Solo `GET /api/health` y `POST /api/login` quedan públicas.
- Limitaciones nuevas (detalle en "Limitaciones conocidas"):
  - el bloqueo por cuenta permite bloquear una cuenta ajena durante la ventana;
  - una red compartida puede agotar el límite por IP;
  - los contadores y los tokens revocados se borran al reiniciar el servidor.
- Cómo probar:
  - `npm test` (incluye `server/sesiones.test.js` con base temporal y `src/sesionApi.test.js`);
  - en la interfaz:
    - abrir el portal de un cliente en dos ventanas y cambiar la contraseña en una; en la otra, cualquier acción vuelve al login con el aviso del cambio;
    - con un agente, cerrar sesión desde otra pestaña y pulsar "Recargar" en el inventario: vuelve al login con "Tu sesión se cerró";
    - fallar 5 veces el login con `tecnico@atlas.com`: el sexto intento, aun con `123`, muestra el mensaje de bloqueo.
  - Para desbloquear en desarrollo: reiniciar el backend (Ctrl+C y `npm run server`, o guardar cualquier archivo del servidor con `node --watch`) o esperar 15 minutos.
- Reproducción previa (servidor con base temporal, antes del cambio):
  - Cambio de contraseña con la actual incorrecta: intentos 1 a 4 responden 400 con "Te quedan N intentos"; el 5 responde 400 con "Alcanzaste el límite de intentos"; el 6 y los siguientes responden 429, incluso con la contraseña correcta.
  - Un cambio exitoso reinicia el contador. Reiniciar el servidor también lo borra (y cierra las sesiones).
  - `/api/login`: 30 contraseñas incorrectas seguidas responden 401; después la correcta entra.
  - El 401 de una sesión cerrada por cambio de contraseña no distingue el motivo ("Sesión requerida o vencida").
- Decisiones tomadas al aprobar la propuesta:
  - interceptor de `fetch` instalado una sola vez desde `App`, en lugar de migrar todas las llamadas a un cliente `apiFetch`;
  - el límite del login aplica también a Administrador, Agente y Técnico;
  - se aprueban `trust proxy: 'loopback'` y `xfwd: true`;
  - los contadores siguen en memoria.

### Fase 3: cambio de contraseña del cliente, corrección de scroll y confirmación al cerrar "Editar tarifa"

- Commit: `861e96c` (2026-10-19 16:05).
- Qué y por qué:
  - **"Editar tarifa":** pide "¿Descartar los cambios?" si algún campo, bloque, precio u origen difiere de los valores con los que se abrió.
  - **Cambio de contraseña del cliente:**
    - en Datos personales, con mostrar/ocultar y errores junto a cada campo;
    - pantalla obligatoria "Crea tu nueva contraseña" cuando la cuenta tiene una contraseña temporal;
    - límite de 5 intentos fallidos en 10 minutos por cuenta;
    - cierra las demás sesiones de la cuenta.
  - **Scroll:**
    - el contenido desplaza dentro de `main` con el menú fijo;
    - se corrigió que el `body` quedara con `overflow: hidden` al cerrar un modal anidado ("Descartar y cerrar"), lo que dejaba la app sin scroll hasta recargar.
- Archivos: `src/ModalTarifa.jsx`, `src/CambiarContrasena.jsx` (nuevo), `src/App.jsx`, `src/Modal.jsx`, `server/api.js`, `server/database.js`, `server/schema.sql`, `server/contrasenas.test.js` (nuevo), `server/pruebas/servidorPrueba.js` (nuevo), `package.json`.
- Base de datos: `cuentas_cliente.debe_cambiar_password` (por defecto 0) y `password_actualizada_at`. Sin cambio de `user_version`.
- API:
  - nueva `POST /api/portal/cambiar-contrasena`;
  - `POST /api/login` devuelve `debe_cambiar_password` y `cuenta_id` para clientes;
  - `autenticar` responde 403 (`codigo: debe_cambiar_password`) mientras el cambio esté pendiente;
  - el manejador de errores registra solo el stack y responde 400 sin registrar nada ante JSON mal formado, que podría traer una contraseña en el cuerpo.
- Decisiones:
  - las cuentas existentes y el personal siguen con `123` sin cambio obligatorio;
  - el contador vive en memoria;
  - solo el portal del cliente, sin tocar el personal;
  - las pruebas del servidor usan una base en una carpeta temporal del sistema y nunca `data/`.
- Desviaciones respecto al PDF: no consta en el PDF un flujo de cambio de contraseña; es un requisito de este plan.
- Limitaciones: ver "Limitaciones conocidas" (contadores en memoria, 401 sin manejo global, indicador leído solo al iniciar sesión).
- Cómo probarlo:
  - `npm test` (incluye 9 pruebas del servidor).
  - Como cliente creado desde Cotización (contraseña `123`): Datos personales, Cambiar contraseña.
  - Para la pantalla obligatoria, activar el indicador en la base local:

    ```
    UPDATE cuentas_cliente SET debe_cambiar_password = 1 WHERE email = ?
    ```

  - Para el scroll: ventana de unos 600 px de alto, con el menú contraído y expandido.

### Fase 2: modal "Editar tarifa" con captura desde recibo, simulador y origen de precios

- Commit: `4ad4702` (2026-10-19 15:36).
- Qué y por qué:
  - **"Desde un recibo":** captura de escalones (mensual o bimestral, con o sin IVA) con conversión a mensual sin IVA y vista previa antes de aplicar.
  - **Bloques:** el "desde" es calculado y no editable; un juego por defecto y "Agregar otra temporada" bajo demanda.
  - **Simulador de importe mensual** con desglose por escalón.
  - **Errores junto al campo** y estado por bloque ("completo", "falta precio", "con errores").
  - **Origen de cada precio** ("Dato de prueba" o "Tomado de un recibo"); solo se puede validar si todo es de recibo.
- Archivos: `shared/reciboCfe.js` y `shared/reciboCfe.test.js` (nuevos), `src/ModalTarifa.jsx` y `src/tarifasComunes.js` (nuevos), `src/TarifasCfe.jsx`, `server/api.js`, `server/database.js`, `server/schema.sql`.
- Base de datos: `tarifas_bloques.origen_precio` y `tarifas_cfe.origen_cargo_fijo` (`'prueba'` o `'recibo'`, vacíos por defecto). Sin cambio de `user_version`.
- API: `POST /api/tarifas` y `PUT /api/tarifas/:id` aceptan y validan el origen; "validada" exige que todos los precios y el cargo fijo sean de recibo.
- Decisiones:
  - `shared/ahorroSolar.js` no se modificó; el simulador reutiliza `costoMensual`, `costoEnergia` y `aplicaDac`;
  - en un recibo bimestral se dividen entre 2 los kWh de cada escalón y el cargo fijo, pero no el precio por kWh.
- Desviaciones respecto al PDF: la captura de tarifas no consta en el PDF; es parte del plan de la Integración 6.
- Limitaciones: tarifas validadas antes de este commit quedan con origen "sin especificar".
- Cómo probarlo: `npm test`. En Tarifas y ahorro, Editar la tarifa 1:
  1. En "Desde un recibo", con periodo bimestral y precios con IVA, capturar escalones de 150 y 130 kWh a 1.16, 1.392 y 4.06. Deben convertirse a 0–75, 75–140 y más de 140 kWh, a 1.00, 1.20 y 3.50.
  2. Con 200 kWh en el simulador, el importe debe ser $421.08 (datos ficticios de prueba).

### Fase 1: popups con Modal, confirmación al cerrar y renombre a "Estatus"

- Commit: `c7a3565` (2026-10-19 15:16).
- Qué y por qué:
  - **Pasan a `Modal`:**
    - el detalle de la solicitud del agente;
    - Mis Tickets (antes usaba `prompt`, `confirm` y `alert`);
    - el aviso de "Solicitud registrada";
    - la confirmación de "Completar revisión" del técnico.
  - **Calculadora:** sus `alert` pasan a mensajes en la página.
  - **Confirmación al cerrar:** el detalle del agente pide confirmación con cambios sin guardar (margen, precio, tarifa o motivo) al cerrar con Escape, clic fuera, ✕ o "Cerrar".
  - **"Estado" → "Estatus"** donde significa estatus (Cotizaciones Emitidas, Mis Tickets, inventario).
- Archivos: `src/App.jsx`, `src/Modal.jsx`, `src/SolicitudesDimensionamiento.jsx`, `src/InventarioFisico.jsx`, `src/inventarioArchivos.js`, `server/api.js`.
- Base de datos: sin cambios.
- API: sin rutas nuevas; cambian los mensajes de error de la importación ("el estatus (columna estado)").
- Decisiones:
  - `Modal` admite `confirmarCierre` y una pila de modales (Escape y Tab solo afectan al de arriba);
  - la columna `estado` del CSV se conserva y se acepta `estatus`.
- Limitaciones: la calculadora no tiene acceso desde los menús, así que sus mensajes no se pudieron probar desde la interfaz.
- Cómo probarlo: como agente, abrir el detalle de una solicitud lista, cambiar el precio y cerrar con Escape; debe pedir confirmación.

### Corrección del estado geográfico y alias

- Commit: `2dd526a` (2026-10-19 15:00).
- Qué y por qué: una solicitud con el estado escrito como "N.L." quedó con `estado_codigo` vacío y ningún técnico podía verla.
  - **Formulario:** el campo Estado de Cotización pasa a ser un selector con los 32 estados.
  - **Servidor:** rechaza (400) los estados no reconocidos y guarda el nombre oficial.
  - **Alias de Nuevo León:** se reconocen "n.l.", "nl" y "n l", comparados sin puntos ni espacios. Por la misma regla también se reconocen "D.F.", "C.D.M.X." y "Edo. Méx.".
  - **Corrección de filas existentes:** al arrancar se completan las direcciones con `estado_codigo` vacío cuando su texto se reconoce, y se reportan las demás.
  - **Detalle de la solicitud:** dice "Estatus" y muestra la dirección de instalación con el nombre oficial del estado.
- Archivos: `shared/estadosMexico.js`, `shared/estadosMexico.test.js` (nuevo), `server/api.js`, `server/database.js`, `src/Cotizacion.jsx`, `src/App.jsx`.
- Base de datos: sin columnas nuevas; corrección idempotente de `direcciones_cliente.estado_codigo` en cada arranque, sin reescribir el texto original.
- API: `POST /api/solicitudes` rechaza estados no reconocidos.
- Decisiones: "México" a secas sigue sin reconocerse por ambiguo.
- Desviaciones respecto al PDF: no aplica.
- Limitaciones: el cambio pedido "como te pedí antes" sobre la dirección de instalación no consta en el historial de la conversación ni en git; se implementó según la descripción de esta tarea.
- Cómo probarlo: `npm test`; registrar una solicitud con el selector; un `POST /api/solicitudes` con estado "México" debe responder 400.

### Integración 6: tarifas CFE, ahorro y retorno de inversión, irradiación solar

- Commit: `6e5e658` (2026-10-19 05:38).
- Qué y por qué: pantalla "Ahorro e inversión" del portal según la figura 17 del PDF (sección 4.5), estimación de ahorro y recuperación, tarifas por bloques editables por el administrador y horas solares pico por estado.
- Archivos: `shared/ahorroSolar.js` y `shared/ahorroSolar.test.js`, `shared/irradiacion.js`, `scripts/cargar-irradiacion.mjs`, `src/TarifasCfe.jsx`, `src/EmisionAhorro.jsx`, `src/AhorroInversion.jsx`, `src/Aviso.jsx`, `src/ui.js`, `src/useAviso.js` (nuevos); `server/api.js`, `server/database.js`, `server/schema.sql`, `shared/estadosMexico.js`, `src/App.jsx`, `src/InventarioFisico.jsx`, `src/inventarioArchivos.js`, `package.json`.
- Base de datos: tablas `tarifas_cfe`, `tarifas_bloques`, `tarifas_estados` y `parametros_ahorro`; columna `cotizaciones_versiones.supuestos_ahorro`; `user_version` 3 (carga única de datos de ejemplo con precios vacíos).
- API:
  - nuevas: `GET`, `POST`, `PUT` y `DELETE` de `/api/tarifas`, `PUT /api/tarifas-estados/:codigo`, `PUT /api/parametros-ahorro` y `GET /api/agente/solicitudes/:id/estimacion`;
  - `POST /api/agente/solicitudes/:id/aprobar` acepta `tarifa_id` y guarda la estimación;
  - `GET /api/portal/prospectos/:id` incluye la estimación guardada, sin costos internos.
- Decisiones:
  - el consumo base es `consumo_mensual_kwh`; en pantalla se muestran el "Consumo considerado" y, aparte, el consumo objetivo;
  - precios sin IVA y IVA aplicado en el cálculo;
  - el ahorro se limita al consumo;
  - sin paneles no hay estimación;
  - no se puede borrar una tarifa asignada a un estado;
  - las horas solares pico vienen de PVGIS 5.3 con PVGIS-ERA5: la API 5.3 ya no acepta NSRDB y SARAH3 no cubre México.
- Desviaciones respecto al PDF: la figura 17 dice "Consumo objetivo"; se muestra "Consumo considerado" y el objetivo por separado.
- Limitaciones: ver "Supuestos pendientes de validar".
- Cómo probarlo: `npm test`. El administrador captura una tarifa en Tarifas y ahorro; el agente aprueba con otra tarifa; el cliente abre "Ahorro e inversión".

### Integración 2 v2: corrección de filas, borrado de proveedores, exportar unificado y menú contraíble

- Commit: `3783711` (2026-10-19 04:39).
- Qué y por qué:
  - **Importar y exportar:** botón "Importar" (acepta .csv y .xlsx) y un solo "Exportar" con modal de formato.
  - **Vista previa:** corrección y exclusión de filas en memoria.
  - **Proveedores:**
    - borrado permanente con confirmación y conteo de productos ligados, que quedan sin proveedor;
    - orden A-Z o por fecha de alta, y buscador;
    - selector de proveedor en los modales de producto.
  - **Editar producto:** muestra el motivo de baja de los productos inactivos.
  - **Menú lateral:** se puede contraer y recuerda su estado entre sesiones.
- Archivos: `src/InventarioFisico.jsx`, `src/Modal.jsx`, `src/App.jsx`, `server/api.js`, `server/database.js`.
- Base de datos: `user_version` 2 (el catálogo y los proveedores iniciales se cargan una sola vez, para que un proveedor borrado no reaparezca).
- API: nueva `DELETE /api/proveedores/:id`; `GET /api/proveedores` incluye `productos_ligados`.
- Decisiones: `ON DELETE SET NULL` en `productos_catalogo.proveedor_id`; la pila de modales permite anidar el de confirmación.
- Cómo probarlo: en Inventario Físico, Importar `docs/ejemplos/inventario_ejemplo.xlsx`, corregir la fila 7 y excluir otra; en Proveedores, eliminar uno con productos ligados.

### Integración 2: importación y exportación de inventario en CSV y Excel

- Commit: `563a9d7` (2026-10-19 03:22).
- Qué y por qué:
  - pantalla Inventario Físico según la sección 4.2 del PDF (figuras 5 a 7);
  - importar y exportar en CSV y .xlsx con vista previa (Nuevo, Actualizar, Sin cambios, Inválida) y confirmación en una sola transacción;
  - modales en lugar de `prompt`, `alert` y `confirm` en el inventario;
  - gestión de proveedores en modal.
- Archivos: `src/InventarioFisico.jsx`, `src/Modal.jsx`, `src/inventarioArchivos.js` (nuevos), `src/App.jsx`, `server/api.js`, `package.json`, `package-lock.json`, `docs/ejemplos/inventario_ejemplo.csv` y `inventario_ejemplo.xlsx`.
- Base de datos: sin cambios.
- API:
  - nuevas: `POST /api/productos/importacion/previsualizar` y `POST /api/productos/importacion/confirmar` (409 si el catálogo cambió entre la revisión y la confirmación);
  - límite de 2 MB y 2000 filas;
  - respuesta 413 clara para cuerpos grandes.
- Dependencias: `read-excel-file@9.3.10` y `write-excel-file@4.1.1`, con versión exacta; se descartó el paquete `xlsx` de npm por vulnerabilidades conocidas.
- Decisiones:
  - el código es obligatorio en cada fila;
  - una celda vacía en una columna opcional conserva el valor actual;
  - las potencias son obligatorias solo en paneles e inversores nuevos.
- Desviaciones respecto al PDF: se agregó "Exportar Excel" y la columna de inválidas en la vista previa.
- Cómo probarlo: importar `docs/ejemplos/inventario_ejemplo.csv`; volver a importar el CSV exportado debe dar "Sin cambios".

### Fase B de la base de datos: categorías Batería y Extra

- Commit: `137a4dd` (2026-10-19 02:37).
- Qué y por qué: `productos_catalogo.tipo` acepta 'Batería' y 'Extra'; se agrega `capacidad_kwh`. SQLite no permite cambiar un CHECK, así que la tabla se reconstruye.
- Archivos: `server/database.js`, `server/schema.sql`, `server/api.js`, `.gitignore`.
- Base de datos:
  - `user_version` 1: respaldo automático con `VACUUM INTO` en `data/backups/` y reconstrucción en una transacción con `foreign_key_check`, conservando el `AUTOINCREMENT`;
  - la llave `revision_tecnica_items` → `productos_catalogo` mantiene `ON DELETE RESTRICT`.
- API: `GET /api/productos` devuelve `marca`, `proveedor_id` y `capacidad_kwh`; `POST` y `PATCH` los aceptan; la capacidad es obligatoria para baterías.
- Cómo probarlo: crear un producto de tipo Batería con capacidad; comparar los productos con el respaldo en `data/backups/`.

### Fase A de la base de datos: tablas y columnas de ATLAS v2

- Commit: `28fa1da` (2026-10-19 02:18).
- Qué y por qué: comparar el esquema con la sección 3 del PDF (diagrama E-R y diccionario de ATLAS v2) y agregar lo que faltaba sin renombrar ni borrar.
- Archivos: `server/schema.sql`, `server/database.js`, `docs/ProyInt2_SegundoAvance.pdf`.
- Base de datos:
  - tablas `firmas_cotizacion`, `ordenes_instalacion`, `checklist_evidencias`, `mantenimientos_programados` y `registro_notificaciones`;
  - columnas `prospectos.etapa_cliente`, `productos_catalogo.marca` y `proveedor_id`, y `cotizaciones_versiones.ahorro_anual_est`, `retorno_inversion_anios` y `estatus_respuesta`.
- API: sin cambios.
- Decisiones:
  - no se agregó `agente_id` al prospecto;
  - la dirección sigue siendo una por prospecto;
  - `precio_venta` incluye IVA;
  - `registro_notificaciones.estado_envio` es texto (pendiente, aceptado, fallido, entregado) en lugar de booleano, para distinguir "aceptado por el servidor" de "entregado".
- Desviaciones respecto al PDF: nombres de tabla en minúsculas y en estilo del repositorio; las tablas del diccionario que ya existían con otro nombre no se duplicaron.

### Estado inicial

- Commit: `c57aaea` (2026-10-06 16:42), "primer commit".
- Contenido: frontend React + Vite + Tailwind, backend Express + `node:sqlite`, flujo de solicitud, revisión técnica, aprobación del agente y portal del cliente, según el `README.md` de ese commit.
- No consta en git un historial anterior a este commit.

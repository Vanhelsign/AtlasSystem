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
- El personal de demostración y las cuentas de cliente creadas hasta ahora usan la contraseña `123`, sin cambio obligatorio (decisión explícita). Las cuentas de cliente nuevas también se crean con `123` hasta que se implemente la Fase 4 (contraseñas temporales aleatorias).

Funcionalidad:

- La calculadora (`CalculadoraSolar`) no tiene ningún acceso desde los menús; solo se llega por código. Su código se conserva. La ruta que usa (`PUT /api/prospectos/:id/consumo`) ahora exige sesión de Administrador o Agente, y la calculadora ya enviaba el token.
- Tickets técnicos, reactivación comercial y evidencias fotográficas siguen en memoria del navegador (`useState`); la evidencia es simulada.
- No hay envío de correos: la tabla `registro_notificaciones` existe desde la Fase A, pero no se usa. Corresponde a la Fase 4 del plan actual.
- Las tablas `firmas_cotizacion`, `ordenes_instalacion`, `checklist_evidencias` y `mantenimientos_programados` existen desde la Fase A, pero ninguna ruta las usa todavía.
- En "Editar tarifa", lo escrito en "Desde un recibo" sin pulsar "Aplicar" no cuenta como cambio sin guardar.
- `README.md` no se ha actualizado desde el commit inicial: no describe las integraciones 2 y 6 ni las fases recientes.
- `server/index.js` solo importa `api.js` y conserva código antiguo comentado.
- Al instalar dependencias en el commit `563a9d7`, `npm audit` reportó 14 vulnerabilidades, todas en herramientas de desarrollo que ya estaban (Vite, Tailwind, PostCSS, Babel); ninguna en las librerías de Excel. No se ha vuelto a revisar.

Datos:

- Una dirección capturada antes de la corrección de estados puede tener el texto del estado dañado por codificación (por ejemplo, una "ó" sustituida); se muestra el nombre oficial a partir de `estado_codigo`, sin reescribir el texto.

---

## Mapa de rutas de la API

Base: `http://localhost:3001/api` (en desarrollo, Vite reenvía `/api` y agrega `X-Forwarded-For`). Todas las rutas salvo `GET /api/health` y `POST /api/login` requieren `Authorization: Bearer <token>`.

Respuestas comunes:

- 401 sin sesión válida, con `codigo`:
  - `contrasena_cambiada`: la sesión se cerró porque la contraseña se cambió en otra sesión;
  - `sesion_vencida`: cualquier otro caso.

  El frontend vuelve al login con un aviso ante cualquiera de los dos.
- 403 con `codigo: debe_cambiar_password`: la cuenta de cliente tiene una contraseña temporal. Toda ruta responde así salvo `POST /api/portal/cambiar-contrasena` y `POST /api/logout`.

| Método | Ruta | Rol permitido | Propósito |
|---|---|---|---|
| GET | /api/health | Público | Estado del servidor |
| POST | /api/login | Público | Inicia sesión de personal o cliente; devuelve token. 401 "Credenciales incorrectas"; 429 por límite de intentos (`codigo: limite_cuenta` o `limite_ip`) |
| POST | /api/logout | Cualquier sesión | Cierra la sesión actual |
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
| POST | /api/personal | Administrador | Registra técnico o agente |
| PATCH | /api/personal/:id/activo | Administrador | Activa o desactiva cuenta |
| PATCH | /api/personal/:id/estado-trabajo | Administrador | Asigna estado de trabajo |
| GET | /api/prospectos | Administrador, Agente (solo los suyos) | Lista prospectos y solicitudes |
| GET | /api/prospectos/:id | Administrador, Agente (solo los suyos) | Detalle de prospecto |
| POST | /api/prospectos | Administrador, Agente | Registra prospecto (ruta antigua; ninguna pantalla la usa) |
| PATCH | /api/prospectos/:id | Administrador, Agente | Actualiza prospecto (ruta antigua; ninguna pantalla la usa) |
| PUT | /api/prospectos/:id/consumo | Administrador, Agente | Consumo para la calculadora (sin acceso desde los menús) |
| POST | /api/solicitudes | Agente | Registra solicitud, dirección y cuenta del cliente; rechaza estados no reconocidos |
| GET | /api/solicitudes/:id | Administrador, Agente (solo las suyas) | Detalle de solicitud |
| GET | /api/agente/solicitudes/:id/estimacion | Agente responsable | Vista previa del ahorro con la tarifa elegida o la sugerida |
| POST | /api/agente/solicitudes/:id/aprobar | Agente responsable | Emite la cotización y guarda la estimación de ahorro |
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
| registro_notificaciones | 28fa1da | Sin uso todavía (Fase 4) |
| tarifas_cfe | 6e5e658 | Tarifas de CFE |
| tarifas_bloques | 6e5e658 | Bloques por temporada |
| tarifas_estados | 6e5e658 | Tarifa sugerida por estado |
| parametros_ahorro | 6e5e658 | Parámetros de la estimación |

---

## Historial

### A, B y C: manejo global de 401, límite de intentos del login y protección de rutas antiguas

- Estado: **implementado. Sin commit.**
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

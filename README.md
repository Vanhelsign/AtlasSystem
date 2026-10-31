# ATLAS CRM Solar

Prototipo de CRM para dimensionar instalaciones solares. El frontend usa React, Vite y Tailwind CSS. El backend local con Express y SQLite conserva solicitudes de cotización, consumos, detalle CFE o por electrodomésticos y cuentas de clientes.

## Notificaciones administrativas

La pantalla administrativa **Notificaciones** resume los envíos como **Enviado** o **Error**, sin medir aperturas ni uso del enlace y sin columna de acciones. El detalle describe el evento y la solicitud relacionada. En el entorno de demostración, los correos generados localmente se muestran como Enviado; esto no acredita entrega real a un buzón. Los estados originales, archivos y diagnósticos técnicos se conservan en SQLite. `GET /api/notificaciones?resultado_envio=enviado` (o `error`) filtra en el servidor antes de paginar; se puede combinar con `tipo`. Los filtros técnicos anteriores y los endpoints existentes de reenvío permanecen compatibles para los otros módulos.

## Requisitos

- Node.js 22.13 o posterior. El proyecto usa `node:sqlite`, incluido en Node y compatible con la versión 22.14 comprobada durante la implementación.
- npm.

En Node 22 puede aparecer un aviso indicando que SQLite es experimental. No impide ejecutar el proyecto, pero debe considerarse antes de desplegar esta implementación fuera de un entorno local.

## Instalación

```powershell
npm ci
```

No se necesitan variables de entorno para la ejecución local actual.

## Iniciar la aplicación

Abre dos terminales en la raíz del proyecto.

Terminal 1, backend con recarga automática:

```powershell
npm run server
```

La API queda disponible en `http://localhost:3001`. Para ejecutarla sin recarga automática también se puede usar `npm run server:start`.

Terminal 2, frontend:

```powershell
npm run dev
```

Abre la URL indicada por Vite, normalmente `http://localhost:5173`. Vite reenvía las peticiones `/api` al backend local mediante la configuración de `vite.config.js`.

Credenciales de demostración persistidas en SQLite:

- Administrador: `admin@atlas.com` / `123`
- Agente: `ventas@atlas.com` / `123`
- Técnico: `tecnico@atlas.com` / `123`

Las cuentas de personal y prospectos persisten en SQLite con `scrypt` y una sal individual. El backend entrega un token aleatorio que conserva únicamente en memoria y verifica el rol para las operaciones protegidas. Es un mecanismo local de demostración: las sesiones se pierden al reiniciar el backend y todavía no incluye caducidad, renovación, recuperación de contraseña ni las medidas propias de producción.

Los técnicos y agentes registrados desde **Usuarios y personal** reciben inicialmente la contraseña temporal de pruebas `123`. La API nunca la guarda ni la devuelve en texto plano. Antes de un uso real debe añadirse un cambio obligatorio de contraseña.

Cada cuenta de personal puede guardar una entidad federativa mediante un código estable (`MX-NLE`, `MX-JAL`, `MX-CMX`, etc.). Las altas nuevas requieren uno de los 32 estados. Las cuentas anteriores conservan su antiguo texto de zona: solo se migra automáticamente cuando coincide inequívocamente con una entidad; de lo contrario queda como **Estado pendiente** hasta que un Administrador lo complete.

Las direcciones de solicitudes también guardan `estado_codigo` cuando el texto capturado puede normalizarse. Las solicitudes sin un código estatal válido quedan fuera de la asignación técnica hasta que se corrija su dirección.

La pantalla **Solicitudes de dimensionamiento** usa esa coincidencia exacta en el backend. Un técnico activo únicamente puede listar y abrir solicitudes cuyo `estado_codigo` coincide con su `estado_trabajo_codigo`. La toma de una solicitud es atómica y persiste el técnico responsable, la fecha de toma, el borrador de componentes y la fecha de finalización.

## Persistencia y datos de demostración

SQLite guarda sus datos en `data/atlas.sqlite`. El archivo y sus auxiliares WAL están excluidos de Git.

Al iniciar el backend se crean o migran las tablas sin borrar los registros anteriores. Si todavía no existe, también se agrega el registro de demostración **Erik Aguilar Martínez** con consumo de 850 kWh. El proceso no reemplaza su consumo.

El catálogo físico también se conserva en SQLite. La primera ejecución incorpora cinco renglones iniciales (panel, inversor, estructura, cableado e instalación estándar) y cuatro proveedores mediante una carga idempotente: reiniciar el backend no duplica los registros ni restaura costos, existencias o estados que hayan sido modificados. Los materiales usan existencias enteras; los servicios muestran **No aplica** y no reciben un stock ficticio. Consultar o usar el catálogo en la calculadora no reserva ni descuenta piezas.

Para comprobar la persistencia desde la interfaz:

1. Inicia backend y frontend.
2. Entra como agente de ventas y abre **Cotización**.
3. Registra una solicitud mediante **Historial CFE** o **Por electrodomésticos**, usando un correo no registrado y una dirección válida.
4. Recarga la página del navegador e inicia sesión nuevamente.
5. Abre **Cotizaciones Emitidas**: la solicitud y su dirección deben seguir disponibles para el agente responsable.
6. Un técnico activo del mismo estado revisa la solicitud desde **Solicitudes de dimensionamiento**. El agente puede aprobarla después desde el detalle de su cotización.
7. Las cuentas nuevas crean su contraseña desde el enlace enviado por correo (o desde el `.eml` de `data/correos/` en modo simulado). Después inician sesión con su correo y esa contraseña.

### Cálculos energéticos

- Historial CFE: permite un recibo identificado por mes y año. Un consumo mensual se conserva y uno bimestral se divide entre dos para obtener un consumo mensual estimado.
- Electrodomésticos: `W × cantidad × horas / 1000` produce kWh diarios por aparato. Las potencias sugeridas son aproximadas y editables.
- Ambos métodos entregan a la calculadora un mes equivalente de 30 días: `kWh diarios × 30`.
- El consumo objetivo se calcula como `consumo mensual estimado × (1 + margen de crecimiento / 100)` y es el valor usado para estimar paneles. El consumo original y el equivalente mensual se conservan por separado.
- La necesidad nocturna solicitada es `kWh nocturnos × porcentaje de cobertura`. No selecciona batería, inversor ni condiciones comerciales.
- La potencia conectada suma potencias nominales; la simultaneidad real queda pendiente del dimensionamiento técnico.

También puedes consultar directamente:

```powershell
Invoke-RestMethod http://localhost:3001/api/prospectos
```

## API local

- `GET /api/health`: estado del backend.
- `GET /api/prospectos`: el Administrador consulta todos; cada Agente consulta únicamente sus propias solicitudes.
- `GET /api/prospectos/:id`: consulta un prospecto aplicando el mismo permiso de propietario para el Agente.
- `POST /api/solicitudes`: registra la solicitud completa, el agente responsable y la cuenta del prospecto; requiere Agente.
- `GET /api/solicitudes/:id`: consulta datos originales y resultados de una solicitud; requiere Administrador o Agente.
- `POST /api/login`: valida cuentas persistentes de personal y prospectos y entrega una sesión local.
- `POST /api/logout`: cierra la sesión local actual.
- `GET /api/personal`: lista técnicos y agentes; requiere sesión de Administrador.
- `POST /api/personal`: registra un Técnico o Agente con estado de trabajo y credencial temporal; requiere sesión de Administrador.
- `PATCH /api/personal/:id/activo`: activa o inactiva una cuenta sin eliminarla; requiere sesión de Administrador.
- `PATCH /api/personal/:id/estado-trabajo`: completa o corrige el estado de trabajo; requiere sesión de Administrador.
- `GET /api/productos`: consulta el catálogo; requiere Administrador, Agente o Técnico. Administrador también puede consultar los inactivos.
- `POST /api/productos`: agrega un producto o servicio; requiere Administrador.
- `PATCH /api/productos/:id`: corrige costo, existencias y demás datos del catálogo; requiere Administrador.
- `PATCH /api/productos/:id/activo`: realiza la baja o reactivación lógica; requiere Administrador.
- `GET /api/proveedores`: consulta proveedores; requiere Administrador, Agente o Técnico.
- `POST /api/proveedores`: registra un proveedor por nombre; requiere Administrador.
- `PATCH /api/proveedores/:id`: corrige el nombre de un proveedor; requiere Administrador.
- `PATCH /api/proveedores/:id/activo`: realiza la baja o reactivación lógica; requiere Administrador.
- `GET /api/tecnico/solicitudes`: lista solicitudes del estado de trabajo del técnico autenticado.
- `GET /api/tecnico/solicitudes/:id`: consulta el consumo, dirección y revisión técnica aplicando la misma restricción estatal.
- `POST /api/tecnico/solicitudes/:id/tomar`: asigna atómicamente una solicitud al técnico autenticado.
- `PUT /api/tecnico/solicitudes/:id/borrador`: guarda materiales y servicios con cantidad y costo histórico aplicado.
- `POST /api/tecnico/solicitudes/:id/completar`: bloquea la revisión técnica y deja la solicitud en preparación comercial.
- `POST /api/agente/solicitudes/:id/devolver`: devuelve la revisión al mismo técnico con un motivo persistente; requiere ser el Agente responsable.
- `POST /api/agente/solicitudes/:id/aprobar`: guarda una versión comercial y el precio final, y la envía al portal; requiere ser el Agente responsable.
- `POST /api/prospectos`: registra un prospecto y opcionalmente su consumo.
- `PATCH /api/prospectos/:id`: actualiza nombre, empresa, teléfono o estado.
- `PUT /api/prospectos/:id/consumo`: crea o actualiza consumo, ciudad y porcentaje de rendimiento utilizado por la calculadora.

El backend valida las entradas y todas las operaciones SQL con valores externos usan parámetros.

### Estados del flujo comercial

El modelo comercial admite `Información incompleta`, `Pendiente de revisión técnica`, `En preparación`, `Cotización enviada al prospecto`, `Aceptada, pendiente de pago` y `Venta confirmada`. La revisión técnica añade dos estados derivados y persistidos: `En revisión técnica`, cuando un técnico toma la solicitud, y `Revisión técnica completada`. Al completarla, el flujo comercial pasa a `En preparación`; todavía no se considera una cotización emitida hasta que el Agente responsable confirma el precio final.

La propuesta técnica conserva una copia del código, tipo, modelo, clasificación y costo unitario aplicado de cada producto. Cambiar posteriormente el catálogo no altera revisiones guardadas. Seleccionar cantidades no reserva ni descuenta existencias. Una devolución conserva motivo, fechas y técnico responsable. La aprobación crea una versión inmutable con los renglones y precio final; el portal recibe componentes, cantidades y precio, pero no recibe borradores ni costos internos. La aceptación, firma, pago verificado y orden de instalación se describen a continuación; el rechazo de una cotización por parte del prospecto queda pendiente.

## Firma, orden de pago y conversión a Cliente (integraciones 5 y 7)

Después de aprobar el agente una propuesta, el titular puede usar **Inicio → Aceptar cotización**. La pantalla sigue la sección 4.4 del PDF: conceptos a la izquierda y nombre, lienzo y conformidad a la derecha. El indicador tiene únicamente **Paso 1 de 2 · Firma** y **Paso 2 de 2 · Pago**. La Figura 15 repetida se sustituye por la descripción de 4.4.3: **Compra confirmada**, resumen y acceso a instalación.

El desglose comercial se obtiene prorrateando el precio final aprobado entre los conceptos según sus costos históricos. No expone dichos costos. Los subtotales se reparten en centavos y suman el precio final; el precio unitario puede mostrar hasta seis decimales por redondeo. La migración completa únicamente los precios de venta ausentes de versiones antiguas, conservando sus conceptos y total. El inventario posterior no interviene.

Al firmar se guardan el nombre escrito, PNG validado (máximo 180 KB y dimensiones acotadas; no se acepta un lienzo vacío), conformidad, cuenta autenticada, fecha UTC del servidor, IP y agente de usuario. Se conserva un snapshot JSON de la propuesta aceptada con huella SHA-256. La firma permanece en SQLite, sin archivos públicos; únicamente el dueño y el personal autorizado pueden consultar el PDF firmado. Es una aceptación con trazo registrado, no una firma con certificado digital.

La misma transacción crea una sola orden de pago por cotización. Firmar cambia la solicitud a `aceptada_pendiente_pago`, pero no confirma dinero, no convierte a Cliente y no genera instalación. El administrador usa **Verificación de pagos** para comprobar el depósito completo fuera de ATLAS y registrar fecha/hora real, referencia verificable y conformidad con la recepción. No existe pasarela ni verificación bancaria automática. Un pago parcial no debe confirmarse desde este formulario.

Solo tras esa confirmación se guarda `cuentas_cliente.cliente_desde`, se marca `venta_confirmada` y se genera una única fila en `ordenes_instalacion`. Se asigna al técnico que preparó la revisión si sigue activo y su estado coincide con la dirección; no se inventa una fecha de visita. El rol técnico de acceso existente `Cliente` se conserva para no romper sesiones y permisos; la identidad comercial visible será **Prospecto** hasta `cliente_desde`, y **Cliente** después. No se marca `etapa_cliente = cliente_instalado`: pagar no prueba que la instalación terminó. El portal se actualiza al navegar, recuperar foco y cada 30 segundos. Las sesiones continúan perdiéndose al reiniciar el backend.

### Configurar instrucciones y vencimiento

En `.env` (ver `.env.example`) pueden definirse:

```dotenv
ATLAS_PAGO_PLAZO_DIAS=7
ATLAS_PAGO_INSTRUCCIONES=
```

Completa las instrucciones con datos de cobro **reales y autorizados** antes de emitir órdenes; pueden incluir beneficiario, banco, cuenta y procedimiento. Con el valor vacío se muestra **Instrucciones de pago pendientes**, tanto en pantalla como en el PDF. No se inventa una cuenta bancaria. Cada orden conserva las instrucciones vigentes al crearla; modificar `.env` y reiniciar afecta solo a órdenes posteriores. Las instrucciones de órdenes anteriores permanecen disponibles para consulta y deben aclararse con el agente si faltan.

El plazo admite 1 a 365 días, por defecto siete. Al vencer, la orden pasa a `vencida` y la cotización a `pago_vencido`; la solicitud conserva `aceptada_pendiente_pago`. El vencimiento se registra una sola vez al consultar y al arrancar el backend (incluidos vencimientos durante un apagado). Nunca genera una venta. El administrador puede confirmar un pago real fuera de plazo únicamente indicando también un motivo; se conservan fecha de vencimiento, fecha real del pago, referencia, administrador y fecha de confirmación. No existe renovación automática ni una nueva orden al pulsar otra vez firmar.

### Documentos y rutas protegidas

Los documentos se generan con `pdf-lib` en el servidor a partir de los datos persistidos. Después de firmar, la cotización incluye snapshot, trazo y constancia fechada; se recupera incluso después de reiniciar, sin depender de `window.print()`. El generador antiguo por impresión se conserva para su vista previa anterior, pero este flujo usa las nuevas rutas:

- `GET /api/portal/cotizaciones/:id`: detalle comercial del titular, aceptación y orden.
- `POST /api/portal/cotizaciones/:id/firmar`: exige titular, estado pendiente, nombre, PNG y conformidad. Una repetición responde `409`.
- `GET /api/cotizaciones/:id/pdf`: dueño, agente responsable o administrador; devuelve el documento económico y, si existe, la constancia de firma.
- `GET /api/portal/ordenes-pago/:id/pdf`: descarga de la orden del titular. La orden identifica cuánto pagar; no es un comprobante de depósito.
- `GET /api/admin/pagos`: administrador; órdenes y auditoría.
- `POST /api/admin/pagos/:id/confirmar`: administrador activo; fecha real ISO UTC, referencia, `verificado: true` y motivo si venció. Repetir devuelve `409`.

Las restricciones únicas y transacciones evitan firmas, órdenes de pago, eventos de confirmación y órdenes de instalación duplicadas. Los PDF y respuestas del portal nunca incluyen costos internos. La papelera existente mantiene sus permisos, respaldo y confirmaciones; su eliminación definitiva incluye los registros de pago vinculados.

### Probar el recorrido local

1. Ejecuta `npm ci`, `npm run server` y `npm run dev` en las terminales correspondientes. No hace falta SMTP para este flujo; sin configurar correo se generan `.eml`.
2. Agente (`ventas@atlas.com` / `123`): registra una solicitud nueva; crea la contraseña de su prospecto desde el enlace del `.eml`.
3. Administrador: comprueba que el técnico esté activo y tenga el mismo estado de trabajo que la dirección. Técnico: toma, agrega componentes y completa la revisión. Agente: aprueba con precio de venta final.
4. Prospecto: abre Inicio, **Aceptar cotización**, revisa el PDF y desglose, escribe nombre, traza firma y marca conformidad. **Firmar y aceptar** abre la orden. Recarga: debe seguir **Pago pendiente**, rol **Prospecto**, sin instalación. Repetir la firma no crea otra orden.
5. Prueba con otra cuenta: no debe acceder a la cotización ni a su orden. Una cuenta de agente o prospecto tampoco puede confirmar pagos.
6. En una base aislada de pruebas, administrador → **Verificación de pagos**: registra los datos de verificación de una operación de prueba. En una base de uso real, confirma exclusivamente dinero efectivamente recibido. El prospecto verá **Compra confirmada**, rol **Cliente**, su documento firmado y **Consultar mi instalación**. Reinicia el backend e inicia sesión de nuevo: los mismos registros deben conservarse.
7. Ejecuta `npm test`, `npm run lint` y `npm run build`. `server/compras.test.js` usa bases y correos temporales: comprueba firma válida/ajena/vacía/duplicada, PDF con imagen, reinicio, orden pendiente/vencida, permisos administrativos, costos históricos, stock intacto, cuenta única e instalación única. `shared/preciosVenta.test.js` comprueba los centavos del prorrateo.

Pendiente: pasarela bancaria, pagos parciales, conciliación automática, reasignación administrativa y seguimiento detallado de instalación (etapas, evidencias, incidencias). El técnico responsable ya puede consultar e iniciar la instalación; el cliente puede consultar el inicio registrado. No se implementaron compras ni descuentos de almacén.

## Verificaciones

### PDF formales y pago simulado de desarrollo

La cotización aceptada se descarga en A4 con identidad violeta de ATLAS, datos del prospecto, resumen del proyecto disponible, tabla de todos los materiales/servicios y total de venta. La constancia conserva folio, versión, firmante, trazo, fecha UTC del servidor y huella de la propuesta aceptada. No toma el encabezado ni la fecha de impresión del navegador. Las firmas anteriores siguen leyendo su snapshot original; no se les añaden condiciones ni importes nuevos. No se desglosa IVA porque este flujo no persiste esos importes fiscales.

La orden de pago es una boleta separada, con importe destacado, fecha límite y talón de folio/referencia. **Esta orden no es un comprobante de pago realizado**. Los textos largos y tablas continúan en otras páginas con márgenes y encabezados repetidos.

Además de `ATLAS_PAGO_INSTRUCCIONES`, pueden configurarse en `.env` los campos opcionales `ATLAS_PAGO_BENEFICIARIO`, `ATLAS_PAGO_BANCO`, `ATLAS_PAGO_CLABE` (18 dígitos), `ATLAS_PAGO_CUENTA` y `ATLAS_PAGO_REFERENCIA`. Completar únicamente datos reales autorizados. Se guardan con la orden nueva; cambiar la configuración no altera órdenes anteriores. Si no hay instrucciones ni datos de cobro completos, se muestra **Instrucciones de pago pendientes**. El folio de la orden sirve como referencia de identificación; no se genera un QR ni código de barras decorativo.

El botón circular de prueba está **activo por defecto** al ejecutar `npm run server` y `npm run dev`, incluso sin `.env`. Aparece en **Inicio → Pago pendiente**, después de firmar una cotización con una orden vigente. No hay que activar variables manualmente.

Estas variables son opcionales y permiten sobrescribir los valores por defecto; usar `false` desactiva la simulación:

```dotenv
NODE_ENV=development
ATLAS_PAGO_SIMULADO=true
VITE_ATLAS_PAGO_SIMULADO=true
```

Opcionalmente usa otra base local mediante `ATLAS_DB_PATH=./data/atlas-pruebas.sqlite` si quieres separar tus registros de prueba. No se cambia automáticamente tu base ni se crean órdenes de prueba al arrancar. `NODE_ENV=production` sigue bloqueando la operación; un build nunca muestra el botón.

El botón espera cinco segundos mostrando procesamiento. Después llama a `POST /api/portal/ordenes-pago/:id/simular` y vuelve a consultar el portal desde el servidor. El temporizador por sí solo no convierte la cuenta. Si la petición falla se muestra el error y se conserva la vista anterior; abandonar la pantalla cancela la espera. Solo el titular autenticado de una orden pendiente puede simularla; una orden vencida o ya pagada realmente no es elegible. Las repeticiones de una simulación ya exitosa son idempotentes y devuelven el mismo resultado.

La operación guarda `ordenes_pago.pago_simulado = 1`, `simulada_por` (cuenta), `confirmada_at` y un evento de auditoría identificado como simulado. No rellena fecha de depósito, referencia bancaria ni administrador ficticio. En una sola transacción cambia la compra, convierte a Cliente y crea una instalación única. La interfaz, el listado administrativo y la orden PDF muestran **Pago simulado · Prueba de desarrollo**; esa marca permanece aunque posteriormente se desactive el modo. Para probar el flujo completo, los dashboards suman estos pagos al total de ingresos confirmados y muestran por separado **Reales** y **Prueba**. El administrador ve el total global; cada agente únicamente el de sus solicitudes. La verificación administrativa de pagos reales sigue disponible y no convierte una simulación previa en un depósito real.

El botón circular es pequeño y no tiene icono ni texto visible; conserva nombre accesible y estado de procesamiento para lectores de pantalla. Tras confirmar el pago se crea una orden vinculada al técnico que realizó el dimensionamiento de la cotización aceptada. Ese técnico entra en **Órdenes de instalación → Continuar instalación**, programa la visita y registra sus avances. Las órdenes anteriores conservan su responsable. Repetir la confirmación, la toma o el inicio no duplica órdenes ni cambia las primeras fechas registradas.

Rutas relacionadas: `GET /api/ventas/resumen` (administrador/agente, con propietario obtenido de la sesión), `GET /api/tecnico/instalaciones` y `POST /api/tecnico/instalaciones/:id/iniciar` (técnico activo, mismo estado y responsable). Los listados se actualizan al navegar o recuperar foco y periódicamente cada 30 segundos. La vista temporal «Mis Tickets» se retiró; el trabajo de campo utiliza las órdenes persistentes.

La migración conserva los registros existentes como `pago_simulado = 0`. Si la tabla antigua de órdenes contiene filas, crea un respaldo en la carpeta `backups` junto a la base antes de reconstruir exclusivamente su restricción de confirmación, preservando IDs, contador e integridad de relaciones.

**Comprobar producción:** `npm run build` y `npm run preview` nunca muestran el botón, incluso si se compila con la bandera frontend activada. `vite.config.js` incorpora una marca que únicamente es verdadera durante `vite serve` de desarrollo. Con `NODE_ENV=production`, el servidor responde `403` al endpoint de simulación aunque `ATLAS_PAGO_SIMULADO=true` y la sesión/orden sean válidas. Desactivar solo el frontend no es la protección: la condición de desarrollo se comprueba también en el servidor. Pruebas automatizadas: `server/pagoSimulado.test.js`, `src/pagoPrueba.test.js` y `server/documentosCompra.test.js`; además se mantienen las pruebas de pagos reales y persistencia.

```powershell
npm test
npm run lint
npm run build
```

## Integración 4 · Seguimiento de instalación en campo

La confirmación real o de desarrollo de un pago crea **una sola** fila en `ordenes_instalacion` ligada a la cotización aceptada y con `tecnico_id` obtenido de `cotizaciones_versiones.revision_id → revisiones_tecnicas.tecnico_id`. Solo el técnico autor de ese dimensionamiento puede listar y abrir su instalación: otro técnico del mismo estado tampoco la ve. Se conserva el requisito de técnico activo y coincidencia con `direcciones_cliente.estado_codigo`. No hay asignación administrativa ni selección de un técnico distinto desde el navegador. Las órdenes pagadas sin dirección válida quedan fuera de las consultas por zona.

El menú técnico **Órdenes de instalación** muestra únicamente sus propios proyectos dimensionados, con cliente, ubicación, cotización y fecha programada. La misma regla se verifica en el servidor al consultar detalle/fotos, programar, guardar avances, registrar/resolver incidencias, postergar o finalizar. Las nuevas órdenes se abren con **Continuar instalación**, sin competir por ellas. Para órdenes antiguas con `tecnico_id` vacío se mantiene **Tomar orden**, pero solo puede usarlo el autor del dimensionamiento; la toma es transaccional e idempotente. Las órdenes antiguas conservan IDs, responsables, fechas, estados y evidencias. No se transfieren órdenes en curso a otro técnico: una asignación histórica que contradiga al dimensionador requiere revisión de sus datos, no una reasignación silenciosa. Se preservan las filas anteriores de `checklist_evidencias` sin interpretarlas como verificaciones nuevas ya realizadas.

### Trabajo por partes y estados

**Inicio del Cliente:** `GET /api/portal/proyectos` devuelve exclusivamente compras pagadas de la cuenta autenticada, con la cotización aceptada y su orden correspondiente. El selector mantiene juntos folio, importe, documentos y seguimiento; «Consultar mi instalación» conserva la cotización elegida incluso cuando aún no existe una orden consultable. El técnico mostrado se obtiene de la revisión de dimensionamiento ligada a esa versión, nunca de un reparto por zona.

La tarjeta «Estado de mi instalación» usa cuatro hitos fijos: **Pago confirmado**, **Preparación**, **Montaje y conexiones**, **Verificación final**. El pago proviene de `ordenes_pago.estado='pagada'`; las fases usan verificaciones y fotos guardadas de cada parte, no la parte abierta. Antes del inicio no hay pulsación. En curso se destaca la primera parte todavía no completada; la verificación final requiere además `ordenes_instalacion.estatus_obra='completada'`. Incidencias/postergaciones conservan los hitos alcanzados y suspenden el pulso. `prefers-reduced-motion` sustituye la animación por una marca estática. Las fechas de visita y cierre provienen de la orden; el próximo mantenimiento solo aparece si ya hay una fila pendiente/agendada con fecha futura en `mantenimientos_programados`. Este resumen no crea órdenes, fechas ni mantenimientos, y no publica notas o imágenes privadas.

1. **Preparación:** materiales/equipos de la cotización, herramientas/protección y condiciones del lugar.
2. **Montaje y conexiones:** actividades de estructura, paneles, inversor, cableado, baterías y materiales adicionales solo cuando esos tipos de material están en `cotizacion_version_items`. Siempre se revisan las conexiones/protecciones aplicables al alcance; si falta un elemento necesario debe registrarse una incidencia, no darlo por instalado.
3. **Verificación final:** conexiones, equipos/funcionamiento y condiciones generales de entrega.

Los ítems y explicaciones están en `shared/instalacion.js`. Son verificaciones de campo; no declaran certificaciones ni sustituyen el criterio técnico. **Supuesto de esta etapa:** todas las actividades generadas son obligatorias y se exige al menos **una fotografía por parte**. El equipo proviene de la versión aprobada, no del inventario mutable. No se reserva ni descuenta stock.

El responsable programa fecha y hora antes de iniciar. Se guarda en UTC; se muestra en la zona horaria del navegador. `iniciada_at`, `tomada_at` y `fecha_fin_real` las establece el servidor. La fecha real final es distinta de la programada. Los códigos existentes `asignada`, `en_progreso`, `incidencia`, `completada` se conservan; la interfaz distingue **No tomada**, **Tomada, pendiente de inicio**, **En proceso**, **Postergada**, **Con incidencia** y **Finalizada** mediante responsable, fechas y estado real. Postergar conserva motivo y asignación; reanudar permite actualizar la fecha programada. Una incidencia tiene prioridad en el estado visible mientras esté abierta.

**Guardar borrador** conserva avances parciales. **Siguiente avance** guarda de forma conjunta actividades, observaciones y fotos; exige terminar esa parte y deja abierta la siguiente. Volver a partes anteriores conserva lo escrito en memoria; guardar es necesario antes de salir para recuperarlo tras cerrar sesión o reiniciar. **Cancelar** abandona los cambios todavía no guardados; una toma o guardado ya confirmado se conserva. Los errores de validación revierten tanto las actividades como los metadatos y archivos nuevos de ese guardado. Se comprueba `revision_avance` para evitar sobrescribir desde una pestaña desactualizada. Cada guardado/incidencia lleva una clave de operación y cada foto una clave de carga; los reintentos idénticos no duplican filas ni archivos.

**Registrar incidencia** está disponible durante el trabajo. Conserva parte, actividad opcional, descripción, fecha de lo ocurrido (o fecha del servidor), técnico y evidencia opcional. La resolución exige una explicación y registra quién/cuándo resolvió. Finalizar requiere actividades y fotos de las tres partes, inicio/programación y **cero incidencias pendientes**. La instalación finalizada queda de solo consulta y repetir el cierre conserva la primera fecha real. Un estado antiguo `incidencia` sin detalle no se interpreta como resuelto: el técnico debe documentarlo mediante una incidencia y su resolución.

### Evidencia privada y persistencia

Se extienden `ordenes_instalacion` y `checklist_evidencias` mediante columnas compatibles. Se añaden `incidencias_instalacion`, `fotos_instalacion` y `operaciones_instalacion`; las relaciones y restricciones evitan duplicados sin reiniciar la base. Las imágenes **no se guardan en SQLite ni localStorage**. Los metadatos incluyen orden, parte, actividad/incidencia, técnico, descripción, fecha del servidor, tamaño, MIME y SHA-256. Los archivos tienen nombres generados por el servidor.

Ruta predeterminada: `evidencias/` junto a la base SQLite (`data/evidencias/` normalmente), excluida de Git. `ATLAS_EVIDENCIAS_DIR` permite configurarla; debe permanecer fuera de `public/` y de cualquier servidor estático. Se aceptan PNG/JPEG, hasta 5 MB y 24 megapíxeles por foto, máximo tres por petición. Se valida contenido, dimensiones, tipo y tamaño en backend. El transporte JSON codifica las imágenes únicamente durante el envío; el guardado es en archivos separados. La consulta exige autenticación y responsabilidad/zona de la orden; también la permite un administrador activo. El cliente no puede acceder a este endpoint.

Respalde **SQLite y la carpeta de evidencias conjuntamente**. Una interrupción del proceso justo después de escribir un archivo y antes del COMMIT puede dejar un archivo huérfano sin referencia, nunca una foto publicada: su limpieza y la purga física de fotos tras eliminación definitiva quedan como tarea operativa posterior. La papelera conserva/borra metadatos con sus órdenes y presenta sus conteos; los archivos no se publican ni se eliminan automáticamente en esa operación.

### Portal del cliente y mantenimiento

**Mi instalación** consulta `GET /api/portal/instalaciones`, restringido por cuenta/prospecto de la sesión y pago confirmado. Permite elegir orden cuando hay varias compras. Muestra estado, programación, responsable, progreso de las tres partes, fecha final y avisos genéricos de incidencias/postergación. No expone notas internas, descripciones de incidencias ni fotografías. Antes de tener una orden muestra un estado vacío. El seguimiento se actualiza al navegar, recuperar foco, pulsar actualizar y cada 30 segundos.

La tabla `mantenimientos_programados` ya existe, pero no hay un cálculo vigente de campañas a seis/doce meses. Esta integración conserva `fecha_fin_real` y la cadena orden → cotización → solicitud → cliente para que integración 7 use esa fecha real como base. No genera mantenimientos ni campañas anticipadas y no duplica ese módulo.

### Endpoints y comprobación local

- Técnico: `GET /api/tecnico/instalaciones`, `GET /api/tecnico/instalaciones/:id` y `POST` en `:id/tomar`, `:id/iniciar`, `:id/avance`, `:id/postergar`, `:id/finalizar`, `:id/incidencias` y `:id/incidencias/:incidencia/resolver`.
- Fotos privadas: `GET /api/instalaciones/:id/fotos/:foto` (técnico responsable de la zona o administrador activo).
- Cliente: `GET /api/portal/instalaciones` (solo sus propias compras pagadas).

Inicie `npm run server` y `npm run dev`. Cree una solicitud como agente, complete dimensionamiento, emita y firme la cotización y confirme su pago. Con la misma cuenta del técnico que dimensionó ese proyecto abra **Órdenes de instalación → Continuar instalación**. Programe la visita, marque actividades, seleccione una foto y pulse **Siguiente avance**. Otro técnico, incluso del mismo estado, no debe ver ni abrir esa orden. Pruebe guardar un borrador y recargar, registrar/resolver una incidencia y cerrar después de completar las tres partes. Entre con el titular para consultar **Mi instalación**.

`server/instalaciones.test.js` usa una base y archivos temporales para comprobar zona/permisos, toma simultánea, programación, partes, rollback, archivos privados, idempotencia, reinicio, incidencias, aislamiento por cliente y cierre sin movimientos de inventario. Ejecutar `npm test`, `npm run lint` y `npm run build`.

## Integración 6 · Ahorro e inversión (contado)

En «Datos de la estimación» se oculta el gasto eléctrico con sistema, conservándolo en el cálculo y en la copia persistida. En la gráfica, antes de recuperar la inversión se muestra el importe faltante; a partir del cruce se muestra **Ahorro neto acumulado = ahorro acumulado estimado − inversión inicial**. El ahorro anual y el acumulado total siguen disponibles en el mismo tooltip; todas estas cantidades siguen siendo estimaciones.

Disponible en el menú **solo después de confirmar el pago**: se conserva el rol técnico de sesión `Cliente` del login existente, pero el servidor exige además `cuentas_cliente.cliente_desde` y una orden `pagada` propiedad del usuario. Firmar o emitir una orden pendiente no habilita esta sección. La confirmación administrativa y la simulación local pasan por la misma conversión; una simulación sigue identificada como tal en su auditoría original.

`GET /api/portal/ahorro` lista únicamente las compras confirmadas del titular; `GET /api/portal/ahorro/:cotizacionId` devuelve la proyección de esa compra. Un Prospecto recibe `403`, incluso con un token válido; un Cliente que solicita una compra ajena o no pagada recibe `404`. El portal general no expone estas proyecciones. El selector identifica cotización, versión, folio de pago, fecha e importe para evitar mezclar proyectos. El botón de cotización abre el PDF firmado de la versión seleccionada.

La tabla nueva `proyecciones_compra` guarda una copia por cotización, con importe de contado, resultados, consumo, paneles, radiación, tarifas completas y parámetros. Se crea al confirmar el pago, dentro de su transacción. Las compras confirmadas anteriores se incorporan al consultarlas, exclusivamente a partir de `cotizaciones_versiones.supuestos_ahorro`: nunca se sustituyen sus datos por el inventario o tarifas actuales. No se borra ni reinicia la base. Si la cotización antigua carece de datos, se conserva la explicación y no se muestran ahorros ficticios.

### Fórmulas, unidades y supuestos

Las funciones puras están en `shared/proyeccionContado.js` y `shared/ahorroSolar.js`:

- Inversión: importe íntegro confirmado de la orden de pago (MXN), correspondiente al precio aceptado. Solo contado; sin intereses ni mensualidades.
- Generación anual (kWh/año) = potencia de paneles (kWp) × horas solares pico diarias × 365 × eficiencia. Se distribuye uniformemente entre 12 meses.
- Se considera el consumo mensual original normalizado, **sin sumar el margen de crecimiento otra vez**. La potencia instalada ya procede de los paneles de la cotización. El consumo objetivo se muestra aparte.
- Consumo neto mensual = máximo entre consumo considerado menos generación anual / 12 y cero. No se pagan excedentes, no se acumulan saldos y no se modelan horarios/baterías ni condiciones reales de compensación de CFE.
- Gasto mensual antes/después: energía por bloques de la tarifa capturada, cargo fijo e impuesto eléctrico configurado. Se ponderan las temporadas según los meses de verano guardados. DAC se evalúa con un solo mes, no con el promedio real de 12 meses. No incluye cobro mínimo ni alumbrado público.
- Ahorro mensual = gasto estimado sin sistema − gasto estimado con sistema; ahorro anual = doce meses. Se calcula con precisión interna y se redondea al mostrar, por lo que puede haber centavos de diferencia.
- La serie anual aplica al ahorro del primer año los factores `(1 − degradación_anual)^(año − 1)` y `(1 + alza_tarifa_anual)^(año − 1)`. Es una aproximación del ahorro, no una simulación de facturación futura. La recuperación interpola el primer año en que el acumulado cubre la inversión; con factores cero equivale a inversión / ahorro anual. Se evalúan hasta 30 años; la gráfica muestra al menos 10 y, si se recupera, hasta dos años posteriores al cruce. Ahorro cero o sin cruce: recuperación no alcanzada, nunca división por cero.

**Configuración:** Administrador → **Tarifas y ahorro**, tablas `tarifas_cfe`, `tarifas_bloques`, `tarifas_estados` y `parametros_ahorro`. Los precios iniciales están vacíos deliberadamente. Capture y compruebe precios, bloques y cargos antes de emitir la cotización; no hay descarga automática ni garantía de tarifas vigentes. La pantalla muestra los importes capturados como **supuestos eléctricos**, con advertencia si siguen pendientes de validar. Los valores iniciales de parámetros son eficiencia 80 %, degradación aproximada 0.5 % anual del ahorro, alza eléctrica 0 %, impuesto eléctrico 16 % y seis meses de verano; se usan los valores guardados en cada cotización, no necesariamente estos iniciales. La radiación se toma de `shared/irradiacion.js` (fuente identificada por estado; se advierte cuando es valor de referencia). El impuesto eléctrico no implica que el precio de venta de la compra tenga un desglose de IVA.

No incluye mantenimiento, reemplazos, inflación distinta del alza configurada, descuento financiero, financiamiento ni beneficios fiscales. Es una estimación aproximada, nunca ahorro garantizado. Una tarifa sin precios, falta de potencia, datos inválidos o una cotización antigua incompleta muestran un motivo, conservando visible el importe de la compra.

### Probar el recorrido

1. Inicie backend con `npm run server` y frontend con `npm run dev`, en terminales distintas. Para obtener cifras, configure primero los supuestos eléctricos como administrador.
2. Registre una solicitud como agente; complete componentes como técnico y emita la cotización como agente. Entre con el titular: **Ahorro e inversión** todavía no aparece.
3. Firme: la orden sigue pendiente y la sección continúa bloqueada. Confirme el pago real como administrador, o use el botón de simulación en desarrollo. La cuenta pasa a Cliente y aparece **Ahorro e inversión**.
4. Abra la sección, compruebe las tarjetas, la tabla de la gráfica y el PDF de la cotización seleccionada. Con datos incompletos verá el motivo, no ceros inventados. Para distintas compras seleccione cada cotización y compruebe su importe.
5. Recargue o reinicie el backend y vuelva a iniciar sesión: la proyección se conserva. Editar luego el catálogo o las tarifas no cambia esa copia histórica.

Pruebas nuevas: `shared/proyeccionContado.test.js` y `server/ahorroCompras.test.js` (base temporal aislada): permisos, pago real/simulado, coherencia numérica, varias compras, datos faltantes, ahorro cero, horizonte agotado, copia histórica y reinicio. Ejecutar `npm test`, `npm run lint` y `npm run build`.

## Alcance temporal pendiente

Todavía se guardan únicamente en `useState` y se pierden al recargar:

- el token y el usuario de la sesión actual;
- clientes inactivos y resultados de reactivación;
- la vista previa de precio del generador de cotización;
- resultados calculados y margen comercial del generador.

El dashboard cuenta solicitudes y estados desde SQLite. Los ingresos suman únicamente ventas cuyo pago fue confirmado, con su precio de venta persistido.

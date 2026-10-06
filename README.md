# ATLAS CRM Solar

Prototipo de CRM para dimensionar instalaciones solares. El frontend usa React, Vite y Tailwind CSS. El backend local con Express y SQLite conserva solicitudes de cotización, consumos, detalle CFE o por electrodomésticos y cuentas de clientes.

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
5. Vuelve a **Cotización**: la solicitud y su dirección deben seguir listadas.
6. Abre **Dimensionar Proyecto**: debe mostrar el consumo mensual equivalente y tomar la ciudad o municipio de la dirección. Los municipios sin irradiación propia usan la categoría técnica `Otra`.
7. Cierra sesión e inicia con el correo capturado y la contraseña temporal `123`; debe abrirse el portal del cliente.

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

La propuesta técnica conserva una copia del código, tipo, modelo, clasificación y costo unitario aplicado de cada producto. Cambiar posteriormente el catálogo no altera revisiones guardadas. Seleccionar cantidades no reserva ni descuenta existencias. Una devolución conserva motivo, fechas y técnico responsable. La aprobación crea una versión inmutable con los renglones y precio final; el portal recibe componentes, cantidades y precio, pero no recibe borradores ni costos internos. Todavía falta registrar la aceptación o rechazo del prospecto, firma, pago y orden de instalación.

## Verificaciones

```powershell
npm run lint
npm run build
```

## Alcance temporal pendiente

Todavía se guardan únicamente en `useState` y se pierden al recargar:

- el token y el usuario de la sesión actual;
- clientes inactivos y resultados de reactivación;
- tickets técnicos de instalación y mantenimiento;
- la vista previa de precio del generador de cotización;
- resultados calculados y margen comercial del generador.

El dashboard cuenta solicitudes y estados desde SQLite. Los ingresos permanecen en cero mientras no exista una venta confirmada con precio persistido.

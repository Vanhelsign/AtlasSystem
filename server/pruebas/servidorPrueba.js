// Levanta la API con una base de datos en una carpeta temporal del sistema y un puerto propio.
// Nunca usa data/atlas.sqlite ni data/correos/: todo vive en la carpeta temporal, que se borra al detener.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { randomBytes, scryptSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

const raizProyecto = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

export async function iniciarServidorPrueba(entornoExtra = {}) {
  const carpeta = mkdtempSync(join(tmpdir(), 'atlas-prueba-'))
  const base = join(carpeta, 'atlas.sqlite')
  const carpetaCorreos = join(carpeta, 'correos')
  for (const ruta of [base, carpetaCorreos]) {
    if (resolve(ruta).startsWith(join(raizProyecto, 'data'))) throw new Error('Las pruebas no pueden escribir en data/')
  }
  const puerto = 41000 + Math.floor(Math.random() * 9000)
  // Sin el .env real (ATLAS_ENV_ARCHIVO apunta a un archivo inexistente) ni variables de correo heredadas:
  // las pruebas trabajan en modo simulado salvo que entornoExtra configure otro SMTP.
  const heredado = Object.fromEntries(Object.entries(process.env).filter(([nombre]) => !/^(SMTP_|CORREO_|APP_URL$)/.test(nombre)))
  const proceso = spawn(process.execPath, ['--no-warnings', join(raizProyecto, 'server', 'api.js')], {
    cwd: carpeta,
    env: {
      ...heredado,
      ATLAS_PORT: String(puerto),
      ATLAS_DB_PATH: base,
      ATLAS_ENV_ARCHIVO: join(carpeta, 'sin-env'),
      ATLAS_CORREOS_DIR: carpetaCorreos,
      APP_URL: 'http://atlas.example',
      ...entornoExtra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let salida = ''
  proceso.stdout.on('data', (dato) => { salida += dato })
  proceso.stderr.on('data', (dato) => { salida += dato })
  const url = `http://localhost:${puerto}/api`
  let listo = false
  for (let intento = 0; intento < 80 && !listo; intento += 1) {
    try { listo = (await fetch(`${url}/health`)).ok } catch { await espera(150) }
  }
  if (!listo) { proceso.kill(); throw new Error(`El servidor de prueba no arrancó:\n${salida}`) }

  // `ip` simula la IP del navegador que enviaría un proxy local (X-Forwarded-For).
  const pedir = async (ruta, { metodo = 'GET', token, cuerpo, crudo, ip } = {}) => {
    const respuesta = await fetch(`${url}${ruta}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
      },
      body: crudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)),
    })
    const texto = await respuesta.text()
    let datos
    try { datos = texto ? JSON.parse(texto) : null } catch { datos = texto }
    return { estado: respuesta.status, datos, texto }
  }
  const iniciarSesion = async (email, password = '123') => pedir('/login', { metodo: 'POST', cuerpo: { email, password } })
  // Acceso directo a la base temporal, para preparar casos (por ejemplo, activar el cambio obligatorio).
  const sql = (consulta, ...parametros) => {
    const db = new DatabaseSync(base)
    try { return db.prepare(consulta).run(...parametros) } finally { db.close() }
  }
  const sqlTodas = (consulta, ...parametros) => {
    const db = new DatabaseSync(base, { readOnly: true })
    try { return db.prepare(consulta).all(...parametros) } finally { db.close() }
  }
  // Correos del modo simulado (.eml) guardados en la carpeta temporal.
  const correos = () => existsSync(carpetaCorreos) ? readdirSync(carpetaCorreos).sort() : []
  const leerCorreo = (archivo) => leerEml(readFileSync(join(carpetaCorreos, archivo), 'utf8'))
  const detener = async () => {
    proceso.kill()
    await new Promise((r) => proceso.once('exit', r))
    rmSync(carpeta, { recursive: true, force: true })
  }
  return { url, base, carpeta, carpetaCorreos, pedir, iniciarSesion, sql, sqlTodas, correos, leerCorreo, salida: () => salida, detener }
}

// Decodifica lo necesario de un .eml para las pruebas: encabezados y las partes de texto y HTML.
function decodificarParte(cuerpo, codificacion = '') {
  if (/quoted-printable/i.test(codificacion)) {
    const bytes = cuerpo.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    return Buffer.from(bytes, 'latin1').toString('utf8')
  }
  if (/base64/i.test(codificacion)) return Buffer.from(cuerpo.replace(/\s+/g, ''), 'base64').toString('utf8')
  return cuerpo
}
export function leerEml(crudo) {
  const contenido = crudo.replace(/\r\n/g, '\n')
  const [cabecera] = contenido.split('\n\n')
  const encabezados = Object.fromEntries(cabecera.replace(/\n[ \t]+/g, ' ').split('\n').map((linea) => {
    const separador = linea.indexOf(':')
    return [linea.slice(0, separador).toLowerCase(), linea.slice(separador + 1).trim()]
  }))
  const partes = {}
  for (const bloque of contenido.split(/\n--[^\n]+\n/)) {
    const [cabeceraParte, ...resto] = bloque.split('\n\n')
    const tipo = /content-type:\s*text\/(plain|html)/i.exec(cabeceraParte)?.[1]?.toLowerCase()
    if (!tipo || partes[tipo]) continue
    const codificacion = /content-transfer-encoding:\s*([\w-]+)/i.exec(cabeceraParte)?.[1]
    partes[tipo] = decodificarParte(resto.join('\n\n').replace(/\n--[^\n]*--\s*$/, ''), codificacion)
  }
  return { encabezados, texto: partes.plain ?? '', html: partes.html ?? '', crudo }
}

// Hash con el mismo formato que server/api.js, para simular cuentas creadas antes de la Fase 4.
function hashPrueba(password) {
  const salt = randomBytes(16).toString('hex')
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') }
}

// Registra una solicitud como el agente de prueba y devuelve la respuesta de la API.
// Por defecto deja la cuenta como las creadas antes de la Fase 4 (contraseña 123, sin cambio obligatorio),
// que es lo que esperan las pruebas de contraseñas y sesiones. Con { contrasena: null } conserva la temporal.
export async function registrarSolicitudPrueba(servidor, email, estado = 'Nuevo León', { contrasena = '123' } = {}) {
  const { datos } = await servidor.iniciarSesion('ventas@atlas.com')
  const respuesta = await servidor.pedir('/solicitudes', {
    metodo: 'POST',
    token: datos.token,
    cuerpo: {
      cliente: { nombre: `Cliente ${email}`, telefono: '8100000000', email },
      direccion: { estado, municipio: 'Monterrey', colonia: 'Centro', codigo_postal: '64000', calle: 'Zaragoza', numero_exterior: '1' },
      modalidad: 'historial_cfe',
      historial_cfe: [{ consumo_kwh: 300, periodo: 'mensual', mes_inicio: '2026-08' }],
      configuracion: { margen_crecimiento_pct: 10, cubrir_baterias: false },
    },
  })
  if (respuesta.estado !== 201) throw new Error(`No se pudo registrar la solicitud de prueba: ${respuesta.texto}`)
  if (contrasena !== null) {
    const { hash, salt } = hashPrueba(contrasena)
    servidor.sql('UPDATE cuentas_cliente SET password_hash = ?, password_salt = ?, debe_cambiar_password = 0 WHERE email = ?', hash, salt, email)
  }
  return respuesta.datos
}

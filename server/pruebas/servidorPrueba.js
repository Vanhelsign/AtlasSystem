// Levanta la API con una base de datos en una carpeta temporal del sistema y un puerto propio.
// Nunca usa data/atlas.sqlite ni data/correos/: todo vive en la carpeta temporal, que se borra al detener.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

const raizProyecto = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

export async function iniciarServidorPrueba(entornoExtra = {}) {
  const carpeta = mkdtempSync(join(tmpdir(), 'atlas-prueba-'))
  const base = join(carpeta, 'atlas.sqlite')
  if (resolve(base).startsWith(join(raizProyecto, 'data'))) throw new Error('La base de prueba no puede estar en data/')
  const puerto = 41000 + Math.floor(Math.random() * 9000)
  const proceso = spawn(process.execPath, ['--no-warnings', join(raizProyecto, 'server', 'api.js')], {
    cwd: carpeta,
    env: { ...process.env, ATLAS_PORT: String(puerto), ATLAS_DB_PATH: base, ...entornoExtra },
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
  const detener = async () => {
    proceso.kill()
    await new Promise((r) => proceso.once('exit', r))
    rmSync(carpeta, { recursive: true, force: true })
  }
  return { url, base, carpeta, pedir, iniciarSesion, sql, salida: () => salida, detener }
}

// Registra una solicitud como el agente de prueba y devuelve el correo de la cuenta de cliente creada.
export async function registrarSolicitudPrueba(servidor, email, estado = 'Nuevo León') {
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
  return respuesta.datos
}

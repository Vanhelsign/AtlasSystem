// Carga las variables de .env con el soporte nativo de Node (process.loadEnvFile), sin dependencias.
// Debe importarse antes que cualquier otro módulo del servidor. Nunca imprime ni registra el contenido del archivo.
// Las variables ya definidas en el entorno tienen prioridad sobre las del archivo.
// ATLAS_ENV_ARCHIVO permite usar otro archivo; las pruebas lo apuntan a uno inexistente para no leer el .env real.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const raizProyecto = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const archivo = process.env.ATLAS_ENV_ARCHIVO ? resolve(process.env.ATLAS_ENV_ARCHIVO) : join(raizProyecto, '.env')

if (existsSync(archivo)) process.loadEnvFile(archivo)

import './api.js'

/* Implementación anterior conservada como referencia de la primera integración.
import express from 'express'
import { db, getProspecto, prospectSelect } from './database.js'

const app = express()
const port = 3001
const estados = new Set(['Nuevo', 'Contactado', 'En seguimiento', 'Cotizado', 'Cerrado ganado', 'Cerrado perdido'])
const ciudades = new Set(['Monterrey', 'Ciudad de México', 'Guadalajara', 'Tijuana', 'Mérida', 'Otra'])

app.use(express.json({ limit: '50kb' }))

function textoOpcional(value, campo) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${campo} debe ser texto`)
  return value.trim() || null
}

function validarConsumo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Los datos de consumo son obligatorios')
  }

  const consumoKwh = Number(value.consumo_kwh)
  const perdidas = Number(value.perdidas ?? 80)
  const ciudad = value.ciudad ?? 'Monterrey'

  if (!Number.isFinite(consumoKwh) || consumoKwh <= 0) {
    throw new Error('consumo_kwh debe ser un número mayor que cero')
  }
  if (!Number.isInteger(perdidas) || perdidas < 1 || perdidas > 100) {
    throw new Error('perdidas debe ser un entero entre 1 y 100')
  }
  if (typeof ciudad !== 'string' || !ciudades.has(ciudad)) {
    throw new Error('ciudad no es válida')
  }

  return { consumoKwh, ciudad, perdidas }
}

function idValido(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/api/prospectos', (_request, response) => {
  const prospectos = db.prepare(`${prospectSelect} ORDER BY p.id DESC`).all()
  response.json(prospectos)
})

app.get('/api/prospectos/:id', (request, response) => {
  const id = idValido(request.params.id)
  if (!id) return response.status(400).json({ error: 'Identificador inválido' })

  const prospecto = getProspecto(id)
  if (!prospecto) return response.status(404).json({ error: 'Prospecto no encontrado' })
  response.json(prospecto)
})

app.post('/api/prospectos', (request, response) => {
  try {
    const nombre = typeof request.body.nombre === 'string' ? request.body.nombre.trim() : ''
    if (!nombre) return response.status(400).json({ error: 'nombre es obligatorio' })

    const empresa = textoOpcional(request.body.empresa, 'empresa')
    const telefono = textoOpcional(request.body.telefono, 'telefono')
    const consumo = request.body.consumo == null ? null : validarConsumo(request.body.consumo)

    db.exec('BEGIN')
    try {
      const result = db.prepare(`
        INSERT INTO prospectos (nombre, empresa, telefono, estado)
        VALUES (?, ?, ?, 'Nuevo')
      `).run(nombre, empresa, telefono)
      const id = Number(result.lastInsertRowid)

      if (consumo) {
        db.prepare(`
          INSERT INTO consumos_prospecto (prospecto_id, consumo_kwh, ciudad, perdidas)
          VALUES (?, ?, ?, ?)
        `).run(id, consumo.consumoKwh, consumo.ciudad, consumo.perdidas)
      }
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

app.patch('/api/prospectos/:id', (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    const actual = getProspecto(id)
    if (!actual) return response.status(404).json({ error: 'Prospecto no encontrado' })

    const nombre = request.body.nombre === undefined
      ? actual.nombre
      : typeof request.body.nombre === 'string' ? request.body.nombre.trim() : ''
    if (!nombre) return response.status(400).json({ error: 'nombre es obligatorio' })

    const empresa = request.body.empresa === undefined ? actual.empresa : textoOpcional(request.body.empresa, 'empresa')
    const telefono = request.body.telefono === undefined ? actual.telefono : textoOpcional(request.body.telefono, 'telefono')
    const estado = request.body.estado ?? actual.estado
    if (typeof estado !== 'string' || !estados.has(estado)) {
      return response.status(400).json({ error: 'estado no es válido' })
    }

    db.prepare(`
      UPDATE prospectos
      SET nombre = ?, empresa = ?, telefono = ?, estado = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nombre, empresa, telefono, estado, id)
    response.json(getProspecto(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.put('/api/prospectos/:id/consumo', (request, response) => {
  try {
    const id = idValido(request.params.id)
    if (!id) return response.status(400).json({ error: 'Identificador inválido' })
    if (!getProspecto(id)) return response.status(404).json({ error: 'Prospecto no encontrado' })
    const consumo = validarConsumo(request.body)

    db.prepare(`
      INSERT INTO consumos_prospecto (prospecto_id, consumo_kwh, ciudad, perdidas)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(prospecto_id) DO UPDATE SET
        consumo_kwh = excluded.consumo_kwh,
        ciudad = excluded.ciudad,
        perdidas = excluded.perdidas,
        updated_at = CURRENT_TIMESTAMP
    `).run(id, consumo.consumoKwh, consumo.ciudad, consumo.perdidas)
    response.json(getProspecto(id))
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.use((error, _request, response, _next) => {
  void _next
  console.error(error)
  response.status(500).json({ error: 'Error interno del servidor' })
})

app.listen(port, () => {
  console.log(`API de ATLAS disponible en http://localhost:${port}`)
})
*/

import { useMemo, useState } from 'react'

const POTENCIAS_APROXIMADAS = {
  'Refrigerador': 150,
  'Televisión': 100,
  'Iluminación LED': 10,
  'Lavadora': 500,
  'Microondas': 1200,
  'Aire acondicionado': 1500,
  'Computadora': 200,
}

const nuevoCliente = () => ({ nombre: '', telefono: '', email: '' })
const nuevoRecibo = () => ({ consumo_kwh: '', periodo: 'mensual', mes_inicio: '' })
const nuevaDireccion = () => ({
  estado: '',
  municipio: '',
  colonia: '',
  codigo_postal: '',
  calle: '',
  numero_exterior: '',
  numero_interior: '',
})
const nuevaConfiguracion = () => ({
  eficiencia_pct: 80,
  cubrir_baterias: null,
  cobertura_nocturna_pct: 50,
  estimacion_consumo_nocturno_pct: 30,
  incluir_interconexion: false,
  margen_crecimiento_pct: 10,
})
const nuevaFilaEquipo = () => ({
  id: crypto.randomUUID(),
  tipo: 'Refrigerador',
  potencia_w: '150',
  cantidad: '1',
  horario: 'dia',
  horas_dia: '',
  horas_noche: '',
})

function resumenCfe(recibo) {
  const consumo = Number(recibo.consumo_kwh)
  if (!(consumo > 0) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(recibo.mes_inicio)) return { consumoMensual: 0, consumoDiario: 0, valido: false }
  const consumoMensual = recibo.periodo === 'bimestral' ? consumo / 2 : consumo
  return { consumoMensual, consumoDiario: consumoMensual / 30, valido: true }
}

function calculoEquipo(fila) {
  const potencia = Number(fila.potencia_w) || 0
  const cantidad = Number(fila.cantidad) || 0
  const horasDia = fila.horario === 'noche' ? 0 : Number(fila.horas_dia) || 0
  const horasNoche = fila.horario === 'dia' ? 0 : Number(fila.horas_noche) || 0
  return {
    dia: potencia * cantidad * horasDia / 1000,
    noche: potencia * cantidad * horasNoche / 1000,
  }
}

function sinIdTemporal(fila) {
  const copia = { ...fila }
  delete copia.id
  return copia
}

export default function Cotizacion({ errorApi, onRegistrar }) {
  const [cliente, setCliente] = useState(nuevoCliente)
  const [modalidad, setModalidad] = useState('historial_cfe')
  const [recibo, setRecibo] = useState(nuevoRecibo)
  const [equipos, setEquipos] = useState([nuevaFilaEquipo()])
  const [configuracion, setConfiguracion] = useState(nuevaConfiguracion)
  const [direccion, setDireccion] = useState(nuevaDireccion)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const cfe = useMemo(() => resumenCfe(recibo), [recibo])
  const totalesEquipos = useMemo(() => equipos.reduce((total, fila) => {
    const consumo = calculoEquipo(fila)
    return { dia: total.dia + consumo.dia, noche: total.noche + consumo.noche }
  }, { dia: 0, noche: 0 }), [equipos])

  const cambiarEquipo = (id, campo, valor) => {
    setEquipos((actual) => actual.map((fila) => {
      if (fila.id !== id) return fila
      if (campo === 'tipo' && POTENCIAS_APROXIMADAS[valor]) {
        return { ...fila, tipo: valor, potencia_w: String(POTENCIAS_APROXIMADAS[valor]) }
      }
      if (campo === 'horario') {
        return {
          ...fila,
          horario: valor,
          horas_dia: valor === 'noche' ? '' : fila.horas_dia,
          horas_noche: valor === 'dia' ? '' : fila.horas_noche,
        }
      }
      return { ...fila, [campo]: valor }
    }))
  }

  const registrar = async () => {
    setGuardando(true)
    setError('')
    try {
      await onRegistrar({
        cliente,
        modalidad,
        historial_cfe: [recibo],
        electrodomesticos: equipos.map(sinIdTemporal),
        configuracion,
        direccion,
      })
      limpiarFormulario()
    } catch (registroError) {
      setError(registroError.message)
    } finally {
      setGuardando(false)
    }
  }

  const limpiarFormulario = () => {
    setCliente(nuevoCliente())
    setModalidad('historial_cfe')
    setRecibo(nuevoRecibo())
    setEquipos([nuevaFilaEquipo()])
    setConfiguracion(nuevaConfiguracion())
    setDireccion(nuevaDireccion())
    setError('')
  }

  const consumoDiario = modalidad === 'historial_cfe' ? cfe.consumoDiario : totalesEquipos.dia + totalesEquipos.noche
  const consumoMensual = consumoDiario * 30
  const consumoObjetivo = consumoMensual * (1 + configuracion.margen_crecimiento_pct / 100)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Cotización</h2>
        <p className="text-sm text-slate-500 mt-1">Registra la solicitud y estima el consumo antes del dimensionamiento técnico.</p>
      </div>

      {(errorApi || error) && <p className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error || errorApi}</p>}

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="grid md:grid-cols-3 gap-4">
          <label className="text-sm font-medium">Nombre
            <input value={cliente.nombre} onChange={(event) => setCliente({ ...cliente, nombre: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. Mauricio Pérez</span>
          </label>
          <label className="text-sm font-medium">Teléfono
            <input value={cliente.telefono} onChange={(event) => setCliente({ ...cliente, telefono: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. 8112345678</span>
          </label>
          <label className="text-sm font-medium">Correo electrónico
            <input type="email" value={cliente.email} onChange={(event) => setCliente({ ...cliente, email: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. mauricio@correo.com</span>
          </label>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex border-b">
          <button onClick={() => setModalidad('historial_cfe')} className={`flex-1 px-4 py-3 text-sm font-semibold ${modalidad === 'historial_cfe' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-500'}`}>Historial CFE</button>
          <button onClick={() => setModalidad('electrodomesticos')} className={`flex-1 px-4 py-3 text-sm font-semibold ${modalidad === 'electrodomesticos' ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600' : 'text-slate-500'}`}>Por electrodomésticos</button>
        </div>

        <div className="p-5 space-y-4">
          {modalidad === 'historial_cfe' ? (
            <>
              <p className="text-sm text-slate-500">Captura los datos de un recibo de CFE.</p>
              <div className="grid md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-lg">
                <label className="text-sm font-medium">Consumo en kWh
                  <input type="number" min="0.01" step="0.01" value={recibo.consumo_kwh} onChange={(event) => setRecibo({ ...recibo, consumo_kwh: event.target.value })} className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white" />
                  <span className="block mt-1 text-xs font-normal text-slate-400">Ej. 850, tal como aparece en el recibo.</span>
                </label>
                <label className="text-sm font-medium">Periodo
                  <select value={recibo.periodo} onChange={(event) => setRecibo({ ...recibo, periodo: event.target.value })} className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white">
                    <option value="mensual">Mensual</option>
                    <option value="bimestral">Bimestral</option>
                  </select>
                  <span className="block mt-1 text-xs font-normal text-slate-400">Selecciona si el consumo corresponde a uno o dos meses.</span>
                </label>
                <label className="text-sm font-medium">{recibo.periodo === 'bimestral' ? 'Primer mes del bimestre' : 'Mes del recibo'}
                  <input type="month" value={recibo.mes_inicio} onChange={(event) => setRecibo({ ...recibo, mes_inicio: event.target.value })} className="mt-1 w-full border rounded px-3 py-2 text-sm bg-white" />
                  <span className="block mt-1 text-xs font-normal text-slate-400">Selecciona el mes y año indicados en el recibo.</span>
                </label>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500">Las potencias sugeridas son valores aproximados y se pueden editar según la placa del aparato.</p>
              <datalist id="tipos-aparato">{Object.keys(POTENCIAS_APROXIMADAS).map((tipo) => <option key={tipo} value={tipo} />)}</datalist>
              {equipos.map((fila) => {
                const consumo = calculoEquipo(fila)
                return (
                  <div key={fila.id} className="bg-slate-50 p-3 rounded-lg space-y-3">
                    <div className="grid md:grid-cols-5 gap-3">
                      <label className="text-xs font-medium">Tipo de aparato
                        <input list="tipos-aparato" value={fila.tipo} onChange={(event) => cambiarEquipo(fila.id, 'tipo', event.target.value)} className="mt-1 w-full border rounded px-2 py-2 text-sm bg-white" />
                        <span className="block mt-1 font-normal text-slate-400">Ej. Refrigerador</span>
                      </label>
                      <label className="text-xs font-medium">Potencia sugerida (W, aprox.)
                        <input type="number" min="1" value={fila.potencia_w} onChange={(event) => cambiarEquipo(fila.id, 'potencia_w', event.target.value)} className="mt-1 w-full border rounded px-2 py-2 text-sm bg-white" />
                        <span className="block mt-1 font-normal text-slate-400">Edita según la placa.</span>
                      </label>
                      <label className="text-xs font-medium">Cantidad
                        <input type="number" min="1" step="1" value={fila.cantidad} onChange={(event) => cambiarEquipo(fila.id, 'cantidad', event.target.value)} className="mt-1 w-full border rounded px-2 py-2 text-sm bg-white" />
                        <span className="block mt-1 font-normal text-slate-400">Número de aparatos iguales.</span>
                      </label>
                      <label className="text-xs font-medium">Horario de uso
                        <select value={fila.horario} onChange={(event) => cambiarEquipo(fila.id, 'horario', event.target.value)} className="mt-1 w-full border rounded px-2 py-2 text-sm bg-white">
                          <option value="dia">Día</option><option value="noche">Noche</option><option value="ambos">Ambos</option>
                        </select>
                        <span className="block mt-1 font-normal text-slate-400">Indica cuándo consume energía.</span>
                      </label>
                      <div className="text-xs text-slate-600 pt-5">Estimado: <b>{(consumo.dia + consumo.noche).toFixed(2)} kWh/día</b></div>
                    </div>
                    <div className="flex flex-wrap gap-3 items-end">
                      {fila.horario !== 'noche' && <label className="text-xs font-medium">Horas de día<input type="number" min="0" max="24" step="0.25" value={fila.horas_dia} onChange={(event) => cambiarEquipo(fila.id, 'horas_dia', event.target.value)} className="ml-2 border rounded px-2 py-1 w-24 bg-white" /><span className="block mt-1 font-normal text-slate-400">Ej. 4 horas.</span></label>}
                      {fila.horario !== 'dia' && <label className="text-xs font-medium">Horas de noche<input type="number" min="0" max="24" step="0.25" value={fila.horas_noche} onChange={(event) => cambiarEquipo(fila.id, 'horas_noche', event.target.value)} className="ml-2 border rounded px-2 py-1 w-24 bg-white" /><span className="block mt-1 font-normal text-slate-400">Ej. 8 horas.</span></label>}
                      <button disabled={equipos.length === 1} onClick={() => setEquipos((actual) => actual.filter((item) => item.id !== fila.id))} className="ml-auto text-sm text-red-600 disabled:text-slate-300">Eliminar</button>
                    </div>
                  </div>
                )
              })}
              <button onClick={() => setEquipos((actual) => [...actual, nuevaFilaEquipo()])} className="text-sm font-semibold text-indigo-700">+ Agregar otro aparato</button>
              <div className="grid sm:grid-cols-3 gap-3">
                <p className="bg-amber-50 rounded-lg p-3 text-sm">Día: <b>{totalesEquipos.dia.toFixed(2)} kWh</b></p>
                <p className="bg-slate-100 rounded-lg p-3 text-sm">Noche: <b>{totalesEquipos.noche.toFixed(2)} kWh</b></p>
                <p className="bg-indigo-50 rounded-lg p-3 text-sm">Total diario: <b>{(totalesEquipos.dia + totalesEquipos.noche).toFixed(2)} kWh</b></p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold">Baterías</h3>
            <p className="text-sm font-medium mt-3">¿Desea cubrir consumo durante la noche con baterías?</p>
            <div className="flex gap-5 mt-2 text-sm">
              <label><input type="radio" name="baterias" checked={configuracion.cubrir_baterias === true} onChange={() => setConfiguracion({ ...configuracion, cubrir_baterias: true })} /> Sí</label>
              <label><input type="radio" name="baterias" checked={configuracion.cubrir_baterias === false} onChange={() => setConfiguracion({ ...configuracion, cubrir_baterias: false })} /> No</label>
            </div>
            <p className="mt-1 text-xs text-slate-400">Selecciona una opción para definir el alcance energético de la solicitud.</p>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Margen de crecimiento del consumo</h3>
            <label className="block text-sm font-medium mt-3">Margen previsto
              <select value={configuracion.margen_crecimiento_pct} onChange={(event) => setConfiguracion({ ...configuracion, margen_crecimiento_pct: Number(event.target.value) })} className="mt-1 block w-full border rounded px-3 py-2 bg-white">
                {[10, 20, 30, 40, 50].map((valor) => <option key={valor} value={valor}>{valor} %</option>)}
              </select>
              <span className="block mt-1 text-xs font-normal text-slate-400">Permite dimensionar el sistema considerando un posible aumento futuro del consumo.</span>
            </label>
          </div>
        </div>

        {configuracion.cubrir_baterias === true && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 space-y-3">
            <label className="block text-sm font-medium">Porcentaje del consumo nocturno que desea cubrir con baterías
              <select value={configuracion.cobertura_nocturna_pct} onChange={(event) => setConfiguracion({ ...configuracion, cobertura_nocturna_pct: Number(event.target.value) })} className="mt-1 block border rounded px-3 py-2 bg-white">
                {[25, 50, 75, 100].map((valor) => <option key={valor} value={valor}>{valor} %</option>)}
              </select>
              <span className="block mt-1 text-xs font-normal text-slate-400">Ej. 50 % cubre la mitad del consumo nocturno estimado.</span>
            </label>
            {modalidad === 'historial_cfe' && <label className="block text-sm font-medium">Estimación del porcentaje del consumo total que ocurre de noche
              <input type="number" min="1" max="100" value={configuracion.estimacion_consumo_nocturno_pct} onChange={(event) => setConfiguracion({ ...configuracion, estimacion_consumo_nocturno_pct: Number(event.target.value) })} className="mt-1 block border rounded px-3 py-2 bg-white" />
              <span className="block mt-1 text-xs font-normal text-slate-400">Ej. 30 % si aproximadamente una tercera parte se consume de noche.</span>
            </label>}
            <p className="text-xs text-indigo-700">El porcentaje nocturno estima qué parte del consumo sucede de noche. La cobertura indica qué parte de ese consumo nocturno se desea respaldar. Esto registra una necesidad energética; no selecciona un modelo de batería.</p>
          </div>
        )}

        {configuracion.cubrir_baterias === false && (
          <div className="bg-green-50 border border-green-100 rounded-lg p-4">
            <p className="font-medium text-green-800">Sistema interconectado a CFE, sin baterías</p>
            <label className="block text-sm mt-2"><input type="checkbox" checked={configuracion.incluir_interconexion} onChange={(event) => setConfiguracion({ ...configuracion, incluir_interconexion: event.target.checked })} /> Incluir servicio de instalación y gestión del trámite de interconexión</label>
            <p className="text-xs text-green-700 mt-2">Esta elección no calcula precios ni supone condiciones del contrato con CFE.</p>
          </div>
        )}

      </section>

      {consumoMensual > 0 && (modalidad !== 'historial_cfe' || cfe.valido) && <section className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2">
        {modalidad === 'historial_cfe' && recibo.periodo === 'mensual' && <p className="text-sm text-blue-900">Ingresaste <b>{Number(recibo.consumo_kwh).toFixed(2)} kWh</b> en un periodo mensual.</p>}
        {modalidad === 'historial_cfe' && recibo.periodo === 'bimestral' && <p className="text-sm text-blue-900">Ingresaste <b>{Number(recibo.consumo_kwh).toFixed(2)} kWh</b> en un periodo bimestral. Equivale aproximadamente a <b>{consumoMensual.toFixed(2)} kWh por mes</b>.</p>}
        {modalidad === 'electrodomesticos' && <p className="text-sm text-blue-900">El consumo mensual estimado por electrodomésticos es de <b>{consumoMensual.toFixed(2)} kWh</b>.</p>}
        <div className="border-t border-blue-200 pt-2">
          <p className="text-sm text-indigo-900">Consumo objetivo para “Dimensionar Proyecto”: <b>{consumoObjetivo.toFixed(2)} kWh/mes</b></p>
          <p className="text-xs text-indigo-700 mt-1">Consumo mensual estimado × (1 + {configuracion.margen_crecimiento_pct} %). Este margen es independiente de la cobertura con baterías.</p>
        </div>
      </section>}

      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Dirección del cliente</h3>
          <p className="text-sm text-slate-500 mt-1">La ciudad o municipio se utiliza para elegir la irradiación del dimensionamiento. Si no está en el catálogo técnico, se usa “Otra”.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="text-sm font-medium">Estado
            <input value={direccion.estado} onChange={(event) => setDireccion({ ...direccion, estado: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. Nuevo León</span>
          </label>
          <label className="text-sm font-medium">Ciudad o municipio
            <input value={direccion.municipio} onChange={(event) => setDireccion({ ...direccion, municipio: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. Monterrey</span>
          </label>
          <label className="text-sm font-medium">Colonia
            <input value={direccion.colonia} onChange={(event) => setDireccion({ ...direccion, colonia: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. Centro</span>
          </label>
          <label className="text-sm font-medium">Código postal
            <input inputMode="numeric" maxLength="5" value={direccion.codigo_postal} onChange={(event) => setDireccion({ ...direccion, codigo_postal: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. 64000, cinco dígitos.</span>
          </label>
          <label className="text-sm font-medium sm:col-span-2">Calle
            <input value={direccion.calle} onChange={(event) => setDireccion({ ...direccion, calle: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. Avenida Constitución</span>
          </label>
          <label className="text-sm font-medium">Número exterior
            <input value={direccion.numero_exterior} onChange={(event) => setDireccion({ ...direccion, numero_exterior: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. 123</span>
          </label>
          <label className="text-sm font-medium">Número interior (opcional)
            <input value={direccion.numero_interior} onChange={(event) => setDireccion({ ...direccion, numero_interior: event.target.value })} className="mt-1 w-full border rounded-lg px-3 py-2 font-normal" />
            <span className="block mt-1 text-xs font-normal text-slate-400">Ej. Departamento 4B</span>
          </label>
        </div>
      </section>

      <div className="flex flex-col sm:flex-row gap-3">
        <button disabled={guardando} onClick={registrar} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-3 rounded-xl">{guardando ? 'Guardando…' : 'Registrar solicitud de cotización'}</button>
        <button disabled={guardando} onClick={limpiarFormulario} className="sm:w-auto px-6 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl">Limpiar formulario</button>
      </div>

    </div>
  )
}

// Cuatro hitos fijos. Abrir una parte no la completa: se usan exclusivamente
// sus verificaciones/evidencia persistidas. La última requiere además el cierre.
export function progresoCliente(orden, etapas = [], incidencias = 0) {
  const cerrada = orden?.estatus_obra === 'completada'
  const suspendida = Boolean(orden?.postergada_at || incidencias || orden?.estatus_obra === 'incidencia')
  const realizadas = [1, 2, 3].map(parte => Boolean(etapas.find(e => e.parte === parte)?.completa))
  let fase = null
  if (orden?.iniciada_at && !cerrada && !suspendida) {
    const pendiente = realizadas.findIndex(completa => !completa)
    fase = pendiente < 0 ? 3 : pendiente + 1
  }
  const estado = !orden ? 'espera' : cerrada ? 'finalizada' : incidencias || orden.estatus_obra === 'incidencia' ? 'incidencia' : orden.postergada_at ? 'postergada' : orden.iniciada_at ? 'en_curso' : 'sin_iniciar'
  return { estado, fase_actual: fase, etapas: [
    { nombre: 'Pago confirmado', completada: true, actual: false },
    ...['Preparación', 'Montaje y conexiones', 'Verificación final'].map((nombre, indice) => ({
      nombre, completada: realizadas[indice] && (indice !== 2 || cerrada), actual: fase === indice + 1,
    })),
  ] }
}

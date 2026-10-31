export const PARTES_INSTALACION = ['Preparación', 'Montaje y conexiones', 'Verificación final']

// Los tipos son los mismos del catálogo. Una actividad de equipo solo existe
// cuando ese material está en la versión comercial aceptada, nunca en inventario vivo.
export function actividadesInstalacion(materiales) {
  const tipos = new Set(materiales.filter(m => m.clasificacion === 'material').map(m => m.tipo))
  const actividad = (codigo, parte, etapa, titulo, detalle) => ({ codigo, parte, etapa, titulo, detalle, obligatoria: true })
  const actividades = [
    actividad('materiales', 1, 'estructura', 'Verificar materiales y equipos cotizados', 'Compara modelos y cantidades con la cotización aceptada; registra faltantes sin modificar el inventario.'),
    actividad('herramientas', 1, 'estructura', 'Verificar herramientas y equipo de protección', 'Comprueba disponibilidad y condiciones de las herramientas y del equipo de protección necesario para el trabajo.'),
    actividad('lugar', 1, 'estructura', 'Revisar condiciones del lugar', 'Revisa acceso, superficie, área de trabajo y condiciones para realizar la instalación de forma segura.'),
  ]
  const equipos = [
    ['Estructura', 'estructura', 'Revisar montaje de la estructura', 'Verifica fijaciones, soporte y montaje de la estructura cotizada.'],
    ['Panel', 'paneles', 'Revisar montaje de paneles', 'Comprueba fijación, distribución e integridad de los paneles incluidos.'],
    ['Inversor', 'inversor', 'Revisar instalación del inversor', 'Comprueba fijación, ubicación, ventilación y conexiones del inversor cotizado.'],
    ['Cableado', 'cableado', 'Revisar cableado', 'Comprueba recorrido, sujeción, identificación y estado del cableado cotizado.'],
    ['Batería', 'baterias', 'Revisar instalación de baterías', 'Comprueba fijación, conexiones y condiciones de las baterías incluidas en la propuesta.'],
    ['Extra', 'interconexion', 'Verificar materiales adicionales cotizados', 'Revisa los materiales adicionales que figuran en el listado aprobado, según su función.'],
  ]
  for (const [tipo, etapa, titulo, detalle] of equipos) if (tipos.has(tipo)) actividades.push(actividad(`montaje_${etapa}`, 2, etapa, titulo, detalle))
  actividades.push(
    actividad('conexiones', 2, 'interconexion', 'Verificar conexiones y protecciones del sistema', 'Revisa conexiones, puesta a tierra y protecciones aplicables al alcance aprobado. No des por instalado un componente que no está cotizado; registra una incidencia si falta un elemento necesario.'),
    actividad('final_conexiones', 3, 'pruebas', 'Revisar conexiones finales', 'Confirma las conexiones del sistema instalado y sus condiciones de seguridad antes de la entrega.'),
    actividad('final_equipos', 3, 'pruebas', 'Comprobar equipos y funcionamiento', 'Contrasta los equipos instalados con la cotización y comprueba su funcionamiento según sus especificaciones.'),
    actividad('final_lugar', 3, 'pruebas', 'Revisar condiciones generales y entrega', 'Comprueba orden, limpieza y condiciones generales del lugar al terminar. Registra cualquier condición que impida la entrega.'),
  )
  return actividades
}

export function estadoInstalacion(orden, pendientes = 0) {
  if (orden.estatus_obra === 'completada') return 'Finalizada'
  if (pendientes || orden.estatus_obra === 'incidencia') return 'Con incidencia'
  if (orden.postergada_at) return 'Postergada'
  if (orden.iniciada_at || orden.estatus_obra === 'en_progreso') return 'En proceso'
  return orden.tecnico_id ? orden.tomada_at ? 'Tomada, pendiente de inicio' : 'Pendiente de inicio' : 'No tomada'
}

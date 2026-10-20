// Etiquetas y formatos compartidos por la pantalla Notificaciones y el bloque de correos del detalle.
export const TIPOS_CORREO = {
  credenciales: "Enlace de acceso",
  cotizacion_lista: "Cotización lista",
  recordatorio: "Recordatorio",
};

export const ESTADOS_CORREO = {
  pendiente: { etiqueta: "Pendiente", clase: "bg-slate-100 text-slate-700" },
  aceptado: { etiqueta: "Aceptado", clase: "bg-green-100 text-green-800" },
  fallido: { etiqueta: "Fallido", clase: "bg-amber-100 text-amber-900" },
  entregado: { etiqueta: "Entregado", clase: "bg-green-100 text-green-800" },
};

export const fechaHora = (valor) => valor
  ? new Date(`${valor.replace(" ", "T")}Z`).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";

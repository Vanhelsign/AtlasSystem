// Manejo global de sesiones cerradas: envuelve window.fetch una sola vez. Ante un 401 de la API con el token
// de la sesión actual, avisa para limpiar la sesión y volver al login. No toca el login (un 401 ahí significa
// credenciales incorrectas) ni otras respuestas, como el 403 de "debe cambiar contraseña".

function tokenDe(recurso, opciones) {
  const encabezados = new Headers(typeof Request !== "undefined" && recurso instanceof Request ? recurso.headers : undefined);
  new Headers(opciones?.headers).forEach((valor, nombre) => encabezados.set(nombre, valor));
  const autorizacion = encabezados.get("Authorization") ?? "";
  return autorizacion.startsWith("Bearer ") ? autorizacion.slice(7) : "";
}

/**
 * @param {{ tokenActual: () => string | undefined, onSesionCerrada: (motivo: string) => void, ventana?: Window }} opciones
 * @returns {() => void} función que restaura el fetch original
 */
export function instalarManejoSesion({ tokenActual, onSesionCerrada, ventana = window }) {
  const fetchOriginal = ventana.fetch;
  ventana.fetch = async (recurso, opciones) => {
    const respuesta = await fetchOriginal(recurso, opciones);
    if (respuesta.status !== 401) return respuesta;
    try {
      const direccion = typeof Request !== "undefined" && recurso instanceof Request ? recurso.url : String(recurso);
      const url = new URL(direccion, ventana.location.origin);
      const token = tokenDe(recurso, opciones);
      const esApi = url.origin === ventana.location.origin && url.pathname.startsWith("/api/");
      if (esApi && url.pathname !== "/api/login" && token && token === tokenActual()) {
        const datos = await respuesta.clone().json().catch(() => ({}));
        onSesionCerrada(datos.codigo === "contrasena_cambiada" ? "contrasena_cambiada" : "sesion_vencida");
      }
    } catch {
      // Si no se puede interpretar la petición, se deja la respuesta tal cual para quien la hizo.
    }
    return respuesta;
  };
  return () => { ventana.fetch = fetchOriginal; };
}

export const MENSAJES_SESION_CERRADA = {
  contrasena_cambiada: "Tu contraseña se cambió en otro dispositivo. Inicia sesión de nuevo.",
  sesion_vencida: "Tu sesión se cerró. Inicia sesión de nuevo.",
};

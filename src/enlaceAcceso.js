const PREFIJO = "#crear-contrasena=";

// Lee el token del enlace del correo (APP_URL/#crear-contrasena=<token>) y lo quita de la barra de direcciones.
// El fragmento (#) no se envía al servidor ni en Referer. Se llama una vez al cargar la app y en cada
// "hashchange", fuera de los inicializadores de React (StrictMode los ejecuta dos veces).
export function tomarTokenDeEnlace(ventana = typeof window === "undefined" ? null : window) {
  if (!ventana?.location.hash.startsWith(PREFIJO)) return null;
  const token = ventana.location.hash.slice(PREFIJO.length);
  ventana.history.replaceState(ventana.history.state, "", `${ventana.location.pathname}${ventana.location.search}`);
  return token || null;
}

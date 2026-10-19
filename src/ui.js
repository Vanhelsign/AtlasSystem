// Estilos y formatos compartidos por las pantallas de administración (inventario, tarifas, ahorro).

export const BOTON_PRIMARIO = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
export const BOTON_SECUNDARIO = "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50";
export const BOTON_PELIGRO = "rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
export const ETIQUETA = "block text-sm font-medium";
export const CAMPO = "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal";

export const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
export const fmtCentavos = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const fmtNumero = (n, decimales = 0) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);
export const plural = (n, singular, varios) => `${n} ${n === 1 ? singular : varios}`;

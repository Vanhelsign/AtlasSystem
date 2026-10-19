// Constantes y utilidades compartidas por la pantalla de tarifas y el modal de edición.

export const TIPOS_TARIFA = { domestica: "Doméstica", dac: "DAC (alto consumo)", comercial: "Comercial" };
export const TEMPORADAS = { todo_el_anio: "Todo el año", verano: "Verano", fuera_verano: "Fuera de verano" };
export const ORDEN_TEMPORADAS = ["verano", "fuera_verano", "todo_el_anio"];
export const MAX_BLOQUES = 4;
export const ORIGENES = { prueba: "Dato de prueba", recibo: "Tomado de un recibo" };

const NOMBRES_BLOQUES = {
  1: ["Único"],
  2: ["Básico", "Excedente"],
  3: ["Básico", "Intermedio", "Excedente"],
  4: ["Básico", "Intermedio", "Intermedio alto", "Excedente"],
};

export const nombreBloque = (indice, total) => NOMBRES_BLOQUES[total]?.[indice] ?? `Bloque ${indice + 1}`;
export const texto = (valor) => valor === null || valor === undefined ? "" : String(valor);
export const etiquetaOrigen = (origen) => origen === "recibo" ? "recibo" : origen === "prueba" ? "prueba" : "origen sin especificar";

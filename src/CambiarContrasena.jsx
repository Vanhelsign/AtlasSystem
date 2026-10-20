import { useId, useState } from "react";
import Aviso from "./Aviso.jsx";
import { BOTON_PRIMARIO } from "./ui.js";
import useAviso from "./useAviso.js";

const MINIMO = 8;
const VACIO = { actual: "", nueva: "", confirmacion: "" };

// Mismas reglas que el servidor; el servidor vuelve a validar todo.
function validar({ actual, nueva, confirmacion }) {
  const errores = {};
  if (!actual) errores.actual = "Escribe tu contraseña actual";
  if (nueva.length < MINIMO) errores.nueva = `Debe tener al menos ${MINIMO} caracteres`;
  else if (nueva === actual) errores.nueva = "Debe ser distinta de la actual";
  if (!confirmacion) errores.confirmacion = "Vuelve a escribir la nueva contraseña";
  else if (confirmacion !== nueva) errores.confirmacion = "No coincide con la nueva contraseña";
  return errores;
}

export function CampoContrasena({ etiqueta, valor, onCambiar, error, autoComplete, ayuda }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">{etiqueta}</label>
      <div className="mt-1 flex gap-2">
        <input
          id={id} type={visible ? "text" : "password"} value={valor} onChange={(event) => onCambiar(event.target.value)}
          autoComplete={autoComplete} aria-invalid={Boolean(error)} aria-describedby={error || ayuda ? `${id}-nota` : undefined}
          className={`w-full rounded-lg border px-3 py-2 text-sm ${error ? "border-red-400 bg-red-50" : "bg-white"}`}
        />
        <button type="button" onClick={() => setVisible(!visible)} aria-pressed={visible} aria-controls={id} aria-label={`${visible ? "Ocultar" : "Mostrar"} ${etiqueta.toLowerCase()}`} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {(error || ayuda) && <p id={`${id}-nota`} className={`mt-1 text-xs ${error ? "text-red-600" : "text-slate-500"}`}>{error || ayuda}</p>}
    </div>
  );
}

export default function FormularioCambioContrasena({ token, onCambiada, textoBoton = "Cambiar contraseña" }) {
  const [form, setForm] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [intento, setIntento] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, avisar, cerrarAviso] = useAviso();

  // Después del primer intento, los errores se actualizan mientras se escribe.
  const cambiar = (campo) => (valor) => {
    const nuevo = { ...form, [campo]: valor };
    setForm(nuevo);
    if (intento) setErrores(validar(nuevo));
  };

  const enviar = async (event) => {
    event.preventDefault();
    setIntento(true);
    setErrorGeneral("");
    const encontrados = validar(form);
    setErrores(encontrados);
    if (Object.keys(encontrados).length) return;
    setOcupado(true);
    try {
      const response = await fetch("/api/portal/cambiar-contrasena", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.campo) setErrores({ [data.campo]: data.error });
        else setErrorGeneral(data.error || "No se pudo cambiar la contraseña.");
        return;
      }
      setForm(VACIO);
      setErrores({});
      setIntento(false);
      const cerradas = data.sesiones_cerradas ?? 0;
      avisar("exito", `Contraseña actualizada.${cerradas ? ` Se ${cerradas === 1 ? "cerró 1 sesión abierta" : `cerraron ${cerradas} sesiones abiertas`} en otros dispositivos.` : ""}`);
      onCambiada?.();
    } catch {
      setErrorGeneral("No se pudo conectar con el servidor. Inténtalo de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form onSubmit={enviar} noValidate className="space-y-4">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />
      {errorGeneral && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorGeneral}</p>}
      <CampoContrasena etiqueta="Contraseña actual" valor={form.actual} onCambiar={cambiar("actual")} error={errores.actual} autoComplete="current-password" />
      <CampoContrasena etiqueta="Nueva contraseña" valor={form.nueva} onCambiar={cambiar("nueva")} error={errores.nueva} autoComplete="new-password" ayuda={`Mínimo ${MINIMO} caracteres y distinta de la actual.`} />
      <CampoContrasena etiqueta="Confirmar nueva contraseña" valor={form.confirmacion} onCambiar={cambiar("confirmacion")} error={errores.confirmacion} autoComplete="new-password" />
      <button type="submit" disabled={ocupado} className={BOTON_PRIMARIO}>{ocupado ? "Guardando…" : textoBoton}</button>
    </form>
  );
}

// Pantalla única mientras la cuenta tiene una contraseña temporal: no se puede usar el portal hasta cambiarla.
export function PantallaCambioObligatorio({ usuario, onCambiada, onCerrarSesion }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <p className="text-xl font-bold text-indigo-700">ATLAS CRM</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Crea tu nueva contraseña</h1>
          <p className="mt-2 text-sm text-slate-600">Tu cuenta <b>{usuario.email}</b> tiene una contraseña temporal. Para continuar al portal, cámbiala por una que solo tú conozcas.</p>
        </div>
        <FormularioCambioContrasena token={usuario.token} onCambiada={onCambiada} textoBoton="Guardar y continuar" />
        <button type="button" onClick={onCerrarSesion} className="text-sm font-medium text-slate-500 hover:underline">Cerrar sesión</button>
      </div>
    </div>
  );
}

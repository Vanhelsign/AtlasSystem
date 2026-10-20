import { useEffect, useState } from "react";
import { CampoContrasena } from "./CambiarContrasena.jsx";
import { BOTON_PRIMARIO } from "./ui.js";

const MINIMO = 8;
const ENLACE_INVALIDO = "El enlace no es válido o venció. Pide a tu agente que lo reenvíe.";

// Mismas reglas que el servidor; el servidor vuelve a validar todo.
function validar({ nueva, confirmacion }) {
  const errores = {};
  if (nueva.length < MINIMO) errores.nueva = `Debe tener al menos ${MINIMO} caracteres`;
  if (!confirmacion) errores.confirmacion = "Vuelve a escribir la contraseña";
  else if (confirmacion !== nueva) errores.confirmacion = "No coincide con la contraseña";
  return errores;
}

const pedir = async (ruta, cuerpo) => {
  const response = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  return { response, data: await response.json().catch(() => ({})) };
};

// Pantalla pública "Crea tu contraseña". Validar el enlace no lo consume; solo el envío del formulario.
// Al terminar no inicia sesión: vuelve al login.
export default function CrearContrasena({ token, onCreada, onIrALogin }) {
  const [estado, setEstado] = useState("validando");
  const [mensaje, setMensaje] = useState("");
  const [form, setForm] = useState({ nueva: "", confirmacion: "" });
  const [errores, setErrores] = useState({});
  const [intento, setIntento] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;
    pedir("/api/portal/validar-enlace", { token })
      .then(({ response, data }) => {
        if (!vigente) return;
        if (response.ok) return setEstado("formulario");
        setMensaje(response.status === 429 ? data.error : ENLACE_INVALIDO);
        setEstado("invalido");
      })
      .catch(() => {
        if (!vigente) return;
        setMensaje("No se pudo conectar con el servidor. Inténtalo de nuevo más tarde.");
        setEstado("invalido");
      });
    return () => { vigente = false; };
  }, [token]);

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
      const { response, data } = await pedir("/api/portal/crear-contrasena", { token, ...form });
      if (response.ok) return onCreada();
      if (data.campo) setErrores({ [data.campo]: data.error });
      else if (data.codigo === "enlace_invalido") {
        setMensaje(ENLACE_INVALIDO);
        setEstado("invalido");
      } else setErrorGeneral(data.error || "No se pudo crear la contraseña.");
    } catch {
      setErrorGeneral("No se pudo conectar con el servidor. Inténtalo de nuevo.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <p className="text-xl font-bold text-indigo-700">ATLAS CRM</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">Crea tu contraseña</h1>
          {estado === "formulario" && <p className="mt-2 text-sm text-slate-600">Elige una contraseña que solo tú conozcas. Después inicia sesión con tu correo y esta contraseña.</p>}
        </div>
        {estado === "validando" && <p role="status" className="text-sm text-slate-500">Revisando el enlace…</p>}
        {estado === "invalido" && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{mensaje}</p>}
        {estado === "formulario" && (
          <form onSubmit={enviar} noValidate className="space-y-4">
            {errorGeneral && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorGeneral}</p>}
            <CampoContrasena etiqueta="Contraseña" valor={form.nueva} onCambiar={cambiar("nueva")} error={errores.nueva} autoComplete="new-password" ayuda={`Mínimo ${MINIMO} caracteres.`} />
            <CampoContrasena etiqueta="Confirmar contraseña" valor={form.confirmacion} onCambiar={cambiar("confirmacion")} error={errores.confirmacion} autoComplete="new-password" />
            <button type="submit" disabled={ocupado} className={`${BOTON_PRIMARIO} w-full`}>{ocupado ? "Guardando…" : "Crear contraseña"}</button>
          </form>
        )}
        <button type="button" onClick={onIrALogin} className="text-sm font-medium text-slate-500 hover:underline">Ir al inicio de sesión</button>
      </div>
    </div>
  );
}

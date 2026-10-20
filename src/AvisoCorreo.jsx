// Estado del correo que el servidor intentó enviar tras registrar una solicitud o aprobar una cotización.
// Nunca muestra el enlace de acceso: en modo simulado solo indica el archivo .eml que lo contiene.
const DESCRIPCION = {
  credenciales: "el correo con el enlace de acceso",
  cotizacion_lista: "el aviso de cotización lista",
};

export default function AvisoCorreo({ correo, tipo, destinatario }) {
  if (!correo) return null;
  const que = DESCRIPCION[tipo] ?? "el correo";

  if (correo.estado === "fallido") {
    return (
      <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">No se pudo enviar {que}.</p>
        <p className="mt-1">Lo demás se guardó correctamente. El fallo quedó registrado en las notificaciones.</p>
        {correo.detalle && <p className="mt-1 break-words text-xs text-amber-800">Detalle: {correo.detalle}</p>}
      </div>
    );
  }
  if (correo.simulado) {
    return (
      <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-semibold">Modo simulado: {que} no se envió.</p>
        <p className="mt-1">Se guardó en <code className="break-all rounded bg-white px-1 py-0.5 text-xs text-slate-800">data/correos/{correo.archivo}</code>. Ábrelo con un cliente de correo o un editor de texto.</p>
      </div>
    );
  }
  return (
    <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
      El servidor de correo aceptó {que}{destinatario ? <> para <b className="break-all">{destinatario}</b></> : null}.
    </p>
  );
}

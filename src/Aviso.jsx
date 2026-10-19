// Banner de aviso verde (éxito) o rojo (error); se usa junto con useAviso.
export default function Aviso({ aviso, onCerrar }) {
  if (!aviso) return null;
  return (
    <div key={aviso.id} role={aviso.tipo === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-lg p-3 text-sm ${aviso.tipo === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
      <span>{aviso.texto}</span>
      <button type="button" onClick={onCerrar} aria-label="Cerrar aviso" className="leading-none opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";

// Avisos dentro de la página que desaparecen solos: los de éxito a los 4.5 s y los de error a los 8 s.
export default function useAviso() {
  const [aviso, setAviso] = useState(null);
  useEffect(() => {
    if (!aviso) return;
    const temporizador = setTimeout(() => setAviso(null), aviso.tipo === "error" ? 8000 : 4500);
    return () => clearTimeout(temporizador);
  }, [aviso]);
  const avisar = useCallback((tipo, texto) => setAviso({ tipo, texto, id: Date.now() }), []);
  const cerrarAviso = useCallback(() => setAviso(null), []);
  return [aviso, avisar, cerrarAviso];
}

import { useEffect, useState } from 'react';
import { BOTON_SECUNDARIO, CAMPO, ETIQUETA } from './ui.js';
import { fechaHora, TIPOS_CORREO } from './correosComunes.js';

const CLIENTE = {
  papelera: { etiqueta: 'En papelera', clase: 'bg-amber-50 text-amber-800' },
  eliminado: { etiqueta: 'Cliente eliminado', clase: 'bg-slate-100 text-slate-600' },
};
const DETALLES = {
  credenciales: 'Enlace de activación de la cuenta para establecer la contraseña de acceso.',
  cotizacion_lista: 'Aviso de cotización disponible para revisión en el portal del cliente.',
  recordatorio: 'Recordatorio de seguimiento para el cliente.',
};

// El estado visible resume el procesamiento del envío. La auditoría técnica
// y el estado independiente del enlace se conservan en el backend.
export default function Notificaciones({ token }) {
  const [estado, setEstado] = useState('');
  const [tipo, setTipo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [version, setVersion] = useState(0);
  const [resultado, setResultado] = useState({ clave: null, notificaciones: [], total: 0, por_pagina: 50, error: '' });
  const clave = `${estado}|${tipo}|${pagina}|${version}`;
  const cargando = resultado.clave !== clave;
  const paginas = Math.max(1, Math.ceil(resultado.total / resultado.por_pagina));

  useEffect(() => {
    const controller = new AbortController();
    const claveActual = `${estado}|${tipo}|${pagina}|${version}`;
    const consulta = new URLSearchParams({ ...(estado && { resultado_envio: estado }), ...(tipo && { tipo }), pagina: String(pagina) });
    fetch(`/api/notificaciones?${consulta}`, { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las notificaciones.');
        setResultado({ clave: claveActual, ...data, error: '' });
      })
      .catch(error => {
        if (error.name !== 'AbortError') setResultado({ clave: claveActual, notificaciones: [], total: 0, por_pagina: 50, error: error.message });
      });
    return () => controller.abort();
  }, [token, estado, tipo, pagina, version]);

  const cambiarFiltro = aplicar => event => { aplicar(event.target.value); setPagina(1); };
  return <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Notificaciones</h1><p className="mt-1 text-sm text-slate-500">Registro de avisos de acceso, cotizaciones y seguimiento. El estado resume el envío, independientemente de que el cliente abra el mensaje o utilice su enlace.</p></div><button type="button" onClick={() => setVersion(v => v + 1)} className={BOTON_SECUNDARIO}>Actualizar</button></header>
    <div className="grid gap-3 sm:grid-cols-[200px_200px_1fr] sm:items-end">
      <label className={ETIQUETA}>Estado<select aria-label="Estado" value={estado} onChange={cambiarFiltro(setEstado)} className={CAMPO}><option value="">Todos</option><option value="enviado">Enviado</option><option value="error">Error</option></select></label>
      <label className={ETIQUETA}>Tipo<select aria-label="Tipo" value={tipo} onChange={cambiarFiltro(setTipo)} className={CAMPO}><option value="">Todos</option>{Object.entries(TIPOS_CORREO).map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}</select></label>
      <p className="text-sm text-slate-500 sm:text-right">{resultado.total} {resultado.total === 1 ? 'notificación' : 'notificaciones'}</p>
    </div>
    {resultado.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{resultado.error}</p>}
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-3">#</th><th className="p-3">Destinatario</th><th className="p-3">Tipo</th><th className="p-3">Fecha</th><th className="p-3">Estado</th><th className="p-3">Intentos</th><th className="p-3">Detalle</th></tr></thead>
        <tbody className="divide-y">{resultado.notificaciones.map(n => <tr key={n.id} className="align-top">
          <td className="p-3 text-slate-500">{n.id}</td>
          <td className="p-3"><span className={`block break-all ${n.cliente === 'eliminado' ? 'text-slate-400' : 'text-slate-800'}`}>{n.destinatario}</span>{n.cliente_nombre && <span className="block text-xs text-slate-500">{n.cliente_nombre}</span>}{CLIENTE[n.cliente] && <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${CLIENTE[n.cliente].clase}`}>{CLIENTE[n.cliente].etiqueta}</span>}</td>
          <td className="p-3 text-slate-600">{TIPOS_CORREO[n.tipo] ?? n.tipo}</td>
          <td className="p-3 text-slate-600">{fechaHora(n.ultimo_intento_at ?? n.creada_at)}</td>
          <td className="p-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${n.estado === 'fallido' ? 'bg-red-50 text-red-700' : 'bg-green-100 text-green-800'}`}>{n.estado === 'fallido' ? 'Error' : 'Enviado'}</span></td>
          <td className="p-3 text-slate-600">{n.intentos}</td>
          <td className="max-w-xs break-words p-3 text-xs text-slate-600">{n.estado === 'fallido' && <p className="mb-1 font-semibold text-red-700">El envío no se completó.</p>}<p>{DETALLES[n.tipo] || 'Aviso relacionado con la cuenta del cliente.'}</p>{n.solicitud_id && <p className="mt-1 font-medium">Solicitud #{n.solicitud_id}</p>}</td>
        </tr>)}</tbody>
      </table>
      {cargando && <p role="status" className="p-6 text-center text-sm text-slate-500">Cargando notificaciones…</p>}
      {!cargando && !resultado.error && resultado.notificaciones.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No hay notificaciones con estos filtros.</p>}
    </div>
    {paginas > 1 && <div className="flex items-center justify-end gap-2 text-sm"><button type="button" disabled={pagina <= 1 || cargando} onClick={() => setPagina(pagina - 1)} className={BOTON_SECUNDARIO}>Anterior</button><span className="text-slate-600">Página {pagina} de {paginas}</span><button type="button" disabled={pagina >= paginas || cargando} onClick={() => setPagina(pagina + 1)} className={BOTON_SECUNDARIO}>Siguiente</button></div>}
  </div>;
}

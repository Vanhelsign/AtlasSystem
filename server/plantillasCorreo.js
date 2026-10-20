// Plantillas de correo de ATLAS: funciones puras que devuelven { asunto, texto, html }.
// Texto plano y HTML sencillo con estilos en línea (los clientes de correo ignoran las hojas de estilo).
// Nunca incluyen precios ni costos internos; la contraseña temporal solo aparece en el correo de credenciales.

const COLOR_PRIMARIO = '#4f46e5'
const COLOR_TEXTO = '#0f172a'
const COLOR_SECUNDARIO = '#475569'

export function escaparHtml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const saludo = (nombre) => (nombre ? `Hola, ${nombre}:` : 'Hola:')

function documentoHtml({ titulo, parrafos, boton, nota }) {
  const cuerpo = parrafos.map((parrafo) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:${COLOR_TEXTO}">${parrafo}</p>`).join('\n')
  const enlace = boton
    ? `<p style="margin:24px 0"><a href="${escaparHtml(boton.url)}" style="display:inline-block;background:${COLOR_PRIMARIO};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${escaparHtml(boton.texto)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:${COLOR_SECUNDARIO}">Si el botón no funciona, copia esta dirección en tu navegador: ${escaparHtml(boton.url)}</p>`
    : ''
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${COLOR_PRIMARIO};padding:20px 24px;color:#ffffff;font-size:20px;font-weight:bold">ATLAS CRM</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:20px;color:${COLOR_TEXTO}">${escaparHtml(titulo)}</h1>
${cuerpo}
${enlace}
${nota ? `<p style="margin:16px 0 0;font-size:13px;color:${COLOR_SECUNDARIO}">${nota}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;font-size:12px;color:${COLOR_SECUNDARIO}">Este es un mensaje automático de ATLAS. No respondas a este correo.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

const PIE_TEXTO = '\n--\nATLAS CRM\nEste es un mensaje automático. No respondas a este correo.\n'

// Credenciales de acceso al portal, con contraseña temporal que el cliente debe cambiar al entrar.
export function plantillaCredenciales({ nombre, email, contrasenaTemporal, urlApp }) {
  const asunto = 'Tu acceso al portal de ATLAS'
  const texto = [
    saludo(nombre),
    '',
    'Registramos tu solicitud de dimensionamiento solar. Ya puedes consultar su avance en el portal de clientes de ATLAS.',
    '',
    `Portal: ${urlApp}`,
    `Correo de acceso: ${email}`,
    `Contraseña temporal: ${contrasenaTemporal}`,
    '',
    'Al iniciar sesión te pediremos cambiar la contraseña temporal por una propia de al menos 8 caracteres.',
    'Si no solicitaste este registro, ignora este mensaje.',
  ].join('\n') + PIE_TEXTO
  const html = documentoHtml({
    titulo: 'Tu acceso al portal de ATLAS',
    parrafos: [
      escaparHtml(saludo(nombre)),
      'Registramos tu solicitud de dimensionamiento solar. Ya puedes consultar su avance en el portal de clientes de ATLAS.',
      `<b>Correo de acceso:</b> ${escaparHtml(email)}<br><b>Contraseña temporal:</b> <span style="font-family:Consolas,Menlo,monospace;font-size:16px;background:#eef2ff;padding:2px 6px;border-radius:4px">${escaparHtml(contrasenaTemporal)}</span>`,
      'Al iniciar sesión te pediremos cambiar la contraseña temporal por una propia de al menos 8 caracteres.',
    ],
    boton: { texto: 'Entrar al portal', url: urlApp },
    nota: 'Si no solicitaste este registro, ignora este mensaje.',
  })
  return { asunto, texto, html }
}

// Aviso de cotización lista. Sin precios ni costos: el cliente los consulta en el portal.
export function plantillaCotizacionLista({ nombre, urlApp }) {
  const asunto = 'Tu cotización de ATLAS está lista'
  const texto = [
    saludo(nombre),
    '',
    'Tu cotización de sistema solar está lista. Puedes revisarla en el portal de clientes de ATLAS.',
    '',
    `Portal: ${urlApp}`,
    '',
    'Si tienes dudas, responde a tu agente de ventas por los medios habituales.',
  ].join('\n') + PIE_TEXTO
  const html = documentoHtml({
    titulo: 'Tu cotización está lista',
    parrafos: [
      escaparHtml(saludo(nombre)),
      'Tu cotización de sistema solar está lista. Puedes revisarla en el portal de clientes de ATLAS.',
    ],
    boton: { texto: 'Ver mi cotización', url: urlApp },
    nota: 'Si tienes dudas, comunícate con tu agente de ventas por los medios habituales.',
  })
  return { asunto, texto, html }
}

// Recordatorio de mantenimiento. Todavía no tiene disparador: depende del módulo de mantenimientos.
export function plantillaRecordatorio({ nombre, fecha, descripcion, urlApp }) {
  const asunto = 'Recordatorio de mantenimiento de tu sistema solar'
  const detalle = descripcion || 'mantenimiento de tu sistema solar'
  const texto = [
    saludo(nombre),
    '',
    `Te recordamos que tienes programado: ${detalle}${fecha ? `, con fecha límite ${fecha}` : ''}.`,
    '',
    `Consulta los detalles en el portal: ${urlApp}`,
  ].join('\n') + PIE_TEXTO
  const html = documentoHtml({
    titulo: 'Recordatorio de mantenimiento',
    parrafos: [
      escaparHtml(saludo(nombre)),
      `Te recordamos que tienes programado: <b>${escaparHtml(detalle)}</b>${fecha ? `, con fecha límite <b>${escaparHtml(fecha)}</b>` : ''}.`,
    ],
    boton: { texto: 'Ver en el portal', url: urlApp },
  })
  return { asunto, texto, html }
}

export const PLANTILLAS = {
  credenciales: plantillaCredenciales,
  cotizacion_lista: plantillaCotizacionLista,
  recordatorio: plantillaRecordatorio,
}

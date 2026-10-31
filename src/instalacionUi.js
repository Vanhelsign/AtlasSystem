export const principalInstalacion = 'rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50'
export const secundarioInstalacion = 'rounded-lg border bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 disabled:opacity-50'
export const direccionInstalacion = o => `${o.calle} ${o.numero_exterior}${o.numero_interior ? `, int. ${o.numero_interior}` : ''}, ${o.colonia}, ${o.municipio}, ${o.estado}, C.P. ${o.codigo_postal}`
export const fechaLocalInstalacion = valor => { if (!valor) return ''; const d = new Date(valor); return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

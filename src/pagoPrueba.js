export function pagoPruebaFrontend(env) {
  return env.ATLAS_DEV_SERVER === true && env.DEV === true && env.PROD !== true && (env.VITE_ATLAS_PAGO_SIMULADO ?? 'true') === 'true'
}

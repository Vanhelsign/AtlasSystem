import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  // Un build nunca incluye habilitado el botón, aunque .env diga development.
  define: { 'import.meta.env.ATLAS_DEV_SERVER': command === 'serve' && mode !== 'production' },
  server: {
    proxy: {
      // xfwd envía X-Forwarded-For con la IP del navegador; el servidor solo lo acepta de un proxy local
      // (trust proxy 'loopback'), para que el límite de intentos por IP no trate a todos como localhost.
      '/api': { target: 'http://localhost:3001', xfwd: true },
    },
  },
}))

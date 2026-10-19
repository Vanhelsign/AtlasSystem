// Pruebas del interceptor global de 401 (src/sesionApi.js) con una ventana simulada. Ejecutar con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { instalarManejoSesion } from "./sesionApi.js";

function ventanaSimulada(respuestas) {
  return {
    location: { origin: "http://localhost:5173" },
    fetch: async (recurso) => {
      const [estado, cuerpo] = respuestas[new URL(String(recurso), "http://localhost:5173").pathname] ?? [200, {}];
      return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
    },
  };
}

const conToken = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

test("401 de la API con el token actual: avisa con el motivo y devuelve la respuesta intacta", async () => {
  const ventana = ventanaSimulada({
    "/api/productos": [401, { error: "Sesión requerida o vencida", codigo: "sesion_vencida" }],
    "/api/portal/prospectos/1": [401, { error: "x", codigo: "contrasena_cambiada" }],
  });
  const motivos = [];
  instalarManejoSesion({ tokenActual: () => "abc", onSesionCerrada: (motivo) => motivos.push(motivo), ventana });
  const respuesta = await ventana.fetch("/api/productos", conToken("abc"));
  assert.equal(respuesta.status, 401);
  assert.equal((await respuesta.json()).codigo, "sesion_vencida", "el cuerpo sigue disponible para quien hizo la petición");
  await ventana.fetch("/api/portal/prospectos/1", conToken("abc"));
  assert.deepEqual(motivos, ["sesion_vencida", "contrasena_cambiada"]);
});

test("no reacciona al login, a otros tokens, a peticiones sin token, a otras rutas ni a otros códigos", async () => {
  const ventana = ventanaSimulada({
    "/api/login": [401, { error: "Credenciales incorrectas" }],
    "/api/productos": [401, {}],
    "/api/portal/prospectos/1": [403, { codigo: "debe_cambiar_password" }],
    "/otra/ruta": [401, {}],
  });
  const motivos = [];
  instalarManejoSesion({ tokenActual: () => "abc", onSesionCerrada: (motivo) => motivos.push(motivo), ventana });
  await ventana.fetch("/api/login", { method: "POST" });
  await ventana.fetch("/api/login", conToken("abc"));
  await ventana.fetch("/api/productos", conToken("token-de-sesion-anterior"));
  await ventana.fetch("/api/productos");
  await ventana.fetch("/api/portal/prospectos/1", conToken("abc"));
  await ventana.fetch("/otra/ruta", conToken("abc"));
  assert.deepEqual(motivos, []);
});

test("sin sesión iniciada no hace nada, y se puede desinstalar", async () => {
  const ventana = ventanaSimulada({ "/api/productos": [401, {}] });
  const original = ventana.fetch;
  const motivos = [];
  const desinstalar = instalarManejoSesion({ tokenActual: () => undefined, onSesionCerrada: (motivo) => motivos.push(motivo), ventana });
  await ventana.fetch("/api/productos", conToken("abc"));
  assert.deepEqual(motivos, []);
  desinstalar();
  assert.equal(ventana.fetch, original);
});

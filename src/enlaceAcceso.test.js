// Pruebas de la lectura del enlace "Crea tu contraseña" con una ventana simulada. Ejecutar con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { tomarTokenDeEnlace } from "./enlaceAcceso.js";

function ventanaSimulada(url) {
  const actual = new URL(url);
  const llamadas = [];
  return {
    llamadas,
    get location() { return { hash: actual.hash, pathname: actual.pathname, search: actual.search }; },
    history: {
      state: null,
      replaceState: (_estado, _titulo, nueva) => {
        llamadas.push(nueva);
        const siguiente = new URL(nueva, actual);
        actual.hash = siguiente.hash;
        actual.pathname = siguiente.pathname;
        actual.search = siguiente.search;
      },
    },
  };
}

test("toma el token del fragmento y lo quita de la barra de direcciones", () => {
  const ventana = ventanaSimulada("http://atlas.example/#crear-contrasena=abc_DEF-123");
  assert.equal(tomarTokenDeEnlace(ventana), "abc_DEF-123");
  assert.deepEqual(ventana.llamadas, ["/"]);
  assert.equal(ventana.location.hash, "");
  assert.equal(tomarTokenDeEnlace(ventana), null, "una segunda lectura ya no lo encuentra");
});

test("conserva la ruta y la consulta; ignora otros fragmentos y no toca la URL", () => {
  const ventana = ventanaSimulada("http://atlas.example/app?x=1#crear-contrasena=tok");
  assert.equal(tomarTokenDeEnlace(ventana), "tok");
  assert.deepEqual(ventana.llamadas, ["/app?x=1"]);
  const otra = ventanaSimulada("http://atlas.example/#otra-cosa");
  assert.equal(tomarTokenDeEnlace(otra), null);
  assert.deepEqual(otra.llamadas, []);
  const vacio = ventanaSimulada("http://atlas.example/#crear-contrasena=");
  assert.equal(tomarTokenDeEnlace(vacio), null);
  assert.deepEqual(vacio.llamadas, ["/"], "también limpia un enlace vacío");
});

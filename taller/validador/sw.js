// Service worker del validador: permite abrirlo y validar aunque no haya señal en la puerta.
// Estrategia "red primero": con internet siempre baja la versión y la lista más recientes;
// si la red falla o tarda más de ESPERA_RED_MS, usa la última copia guardada.

const CACHE = 'validador-v2';
const ARCHIVOS = ['./', './index.html', './jsQR.js', './validador.json'];
const ESPERA_RED_MS = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Solo se guarda lo que vive en esta carpeta (página, jsQR y la lista): nunca nada más.
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  e.respondWith(redPrimero(req));
});

async function redPrimero(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('sin respuesta de la red')), ESPERA_RED_MS)),
    ]);
    if (res.ok) {
      cache.put(req, res.clone());
      return res;
    }
    return (await cache.match(req, { ignoreSearch: true })) || res;
  } catch (err) {
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    throw err;
  }
}

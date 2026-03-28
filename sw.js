// Service Worker — Global Solutions SpA
// Estrategia: Network First para HTML (siempre versión más reciente)
// Fallback a caché SW si no hay red (modo offline)

const CACHE_NAME = 'gs-panel-v1';

// Instalar: tomar control inmediato sin esperar a que se cierren otras pestañas
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activar: limpiar cachés antiguos y tomar control de todos los clientes
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: Network First para navegación HTML
self.addEventListener('fetch', event => {
  const req = event.request;

  // Solo interceptar solicitudes de navegación (carga de página)
  if (req.mode === 'navigate') {
    event.respondWith(
      // Forzar red, ignorar caché HTTP del navegador
      fetch(req, { cache: 'no-store' })
        .then(res => {
          // Guardar copia fresca en caché SW (respaldo offline)
          if (res.ok) {
            caches.open(CACHE_NAME).then(c => c.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => {
          // Sin red: servir desde caché SW
          return caches.match(req)
            .then(r => r || caches.match('/global-solutions/'))
            .then(r => r || caches.match('/'));
        })
    );
    return;
  }

  // Todo lo demás (CDN, Supabase, imágenes): directo a red
});

// Escuchar mensajes del cliente (ej: forzar actualización)
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

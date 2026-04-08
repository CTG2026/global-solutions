// Service Worker — Global Solutions SpA
// Auto-eliminación: este SW se desregistra a sí mismo al activarse
// Esto resuelve de forma definitiva el problema de cachés permanentes

self.addEventListener('install', () => {
  // Tomar control inmediato sin esperar otras pestañas
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    // 1. Borrar TODOS los cachés
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      // 2. Desregistrar este Service Worker
      .then(() => self.registration.unregister())
      // 3. Forzar recarga de todos los clientes para que carguen sin SW
      .then(() => self.clients.matchAll({ includeUncontrolled: true, type: 'window' }))
      .then(clients => {
        clients.forEach(client => {
          try { client.navigate(client.url); } catch(e) {}
        });
      })
  );
});

// Sin handler de fetch — no interceptar ninguna solicitud

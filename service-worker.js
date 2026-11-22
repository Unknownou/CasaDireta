self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { title: 'CasaDireta', body: event.data?.text() || 'Tem uma nova atualização.' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'CasaDireta', { body: data.body || 'Tem uma nova mensagem.', icon: data.icon || '/favicon.ico', data: data.url || '/' }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target = '/';
  try {
    const url = new URL(event.notification.data || '/', self.location.origin);
    if (url.origin === self.location.origin) target = `${url.pathname}${url.search}${url.hash}`;
  } catch (_) { /* mantém a rota interna */ }
  event.waitUntil(clients.openWindow(target));
});

// sw.js
self.addEventListener('push', function(event) {
  let payload = {};
  try { payload = event.data.json(); } catch (e) { payload = { title: 'New message', body: event.data?.text || '' }; }

  const title = payload.title || 'New message';
  const body = payload.body || '';
  const icon = payload.icon || '/favicon-192.png';
  const data = payload.data || {};
  const tag = payload.tag || 'lc-msg';

  const options = {
    body,
    icon,
    badge: icon,
    data,
    tag,
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const dest = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url.includes(dest) || client.url === location.origin + '/') {
          client.focus();
          client.postMessage({ type: 'open', payload: event.notification.data });
          return client;
        }
      }
      return clients.openWindow(dest);
    })
  );
});

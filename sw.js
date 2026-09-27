// The Blueprint — Service Worker
// Handles push notifications and background sync

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
    if (!e.data) return;
    const data = e.data.json();
    const title = data.title || 'The Blueprint';
    const options = {
        body: data.body || '',
        icon: data.icon || '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: data.tag || 'blueprint-notification',
        renotify: !!data.renotify,
        data: { url: data.url || '/app/' },
        actions: data.actions || [],
        silent: false,
    };
    e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    const url = e.notification.data?.url || '/app/';
    e.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            // Only an app tab counts. The same origin also serves the sales
            // page, and focusing that in answer to "time to train" would drop
            // the member somewhere they cannot train.
            const existing = clients.find(c => c.url.includes('/app'));
            if (existing) return existing.focus();
            return self.clients.openWindow(url);
        })
    );
});

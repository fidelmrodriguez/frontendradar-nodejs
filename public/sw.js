self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text?.() || '' };
  }

  const title = data.title || 'Nova vaga Front-End';
  const options = {
    body: data.body || 'Uma nova vaga foi encontrada pelo radar.',
    icon: data.icon || '/icon-192.png',
    data: {
      url: data.url || '/',
      jobId: data.jobId || '',
    },
    tag: data.jobId ? `frontend-job-${data.jobId}` : 'frontend-radar',
    renotify: true,
    requireInteraction: false,
    timestamp: Date.now(),
    vibrate: [140, 80, 140],
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    if ('setAppBadge' in navigator) {
      try {
        await navigator.setAppBadge(1);
      } catch {
        // O navegador pode não permitir badge mesmo suportando a API.
      }
    }
  })());
});

function getNotificationTarget(data = {}) {
  const rawUrl = data.url || '/';
  const targetUrl = new URL(rawUrl, self.location.origin).href;
  const isMobile = /android|iphone|ipad|ipod/i.test(self.navigator?.userAgent || '');
  const isLinkedInJob = /^https:\/\/(?:[a-z]{2}\.)?linkedin\.com\/jobs\/view\//i.test(targetUrl)
    || /^https:\/\/www\.linkedin\.com\/jobs\/view\//i.test(targetUrl);

  if (!isMobile || !isLinkedInJob) return targetUrl;

  const params = new URLSearchParams({ url: targetUrl });
  if (data.jobId) params.set('jobId', String(data.jobId));
  return `${self.location.origin}/open-linkedin.html?${params.toString()}`;
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = getNotificationTarget(event.notification.data || {});

  event.waitUntil((async () => {
    if ('clearAppBadge' in navigator) {
      try {
        await navigator.clearAppBadge();
      } catch {
        // Ignora falhas de badge.
      }
    }

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === targetUrl);
    if (existing && 'focus' in existing) return existing.focus();
    return self.clients.openWindow(targetUrl);
  })());
});

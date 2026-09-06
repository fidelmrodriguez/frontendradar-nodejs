const SW_VERSION = '2026-09-06-mobile-deeplink-v2';

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
      swVersion: SW_VERSION,
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

function getSafeTarget(data = {}) {
  const rawUrl = data.url || '/';
  const targetUrl = new URL(rawUrl, self.location.origin).href;
  const userAgent = self.navigator?.userAgent || '';
  const isAndroid = /android/i.test(userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(userAgent);
  const isLinkedInJob = /^https:\/\/(?:[a-z]{2}\.)?linkedin\.com\/jobs\/view\//i.test(targetUrl)
    || /^https:\/\/www\.linkedin\.com\/jobs\/view\//i.test(targetUrl);

  if (!isLinkedInJob) return targetUrl;

  // iOS/iPadOS: usa o HTTPS da vaga diretamente no clique da notificação.
  // Esse é o formato de Universal Link do LinkedIn: se o app estiver instalado
  // e associado pelo iOS, o sistema abre o app; caso contrário, abre o navegador.
  if (isIOS) return targetUrl;

  // Android: passa por uma página intermediária que dispara uma Intent explícita
  // para o pacote oficial do LinkedIn e usa a URL web apenas como fallback.
  if (isAndroid) {
    const params = new URLSearchParams({ url: targetUrl });
    if (data.jobId) params.set('jobId', String(data.jobId));
    params.set('v', SW_VERSION);
    return `${self.location.origin}/open-linkedin.html?${params.toString()}`;
  }

  return targetUrl;
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = getSafeTarget(event.notification.data || {});

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

    // Mantém a abertura dentro do gesto real do clique da notificação. Isso é
    // importante especialmente no iOS para que o Universal Link tenha a melhor
    // chance de ser entregue ao aplicativo do LinkedIn.
    return self.clients.openWindow(targetUrl);
  })());
});

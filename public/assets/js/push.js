const button = document.querySelector('#notificationToggle');

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const ENABLED_STORAGE_KEY = 'frontendRadar.notificationsEnabled.v1';
const CLIENT_ID_STORAGE_KEY = 'frontendRadar.notificationClientId.v1';

let registration = null;
let activeSubscription = null;

function setButton({ text, active = false, disabled = false, title = '' }) {
  if (!button) return;
  button.textContent = text;
  button.disabled = disabled;
  button.classList.toggle('button--notify-active', active);
  button.title = title;
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // O Web Push continua funcionando mesmo se o navegador bloquear localStorage.
  }
}

function notificationsWereEnabledHere() {
  return readStoredValue(ENABLED_STORAGE_KEY) === '1';
}

function rememberNotificationState(enabled) {
  writeStoredValue(ENABLED_STORAGE_KEY, enabled ? '1' : '0');
}

function getClientId() {
  const existing = readStoredValue(CLIENT_ID_STORAGE_KEY);
  if (existing) return existing;

  const generated = globalThis.crypto?.randomUUID?.()
    || `radar-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeStoredValue(CLIENT_ID_STORAGE_KEY, generated);
  return generated;
}

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function fetchPublicKey() {
  const response = await fetch('/api/push/public-key', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !data?.publicKey) {
    throw new Error('Não foi possível obter a configuração de notificações.');
  }
  return data.publicKey;
}

async function syncSubscription(subscription) {
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      clientId: getClientId(),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error('Não foi possível salvar a assinatura de notificações.');
}

async function getReadyRegistration() {
  if (registration) return registration;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  registration = await navigator.serviceWorker.ready;
  return registration;
}

async function createSubscriptionIfNeeded() {
  const readyRegistration = await getReadyRegistration();
  activeSubscription = await readyRegistration.pushManager.getSubscription();
  if (activeSubscription) return activeSubscription;

  const publicKey = await fetchPublicKey();
  activeSubscription = await readyRegistration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(publicKey),
  });
  return activeSubscription;
}

function showActiveState() {
  rememberNotificationState(true);
  setButton({
    text: 'Notificações ativas ✓',
    active: true,
    title: 'Clique para desativar as notificações somente deste dispositivo.',
  });
}

async function subscribe({ showConfirmation = true } = {}) {
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();

  if (permission !== 'granted') {
    rememberNotificationState(false);
    if (permission === 'denied') {
      setButton({
        text: 'Notificações bloqueadas',
        disabled: true,
        title: 'Libere notificações nas configurações deste site no navegador.',
      });
    } else {
      setButton({
        text: 'Ativar notificações 🔔',
        title: 'Receba um aviso do sistema quando surgir uma vaga nova.',
      });
    }
    return;
  }

  const readyRegistration = await getReadyRegistration();
  const subscription = await createSubscriptionIfNeeded();
  await syncSubscription(subscription);
  showActiveState();

  if (showConfirmation) {
    await readyRegistration.showNotification('frontendradar-nodejs', {
      body: 'Notificações ativadas. Você será avisado quando surgir uma vaga Front-End nova.',
      icon: '/icon-192.png',
      tag: 'frontend-radar-enabled',
      requireInteraction: false,
    });
  }
}

async function unsubscribe() {
  const readyRegistration = await getReadyRegistration();
  activeSubscription ||= await readyRegistration.pushManager.getSubscription();

  if (activeSubscription) {
    const endpoint = activeSubscription.endpoint;
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => undefined);
    await activeSubscription.unsubscribe();
  }

  activeSubscription = null;
  rememberNotificationState(false);
  setButton({
    text: 'Ativar notificações 🔔',
    title: 'Receba um aviso do sistema quando surgir uma vaga nova.',
  });
}

async function toggleNotifications() {
  if (activeSubscription) {
    await unsubscribe();
    return;
  }

  setButton({ text: 'Ativando...', disabled: true });
  try {
    await subscribe();
  } catch (error) {
    console.error(error);
    setButton({
      text: 'Ativar notificações 🔔',
      title: 'Falha ao ativar notificações. Verifique sua conexão e tente novamente.',
    });
  }
}

export async function initPushNotifications() {
  if (!button) return;

  if (!supported) {
    const iosHint = isIOS && !isStandalone
      ? 'No iPhone/iPad, adicione o radar à Tela de Início e abra pelo ícone para ativar Web Push.'
      : 'Este navegador não oferece Web Push para este site.';
    setButton({
      text: isIOS && !isStandalone ? 'Instale na Tela de Início' : 'Notificações indisponíveis',
      disabled: true,
      title: iosHint,
    });
    return;
  }

  setButton({ text: 'Verificando notificações...', disabled: true });

  try {
    const readyRegistration = await getReadyRegistration();
    activeSubscription = await readyRegistration.pushManager.getSubscription();

    if (Notification.permission === 'denied') {
      rememberNotificationState(false);
      setButton({
        text: 'Notificações bloqueadas',
        disabled: true,
        title: 'Libere notificações nas configurações deste site no navegador.',
      });
      return;
    }

    if (Notification.permission === 'granted' && activeSubscription) {
      await syncSubscription(activeSubscription).catch(() => undefined);
      showActiveState();
      return;
    }

    if (Notification.permission === 'granted' && notificationsWereEnabledHere()) {
      await subscribe({ showConfirmation: false });
      return;
    }

    rememberNotificationState(false);
    setButton({
      text: 'Ativar notificações 🔔',
      title: 'Receba um aviso do sistema quando surgir uma vaga nova.',
    });
  } catch (error) {
    console.error(error);
    setButton({
      text: 'Notificações indisponíveis',
      disabled: true,
      title: 'Falha ao iniciar notificações. Tente novamente mais tarde.',
    });
  }
}

button?.addEventListener('click', toggleNotifications);

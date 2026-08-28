import { initPushNotifications } from './push.js';

const elements = {
  refreshNow: document.querySelector('#refreshNow'),
  searchInput: document.querySelector('#searchInput'),
  periodSelect: document.querySelector('#periodSelect'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
  jobCount: document.querySelector('#jobCount'),
  newCount: document.querySelector('#newCount'),
  hourCount: document.querySelector('#hourCount'),
  lastCollection: document.querySelector('#lastCollection'),
  averageInterval: document.querySelector('#averageInterval'),
  notice: document.querySelector('#notice'),
  loadingState: document.querySelector('#loadingState'),
  jobList: document.querySelector('#jobList'),
  emptyState: document.querySelector('#emptyState'),
  favicon: document.querySelector('#app-favicon'),
  shortcutFavicon: document.querySelector('#shortcut-favicon'),
};

const state = {
  jobs: [],
  collector: {
    historyDone: false,
    backoffUntil: 0,
    lastCollectionAt: 0,
    lastSuccessfulRequestAt: 0,
    lastError: '',
    lastSource: '',
  },
  loading: true,
  refreshing: false,
  info: '',
  error: '',
};

const PERIOD_MS = {
  r3600: 60 * 60 * 1000,
  r21600: 6 * 60 * 60 * 1000,
  r86400: 24 * 60 * 60 * 1000,
  r604800: 7 * 24 * 60 * 60 * 1000,
  r2592000: 30 * 24 * 60 * 60 * 1000,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getJobAgeMs(job) {
  const postedText = String(job?.postedText || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

  if (/\b(agora|ha pouco|just now|moments? ago|instantes?|a moment ago|recently)\b/.test(postedText)) return 0;

  const minutesMatch = postedText.match(/(\d+)\s*(min|minuto|minutos|minute|minutes)\b/);
  if (minutesMatch) return Number(minutesMatch[1]) * 60 * 1000;

  const hoursMatch = postedText.match(/(\d+)\s*(h|hora|horas|hour|hours|hr|hrs)\b/);
  if (hoursMatch) return Number(hoursMatch[1]) * 60 * 60 * 1000;

  const timestamp = Number(job?.postedAt || 0);
  if (!timestamp) return null;

  const age = Date.now() - timestamp;
  return age >= 0 ? age : null;
}

function isWithinHour(job) {
  const age = getJobAgeMs(job);
  return age !== null && age < 60 * 60 * 1000;
}

function prettyAge(job) {
  const rawPostedText = String(job?.postedText || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\bha pouco\b/.test(rawPostedText)) return 'há pouco';

  const diff = getJobAgeMs(job);
  if (diff === null) return job?.postedText || 'data não informada';

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;

  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `há ${hours} h`;

  const days = Math.floor(diff / 86400000);
  if (days < 7) return `há ${days} dia${days === 1 ? '' : 's'}`;
  if (days < 35) {
    const weeks = Math.max(1, Math.floor(days / 7));
    return `há ${weeks} semana${weeks === 1 ? '' : 's'}`;
  }
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30.4375));
    return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  }

  const years = Math.max(1, Math.floor(days / 365.25));
  return `há ${years} ano${years === 1 ? '' : 's'}`;
}

function formatLastCollection(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}


function getAverageRecentIntervalMs() {
  const now = Date.now();
  const cutoff = now - PERIOD_MS.r2592000;
  const timestamps = state.jobs
    .map(job => Number(job?.postedAt || 0))
    .filter(timestamp => Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now)
    .sort((a, b) => a - b);

  if (timestamps.length < 2) return null;
  const span = timestamps[timestamps.length - 1] - timestamps[0];
  return span > 0 ? span / (timestamps.length - 1) : null;
}

function formatAverageInterval(intervalMs) {
  if (!intervalMs) return 'calculando...';

  const totalMinutes = Math.max(1, Math.round(intervalMs / 60000));
  if (totalMinutes < 60) return `1 vaga / ${totalMinutes} min`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return `1 vaga / ${totalHours}h${minutes ? ` ${minutes}min` : ''}`;

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days < 30) return `1 vaga / ${days}d${hours ? ` ${hours}h` : ''}`;

  const months = Math.max(1, Math.round(days / 30.4375));
  return `1 vaga / ${months} ${months === 1 ? 'mês' : 'meses'}`;
}

function getFilteredJobs() {
  const search = elements.searchInput.value.trim().toLowerCase();
  const period = elements.periodSelect.value;
  const periodMs = PERIOD_MS[period] || null;

  return state.jobs.filter(job => {
    if (search) {
      const haystack = `${job.title || ''} ${job.company || ''} ${job.location || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (periodMs) {
      const age = getJobAgeMs(job);
      if (age === null || age > periodMs) return false;
    }

    return true;
  });
}

function renderFavicon(freshCount) {
  const mode = freshCount > 0 ? 'new' : 'normal';
  if (elements.favicon.dataset.mode === mode) return;

  const target = mode === 'new' ? '/favicon-new.ico?v=29' : '/favicon.ico?v=29';
  [elements.favicon, elements.shortcutFavicon].filter(Boolean).forEach(icon => {
    icon.dataset.mode = mode;
    icon.href = target;
  });
}

function renderStatus() {
  const fresh = state.jobs.filter(isWithinHour).length;
  const inBackoff = Number(state.collector.backoffUntil || 0) > Date.now();

  elements.jobCount.textContent = String(state.jobs.length);
  elements.newCount.textContent = String(fresh);
  elements.hourCount.textContent = String(fresh);
  elements.lastCollection.textContent = formatLastCollection(state.collector.lastCollectionAt);
  elements.averageInterval.textContent = formatAverageInterval(getAverageRecentIntervalMs());

  elements.statusDot.className = 'status-dot';
  if (inBackoff) {
    elements.statusDot.classList.add('status-dot--error');
    elements.statusText.textContent = 'Pausa anti-429';
  } else if (state.collector.historyDone) {
    elements.statusDot.classList.add('status-dot--ok');
    elements.statusText.textContent = 'Monitorando novas vagas';
  } else {
    elements.statusDot.classList.add('status-dot--warning');
    elements.statusText.textContent = 'Histórico em coleta';
  }

  renderFavicon(fresh);
}

function renderNotice() {
  const inBackoff = Number(state.collector.backoffUntil || 0) > Date.now();
  if (state.error) {
    elements.notice.hidden = false;
    elements.notice.className = 'notice notice--error';
    elements.notice.textContent = state.error;
    return;
  }

  if (inBackoff) {
    elements.notice.hidden = false;
    elements.notice.className = 'notice notice--warning';
    elements.notice.textContent = 'O LinkedIn limitou temporariamente as consultas. O site continua usando as vagas já salvas no MongoDB e o coletor tenta novamente automaticamente.';
    return;
  }

  if (state.info) {
    elements.notice.hidden = false;
    elements.notice.className = 'notice notice--success';
    elements.notice.textContent = state.info;
    return;
  }

  elements.notice.hidden = true;
  elements.notice.textContent = '';
}

function renderJobs() {
  const jobs = getFilteredJobs();

  elements.loadingState.hidden = !(state.loading || state.refreshing);
  elements.jobList.hidden = state.loading || jobs.length === 0;
  elements.emptyState.hidden = state.loading || jobs.length > 0;

  if (state.loading) return;

  elements.jobList.innerHTML = jobs.map(job => {
    const fresh = isWithinHour(job);
    const badges = [
      fresh ? '<span class="badge badge--new">NOVO</span>' : '',
      fresh ? '<span class="badge badge--hour">≤ 1 HORA</span>' : '',
    ].filter(Boolean).join('');

    return `<article class="job-card${fresh ? ' job-card--new' : ''}">
      <div class="job-card__content">
        <div class="job-card__title-row">
          <h2>${escapeHtml(job.title)}</h2>
          ${badges ? `<div class="job-card__badges">${badges}</div>` : ''}
        </div>
        <div class="job-card__meta">
          <span>🏢 ${escapeHtml(job.company || 'Empresa não informada')}</span>
          <span>📍 ${escapeHtml(job.location || 'Local não informado')}</span>
          <span>🕒 ${escapeHtml(prettyAge(job))}</span>
        </div>
      </div>
      <a class="job-card__link" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">Ver vaga ↗</a>
    </article>`;
  }).join('');
}

function render() {
  renderStatus();
  renderNotice();
  renderJobs();
}

async function loadJobs({ quiet = false } = {}) {
  if (!quiet) {
    state.loading = true;
    render();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch('/api/jobs', { cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error('Não foi possível carregar as vagas.');

    state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
    state.collector = { ...state.collector, ...(data.state || {}) };
    state.error = '';
  } catch (error) {
    state.error = error?.name === 'AbortError'
      ? 'Não foi possível carregar as vagas: tempo limite excedido.'
      : 'Não foi possível carregar as vagas. Verifique sua conexão e tente novamente.';
  } finally {
    clearTimeout(timeout);
    state.loading = false;
    render();
  }
}

async function refreshNow() {
  if (state.refreshing) return;
  state.refreshing = true;
  elements.refreshNow.disabled = true;
  elements.refreshNow.textContent = 'Atualizando...';
  render();

  try {
    const response = await fetch('/api/collect-now', { method: 'POST', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error('Não foi possível atualizar as vagas.');
    await loadJobs({ quiet: true });
  } catch (error) {
    state.error = 'Falha ao atualizar as vagas. Verifique sua conexão e tente novamente.';
    render();
  } finally {
    state.refreshing = false;
    elements.refreshNow.disabled = false;
    elements.refreshNow.textContent = 'Atualizar agora';
    render();
  }
}

elements.searchInput.addEventListener('input', render);
elements.periodSelect.addEventListener('change', render);
elements.refreshNow.addEventListener('click', refreshNow);

initPushNotifications();
loadJobs();
setInterval(() => loadJobs({ quiet: true }), 30_000);
setInterval(render, 20_000);

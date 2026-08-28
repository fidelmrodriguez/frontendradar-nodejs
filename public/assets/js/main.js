const elements = {
  refreshNow: document.querySelector('#refreshNow'),
  maintenanceNow: document.querySelector('#maintenanceNow'),
  searchInput: document.querySelector('#searchInput'),
  periodSelect: document.querySelector('#periodSelect'),
  statusDot: document.querySelector('#statusDot'),
  statusText: document.querySelector('#statusText'),
  jobCount: document.querySelector('#jobCount'),
  newCount: document.querySelector('#newCount'),
  hourCount: document.querySelector('#hourCount'),
  lastCollection: document.querySelector('#lastCollection'),
  notice: document.querySelector('#notice'),
  loadingState: document.querySelector('#loadingState'),
  jobList: document.querySelector('#jobList'),
  emptyState: document.querySelector('#emptyState'),
  favicon: document.querySelector('#app-favicon'),
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
  maintaining: false,
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

function isWithinHour(job) {
  const timestamp = Number(job?.postedAt || 0);
  if (!timestamp) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age < 60 * 60 * 1000;
}

function prettyAge(job) {
  const timestamp = Number(job?.postedAt || 0);
  if (!timestamp) return job?.postedText || 'data não informada';

  const diff = Math.max(0, Date.now() - timestamp);
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

function getFilteredJobs() {
  const search = elements.searchInput.value.trim().toLowerCase();
  const period = elements.periodSelect.value;
  const periodMs = PERIOD_MS[period] || null;
  const now = Date.now();

  return state.jobs.filter(job => {
    if (search) {
      const haystack = `${job.title || ''} ${job.company || ''} ${job.location || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (periodMs) {
      const postedAt = Number(job.postedAt || 0);
      if (!postedAt || now - postedAt > periodMs) return false;
    }

    return true;
  });
}

function renderFavicon(freshCount) {
  const target = freshCount > 0 ? '/favicon-new.svg' : '/favicon.svg';
  if (!elements.favicon.href.endsWith(target)) {
    elements.favicon.href = `${target}?v=${freshCount > 0 ? 'new' : 'normal'}`;
  }
}

function renderStatus() {
  const fresh = state.jobs.filter(isWithinHour).length;
  const inBackoff = Number(state.collector.backoffUntil || 0) > Date.now();

  elements.jobCount.textContent = String(state.jobs.length);
  elements.newCount.textContent = String(fresh);
  elements.hourCount.textContent = String(fresh);
  elements.lastCollection.textContent = formatLastCollection(state.collector.lastCollectionAt);

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

  elements.loadingState.hidden = !state.loading;
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

  try {
    const response = await fetch('/api/jobs', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);

    state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
    state.collector = { ...state.collector, ...(data.state || {}) };
    state.error = '';
  } catch (error) {
    state.error = `Não foi possível carregar as vagas: ${error?.message || error}`;
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshNow() {
  if (state.refreshing) return;
  state.refreshing = true;
  elements.refreshNow.disabled = true;
  elements.refreshNow.textContent = 'Atualizando...';

  try {
    const response = await fetch('/api/collect-now', { method: 'POST', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    await loadJobs({ quiet: true });
  } catch (error) {
    state.error = `Falha ao atualizar: ${error?.message || error}`;
    render();
  } finally {
    state.refreshing = false;
    elements.refreshNow.disabled = false;
    elements.refreshNow.textContent = 'Atualizar agora';
  }
}

async function runMaintenance() {
  if (state.maintaining) return;
  state.maintaining = true;
  state.info = '';
  elements.maintenanceNow.disabled = true;
  elements.maintenanceNow.textContent = 'Executando manutenção...';

  try {
    const response = await fetch('/api/maintenance', { method: 'POST', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);

    const removed = Number(data.deletedTotal || 0);
    const remaining = Number(data.afterCount || 0);
    const sizeMb = Number.isFinite(Number(data.afterAtlasSizeMb)) ? ` • Atlas: ${Number(data.afterAtlasSizeMb).toFixed(2)} MB` : '';
    state.info = `Manutenção concluída: ${removed} vaga(s) antiga(s) removida(s) • ${remaining} vaga(s) mantida(s)${sizeMb}.`;
    state.error = '';
    await loadJobs({ quiet: true });
    render();
    setTimeout(() => {
      state.info = '';
      render();
    }, 10_000);
  } catch (error) {
    state.error = `Falha na manutenção do banco: ${error?.message || error}`;
    render();
  } finally {
    state.maintaining = false;
    elements.maintenanceNow.disabled = false;
    elements.maintenanceNow.textContent = 'Manutenção do banco';
  }
}

elements.searchInput.addEventListener('input', render);
elements.periodSelect.addEventListener('change', render);
elements.refreshNow.addEventListener('click', refreshNow);
elements.maintenanceNow.addEventListener('click', runMaintenance);

loadJobs();
setInterval(() => loadJobs({ quiet: true }), 30_000);
setInterval(render, 20_000);

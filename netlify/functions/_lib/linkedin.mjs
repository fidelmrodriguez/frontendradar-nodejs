import * as cheerio from 'cheerio';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const FRONT_EXPLICIT = [
  /\bfront[\s-]?end\b/i,
  /\bfrontend\b/i,
  /\bui\s+(developer|engineer|dev|software)\b/i,
  /\bweb\s+frontend\b/i,
  /\bdesenvolvedor(?:a)?\s+front[\s-]?end\b/i,
  /\bengenheir[oa]\s+front[\s-]?end\b/i,
];

const FRONT_TECH = [
  /\breact(?:\.js|js)?\b/i,
  /\bangular(?:\.js|js)?\b/i,
  /\bvue(?:\.js|js)?\b/i,
  /\bnext(?:\.js|js)?\b/i,
  /\bnuxt(?:\.js|js)?\b/i,
  /\bsvelte(?:kit)?\b/i,
];

const BACK_ROLE = [
  /\bback[\s-]?end\b/i,
  /\bbackend\b/i,
  /\bfull[\s-]?stack\b/i,
  /\bfullstack\b/i,
];

const BACK_TECH = [
  /\blaravel\b/i,
  /\bphp\b/i,
  /\blamp\b/i,
  /\bnode(?:\.js|js)?\b/i,
  /\bnest(?:\.js|js)?\b/i,
  /\bjava\b/i,
  /\bspring(?:\s+boot)?\b/i,
  /(?:^|[\s(/-])\.net(?:$|[\s)/,;-])/i,
  /\bdotnet\b/i,
  /(?:^|[\s(/-])c#(?:$|[\s)/,;-])/i,
  /\bpython\b/i,
  /\bdjango\b/i,
  /\bflask\b/i,
  /\bruby\b/i,
  /\brails\b/i,
  /\bgolang\b/i,
  /\bgo\s+developer\b/i,
  /\bkotlin\b/i,
];

const HARD_NON_FRONT = [
  /\breact\s+native\b/i,
  /\bmobile\b/i,
  /\bandroid\b/i,
  /\bios\b/i,
  /\bflutter\b/i,
  /\bdevops\b/i,
  /\bsre\b/i,
  /\bsite reliability\b/i,
  /\bdata\s+(engineer|scientist|analyst)\b/i,
  /\bmachine learning\b/i,
  /\bml engineer\b/i,
  /\bqa\b/i,
  /\bquality assurance\b/i,
  /\bsecurity engineer\b/i,
  /\bcybersecurity\b/i,
  /\bsupport engineer\b/i,
  /\bembedded\b/i,
  /\bfirmware\b/i,
];

export function isFrontTitle(title) {
  const value = clean(title);
  if (!value) return false;
  if (HARD_NON_FRONT.some(pattern => pattern.test(value))) return false;
  if (BACK_ROLE.some(pattern => pattern.test(value))) return false;

  const explicitFront = FRONT_EXPLICIT.some(pattern => pattern.test(value));
  const frontTech = FRONT_TECH.some(pattern => pattern.test(value));
  const backTech = BACK_TECH.some(pattern => pattern.test(value));

  if (explicitFront) return true;
  return frontTech && !backTech;
}

function parseRelative(text) {
  const value = norm(text);
  if (!value) return null;
  if (/just now|agora|moments? ago|instantes?/.test(value)) return Date.now();

  const match = value.match(/(\d+)/);
  const amount = match ? Number(match[1]) : 1;

  if (/\b(minute|minutes|minuto|minutos|min)\b/.test(value)) return Date.now() - amount * 60000;
  if (/\b(hour|hours|hora|horas|hr|hrs|h)\b/.test(value)) return Date.now() - amount * 3600000;
  if (/\b(day|days|dia|dias)\b/.test(value)) return Date.now() - amount * 86400000;
  if (/\b(week|weeks|semana|semanas)\b/.test(value)) return Date.now() - amount * 7 * 86400000;
  if (/\b(month|months|mes|meses)\b/.test(value)) return Date.now() - amount * 30.4375 * 86400000;
  if (/\b(year|years|ano|anos)\b/.test(value)) return Date.now() - amount * 365.25 * 86400000;
  return null;
}

function parseAbsolute(value) {
  const raw = clean(value);
  if (!raw || /^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePostedAt(text, datetime) {
  const relative = parseRelative(text);
  const absolute = parseAbsolute(datetime);
  const normalized = norm(text);

  if (/just now|agora|moments? ago|instantes?/.test(normalized)
    || /\b(minute|minutes|minuto|minutos|min|hour|hours|hora|horas|hr|hrs|h)\b/.test(normalized)) {
    return relative ?? absolute;
  }

  return absolute ?? relative;
}

export function buildGuestUrl({ keyword, location = 'Brazil', period = 'all', start = 0 }) {
  const params = new URLSearchParams({
    keywords: keyword || 'frontend',
    location,
    sortBy: 'DD',
    start: String(Number(start || 0)),
    trk: 'public_jobs_jobs-search-bar_search-submit',
  });

  if (period && period !== 'all') {
    params.set('f_TPR', period);
  }

  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;
}

export async function fetchLinkedInSearch(params) {
  const url = buildGuestUrl(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36',
      },
    });

    const html = await response.text();
    return { ok: response.ok, status: response.status, html, url };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      html: '',
      url,
      error: error?.name === 'AbortError' ? 'TIMEOUT' : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseSearchHtml(html) {
  const $ = cheerio.load(html || '');
  const jobs = [];
  const seen = new Set();
  let rawCount = 0;

  $('li').each((_, element) => {
    const listItem = $(element);
    const card = listItem.find('.base-card').first().length
      ? listItem.find('.base-card').first()
      : listItem;

    const link = card.find("a.base-card__full-link, a[href*='/jobs/view/']").first();
    if (!link.length) return;
    rawCount += 1;

    const href = link.attr('href') || '';
    const urn = card.attr('data-entity-urn') || '';
    const urnMatch = urn.match(/jobPosting:(\d+)/);
    const hrefMatch = href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/);
    const id = urnMatch?.[1] || hrefMatch?.[1];
    if (!id || seen.has(id)) return;

    const title = clean(card.find(".base-search-card__title, [class*='_title']").first().text() || link.text());
    if (!isFrontTitle(title)) return;

    const company = clean(card.find(".base-search-card__subtitle, [class*='_subtitle']").first().text());
    const location = clean(card.find(".job-search-card__location, [class*='_location']").first().text());
    const time = card.find('time').first();
    const postedText = clean(time.text());
    const postedDatetime = clean(time.attr('datetime'));
    const cardText = clean(card.text());
    const easyApply = /\b(easy apply|candidatura simplificada|candidatura facil|candidatura fácil)\b/i.test(cardText)
      || card.find(".job-search-card__easy-apply-label, [class*='easy-apply'], [class*='easy_apply']").length > 0;

    seen.add(id);
    jobs.push({
      id,
      title,
      company,
      location,
      postedText,
      postedDatetime,
      postedAt: parsePostedAt(postedText, postedDatetime),
      easyApply,
      url: `https://www.linkedin.com/jobs/view/${id}/`,
    });
  });

  return { jobs, rawCount };
}

import { randomUUID } from 'node:crypto';
import { getDb } from './db.mjs';
import { fetchLinkedInSearch, parseSearchHtml } from './linkedin.mjs';
import { getRetentionDays, getMaxStoredJobs } from './maintenance.mjs';
import { notifyNewJobs } from './push.mjs';

const PAGE_SIZE = 10;
const MAX_RAW_EMPTY = 5;
const MAX_START = 3000;
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
const TEMP_BACKOFF_MS = 90 * 1000;
const LOCK_MS = 28_000;
const MANUAL_COOLDOWN_MS = 30_000;

const queryLanes = () => [
  'frontend',
  'front end',
  'desenvolvimento front end',
  'desenvolvedor frontend',
  'engenheiro frontend',
  'react frontend',
  'angular frontend',
  'vue frontend',
  'next.js frontend',
  'typescript frontend',
];

const monitorLanes = () => [
  'frontend',
  'front end',
  'desenvolvimento front end',
  'react frontend',
  'angular frontend',
  'vue frontend',
  'next.js frontend',
];

function defaultState() {
  return {
    _id: 'main',
    version: 25,
    lanes: queryLanes().map(term => ({ term, start: 0, rawEmpty: 0, done: false })),
    historyCursor: 0,
    monitorIndex: 0,
    historyDone: false,
    historyCompletedAt: 0,
    backoffUntil: 0,
    lastCollectionAt: 0,
    lastSuccessfulRequestAt: 0,
    lastError: '',
    lastErrorAt: 0,
    lastSource: 'endpoint público do LinkedIn • Netlify Functions',
    lastManualCollectAt: 0,
    updatedAt: Date.now(),
    lockUntil: 0,
    lockOwner: '',
  };
}

async function ensureState(db) {
  const states = db.collection('collector_state');
  let state = await states.findOne({ _id: 'main' });

  if (!state) {
    state = defaultState();
    await states.insertOne(state);
  }

  if (!Array.isArray(state.lanes) || !state.lanes.length) {
    state.lanes = defaultState().lanes;
    state.historyDone = false;
  }

  if (state.historyDone && Date.now() - Number(state.historyCompletedAt || 0) > 12 * 60 * 60 * 1000) {
    const reset = defaultState();
    state.lanes = reset.lanes;
    state.historyCursor = 0;
    state.historyDone = false;
    state.historyCompletedAt = 0;
    await saveState(db, state);
  }

  return state;
}

async function acquireLock(db) {
  const states = db.collection('collector_state');
  await ensureState(db);

  const now = Date.now();
  const owner = randomUUID();
  const result = await states.updateOne(
    {
      _id: 'main',
      $or: [
        { lockUntil: { $lt: now } },
        { lockUntil: { $exists: false } },
        { lockUntil: 0 },
      ],
    },
    { $set: { lockUntil: now + LOCK_MS, lockOwner: owner, updatedAt: now } },
  );

  return result.modifiedCount === 1 ? owner : null;
}

async function releaseLock(db, owner) {
  if (!owner) return;
  await db.collection('collector_state').updateOne(
    { _id: 'main', lockOwner: owner },
    { $set: { lockUntil: 0, lockOwner: '', updatedAt: Date.now() } },
  );
}

async function saveState(db, state) {
  state.updatedAt = Date.now();
  await db.collection('collector_state').replaceOne({ _id: 'main' }, state, { upsert: true });
}

function nextHistoryLane(state) {
  const lanes = state.lanes || [];
  if (!lanes.some(lane => !lane.done)) return null;

  for (let offset = 0; offset < lanes.length; offset += 1) {
    const index = (Number(state.historyCursor || 0) + offset) % lanes.length;
    if (!lanes[index].done) {
      state.historyCursor = (index + 1) % lanes.length;
      return lanes[index];
    }
  }

  return null;
}

async function upsertJobs(db, jobs, source) {
  if (!jobs.length) return { added: 0, pushCandidates: [] };
  const now = Date.now();
  const cutoff = now - getRetentionDays() * 24 * 60 * 60 * 1000;
  const jobsToStore = jobs.filter(job => !Number(job.postedAt || 0) || Number(job.postedAt) >= cutoff);
  if (!jobsToStore.length) return { added: 0, pushCandidates: [] };

  const collection = db.collection('jobs');
  const existing = await collection
    .find(
      { _id: { $in: jobsToStore.map(job => job.id) } },
      { projection: { _id: 1, pushProcessedAt: 1 } },
    )
    .toArray();
  const existingById = new Map(existing.map(item => [String(item._id), item]));
  const pushCandidates = source.startsWith('monitor:')
    ? jobsToStore.filter(job => !Number(existingById.get(String(job.id))?.pushProcessedAt || 0))
    : [];

  const operations = jobsToStore.map(job => ({
    updateOne: {
      filter: { _id: job.id },
      update: {
        $set: {
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          postedText: job.postedText,
          postedDatetime: job.postedDatetime,
          postedAt: job.postedAt,
          easyApply: Boolean(job.easyApply),
          url: job.url,
          lastSeenAt: now,
          lastSeenSource: source,
        },
        $setOnInsert: {
          discoveredAt: now,
          discoveredBy: source,
        },
      },
      upsert: true,
    },
  }));

  const result = await collection.bulkWrite(operations, { ordered: false });

  const maxJobs = getMaxStoredJobs();
  if (await collection.estimatedDocumentCount() > maxJobs) {
    const overflow = await collection
      .find({}, { projection: { _id: 1 } })
      .sort({ postedAt: -1, _id: -1 })
      .skip(maxJobs)
      .limit(250)
      .toArray();
    if (overflow.length) {
      await collection.deleteMany({ _id: { $in: overflow.map(item => item._id) } });
    }
  }

  return {
    added: Number(result.upsertedCount || 0),
    pushCandidates,
  };
}

async function processPushCandidates(db, jobs) {
  if (!jobs.length) return;

  try {
    await notifyNewJobs(jobs);
  } catch (error) {
    console.warn('Falha ao disparar notificações:', error?.message || error);
  } finally {
    await db.collection('jobs').updateMany(
      { _id: { $in: jobs.map(job => job.id) } },
      { $set: { pushProcessedAt: Date.now() } },
    );
  }
}

function setNetworkError(state, response) {
  state.lastErrorAt = Date.now();
  if (response.status === 429) {
    state.lastError = 'RATE_LIMIT';
    state.backoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    return;
  }

  state.lastError = response.error || `HTTP_${response.status}`;
  state.backoffUntil = Date.now() + TEMP_BACKOFF_MS;
}

async function collectPage(db, state, { term, start, period, source }) {
  const location = process.env.LINKEDIN_LOCATION || 'Brazil';
  const response = await fetchLinkedInSearch({ keyword: term, location, period, start });
  state.lastSource = 'endpoint público do LinkedIn • Netlify Functions';

  if (!response.ok) {
    setNetworkError(state, response);
    await saveState(db, state);
    return { ok: false, rawCount: 0, added: 0, status: response.status };
  }

  const parsed = parseSearchHtml(response.html);
  const stored = await upsertJobs(db, parsed.jobs, source);

  if (source.startsWith('monitor:') && stored.pushCandidates.length) {
    await processPushCandidates(db, stored.pushCandidates);
  }

  state.lastSuccessfulRequestAt = Date.now();
  state.lastError = '';
  state.backoffUntil = 0;
  state.lastCollectionAt = Date.now();
  await saveState(db, state);

  return { ok: true, rawCount: parsed.rawCount, added: stored.added, jobs: parsed.jobs };
}

async function collectMonitor(db, state) {
  const lanes = monitorLanes();
  const term = lanes[Number(state.monitorIndex || 0) % lanes.length];
  state.monitorIndex = (Number(state.monitorIndex || 0) + 1) % lanes.length;
  return collectPage(db, state, {
    term,
    start: 0,
    period: 'r86400',
    source: `monitor:${term}`,
  });
}

async function collectHistory(db, state) {
  if (state.historyDone) return { ok: true, added: 0 };

  const lane = nextHistoryLane(state);
  if (!lane) {
    state.historyDone = true;
    state.historyCompletedAt = Date.now();
    await saveState(db, state);
    return { ok: true, added: 0 };
  }

  const result = await collectPage(db, state, {
    term: lane.term,
    start: lane.start,
    period: 'all',
    source: `history:${lane.term}`,
  });

  if (!result.ok) return result;

  lane.start += PAGE_SIZE;
  lane.rawEmpty = result.rawCount === 0 ? Number(lane.rawEmpty || 0) + 1 : 0;
  if (lane.rawEmpty >= MAX_RAW_EMPTY || lane.start >= MAX_START) {
    lane.done = true;
  }

  if (!state.lanes.some(item => !item.done)) {
    state.historyDone = true;
    state.historyCompletedAt = Date.now();
  }

  await saveState(db, state);
  return result;
}

export async function runCollector({ manual = false, maxRequests = 2 } = {}) {
  const db = await getDb();
  const owner = await acquireLock(db);
  if (!owner) return { ok: true, locked: true };

  try {
    const state = await ensureState(db);
    const now = Date.now();

    if (state.backoffUntil && state.backoffUntil > now) {
      return { ok: true, backoff: true, until: state.backoffUntil };
    }

    if (manual && now - Number(state.lastManualCollectAt || 0) < MANUAL_COOLDOWN_MS) {
      return { ok: true, cooldown: true };
    }

    if (manual) {
      state.lastManualCollectAt = now;
      await saveState(db, state);
    }

    const results = [];
    const requestCount = Math.max(1, Math.min(Number(maxRequests || 2), 2));

    for (let index = 0; index < requestCount; index += 1) {
      if (state.backoffUntil > Date.now()) break;
      const result = index === 0
        ? await collectMonitor(db, state)
        : await collectHistory(db, state);
      results.push(result);
      if (!result.ok) break;
      if (index + 1 < requestCount) {
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    }

    state.lastCollectionAt = Date.now();
    await saveState(db, state);

    return {
      ok: true,
      results,
      historyDone: state.historyDone,
    };
  } finally {
    await releaseLock(db, owner);
  }
}

export async function readDashboardData() {
  const db = await getDb();
  const state = await ensureState(db);
  const jobs = await db.collection('jobs')
    .find({}, { projection: { _id: 0 } })
    .sort({ postedAt: -1, id: -1 })
    .limit(1500)
    .toArray();

  return {
    jobs,
    state: {
      historyDone: Boolean(state.historyDone),
      backoffUntil: Number(state.backoffUntil || 0),
      lastCollectionAt: Number(state.lastCollectionAt || 0),
      lastSuccessfulRequestAt: Number(state.lastSuccessfulRequestAt || 0),
      lastError: state.lastError || '',
      lastSource: state.lastSource || '',
    },
  };
}

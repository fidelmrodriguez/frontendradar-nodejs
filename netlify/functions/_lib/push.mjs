import webpush from 'web-push';
import { getDb } from './db.mjs';

const DEFAULT_SUBJECT = 'https://frontendradar-nodejs.netlify.app';
const CONFIG_ID = 'web_push_vapid';

let configuredVapid = '';
let cachedVapidConfig = null;

function applyVapidConfig(config) {
  const signature = `${config.subject}|${config.publicKey}|${config.privateKey}`;
  if (configuredVapid !== signature) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configuredVapid = signature;
  }
  return config;
}

function readEnvVapidConfig() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (!publicKey || !privateKey) return null;

  return {
    publicKey,
    privateKey,
    subject: String(process.env.VAPID_SUBJECT || DEFAULT_SUBJECT).trim() || DEFAULT_SUBJECT,
  };
}

async function loadOrCreateStoredVapidConfig() {
  const db = await getDb();
  const collection = db.collection('app_config');

  const existing = await collection.findOne({ _id: CONFIG_ID });
  if (existing?.publicKey && existing?.privateKey) {
    return {
      publicKey: String(existing.publicKey),
      privateKey: String(existing.privateKey),
      subject: String(existing.subject || DEFAULT_SUBJECT),
    };
  }

  const generated = webpush.generateVAPIDKeys();
  const candidate = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: DEFAULT_SUBJECT,
    createdAt: Date.now(),
  };

  try {
    const result = await collection.findOneAndUpdate(
      { _id: CONFIG_ID },
      { $setOnInsert: candidate },
      { upsert: true, returnDocument: 'after' },
    );

    if (result?.publicKey && result?.privateKey) {
      return {
        publicKey: String(result.publicKey),
        privateKey: String(result.privateKey),
        subject: String(result.subject || DEFAULT_SUBJECT),
      };
    }
  } catch (error) {
    if (Number(error?.code) !== 11000) throw error;
  }

  const stored = await collection.findOne({ _id: CONFIG_ID });
  if (!stored?.publicKey || !stored?.privateKey) {
    await collection.updateOne(
      { _id: CONFIG_ID },
      { $set: candidate },
      { upsert: true },
    );
    return candidate;
  }

  return {
    publicKey: String(stored.publicKey),
    privateKey: String(stored.privateKey),
    subject: String(stored.subject || DEFAULT_SUBJECT),
  };
}

async function getVapidConfig() {
  if (cachedVapidConfig) return applyVapidConfig(cachedVapidConfig);

  const fromEnv = readEnvVapidConfig();
  cachedVapidConfig = fromEnv || await loadOrCreateStoredVapidConfig();
  return applyVapidConfig(cachedVapidConfig);
}

function normalizeSubscription(subscription) {
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();

  if (!endpoint || !p256dh || !auth) {
    throw new Error('Assinatura push inválida');
  }

  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Endpoint push inválido');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Endpoint push deve usar HTTPS');
  }

  return {
    endpoint,
    expirationTime: subscription?.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

export async function getPushPublicKey() {
  const config = await getVapidConfig();
  return config.publicKey;
}

export async function savePushSubscription(subscription, { userAgent = '' } = {}) {
  await getVapidConfig();

  const normalized = normalizeSubscription(subscription);
  const db = await getDb();
  const now = Date.now();

  await db.collection('push_subscriptions').updateOne(
    { endpoint: normalized.endpoint },
    {
      $set: {
        ...normalized,
        userAgent: String(userAgent || '').slice(0, 500),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return normalized.endpoint;
}

export async function removePushSubscription(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return false;

  const db = await getDb();
  const result = await db.collection('push_subscriptions').deleteOne({ endpoint: value });
  return result.deletedCount > 0;
}

function isFreshJob(job) {
  const timestamp = Number(job?.postedAt || 0);
  if (!timestamp) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age < 60 * 60 * 1000;
}

function buildPayload(job) {
  const company = String(job.company || 'Empresa não informada').trim();
  const location = String(job.location || 'Brasil').trim();

  return JSON.stringify({
    title: `Nova vaga: ${job.title}`,
    body: `${company} • ${location}`,
    url: job.url || '/',
    jobId: String(job.id || ''),
    icon: '/icon-192.png',
  });
}

async function sendToSubscription(subscription, payload) {
  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime ?? null,
      keys: subscription.keys,
    },
    payload,
    {
      TTL: 60 * 60,
      urgency: 'high',
    },
  );
}

export async function notifyNewJobs(jobs) {
  await getVapidConfig();

  const freshJobs = (Array.isArray(jobs) ? jobs : []).filter(isFreshJob);
  if (!freshJobs.length) return { enabled: true, sent: 0 };

  const db = await getDb();
  const subscriptions = await db.collection('push_subscriptions')
    .find({}, { projection: { _id: 0, endpoint: 1, expirationTime: 1, keys: 1 } })
    .limit(100)
    .toArray();

  if (!subscriptions.length) return { enabled: true, sent: 0 };

  let sent = 0;
  const expiredEndpoints = new Set();

  for (const job of freshJobs) {
    const payload = buildPayload(job);

    for (let index = 0; index < subscriptions.length; index += 20) {
      const batch = subscriptions.slice(index, index + 20);
      const results = await Promise.allSettled(batch.map(subscription => sendToSubscription(subscription, payload)));

      results.forEach((result, batchIndex) => {
        if (result.status === 'fulfilled') {
          sent += 1;
          return;
        }

        const statusCode = Number(result.reason?.statusCode || result.reason?.status || 0);
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.add(batch[batchIndex].endpoint);
        } else {
          console.warn('Falha ao enviar Web Push:', statusCode || result.reason?.message || result.reason);
        }
      });
    }
  }

  if (expiredEndpoints.size) {
    await db.collection('push_subscriptions').deleteMany({ endpoint: { $in: [...expiredEndpoints] } });
  }

  return { enabled: true, sent };
}

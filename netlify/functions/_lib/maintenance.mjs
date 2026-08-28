import { getDb } from './db.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function getRetentionDays() {
  const value = Number(process.env.MAINTENANCE_RETENTION_DAYS || 90);
  return Number.isFinite(value) && value >= 7 ? Math.floor(value) : 90;
}

export function getMaxStoredJobs() {
  const value = Number(process.env.MAINTENANCE_MAX_JOBS || 2000);
  return Number.isFinite(value) && value >= 500 ? Math.floor(value) : 2000;
}

async function getAtlasSize(db) {
  try {
    const result = await db.command({ atlasSize: 1 });
    const bytes = Number(result?.atlasSize || 0);
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

async function trimOverflow(collection, maxJobs) {
  let deleted = 0;

  while (await collection.estimatedDocumentCount() > maxJobs) {
    const overflow = await collection
      .find({}, { projection: { _id: 1 } })
      .sort({ postedAt: -1, _id: -1 })
      .skip(maxJobs)
      .limit(500)
      .toArray();

    if (!overflow.length) break;
    const result = await collection.deleteMany({ _id: { $in: overflow.map(item => item._id) } });
    deleted += Number(result.deletedCount || 0);
    if (!result.deletedCount) break;
  }

  return deleted;
}

export async function runMaintenance() {
  const db = await getDb();
  const collection = db.collection('jobs');
  const retentionDays = getRetentionDays();
  const maxJobs = getMaxStoredJobs();
  const cutoff = Date.now() - retentionDays * DAY_MS;

  const beforeCount = await collection.estimatedDocumentCount();
  const beforeAtlasSize = await getAtlasSize(db);

  const staleResult = await collection.deleteMany({
    $or: [
      { postedAt: { $gt: 0, $lt: cutoff } },
      {
        $and: [
          {
            $or: [
              { postedAt: { $exists: false } },
              { postedAt: null },
              { postedAt: 0 },
            ],
          },
          { lastSeenAt: { $lt: cutoff } },
        ],
      },
    ],
  });

  const overflowDeleted = await trimOverflow(collection, maxJobs);
  const afterCount = await collection.estimatedDocumentCount();
  const afterAtlasSize = await getAtlasSize(db);

  return {
    ok: true,
    retentionDays,
    maxJobs,
    beforeCount,
    afterCount,
    deletedStale: Number(staleResult.deletedCount || 0),
    deletedOverflow: overflowDeleted,
    deletedTotal: Number(staleResult.deletedCount || 0) + overflowDeleted,
    beforeAtlasSizeMb: beforeAtlasSize == null ? null : beforeAtlasSize / 1024 / 1024,
    afterAtlasSizeMb: afterAtlasSize == null ? null : afterAtlasSize / 1024 / 1024,
  };
}

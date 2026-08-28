import { MongoClient, ServerApiVersion } from 'mongodb';

let clientPromise;
let indexesPromise;

export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI não configurada no Netlify');
  }

  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 8000,
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    clientPromise = client.connect();
  }

  const client = await clientPromise;
  const dbName = process.env.MONGODB_DB || 'linkedin_frontend_radar';
  const db = client.db(dbName);

  if (!indexesPromise) {
    indexesPromise = Promise.all([
      db.collection('jobs').createIndex({ postedAt: -1 }),
      db.collection('jobs').createIndex({ lastSeenAt: -1 }),
    ]).catch(() => undefined);
  }

  await indexesPromise;
  return db;
}

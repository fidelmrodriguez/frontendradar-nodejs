import { getDb } from './_lib/db.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
};

export default async () => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return new Response(JSON.stringify({ ok: true, database: db.databaseName }), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: String(error?.message || error) }),
      { status: 500, headers },
    );
  }
};

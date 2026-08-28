import { savePushSubscription } from './_lib/push.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
};

export default async request => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405, headers });
  }

  try {
    const body = await request.json();
    await savePushSubscription(body?.subscription, {
      userAgent: request.headers.get('user-agent') || '',
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error?.message || error) }),
      { status: 400, headers },
    );
  }
};

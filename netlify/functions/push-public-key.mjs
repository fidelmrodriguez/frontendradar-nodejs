import { getPushPublicKey } from './_lib/push.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
};

export default async request => {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Use GET' }), { status: 405, headers });
  }

  try {
    const publicKey = await getPushPublicKey();
    return new Response(JSON.stringify({ enabled: true, publicKey }), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ enabled: false, error: String(error?.message || error) }),
      { status: 503, headers },
    );
  }
};

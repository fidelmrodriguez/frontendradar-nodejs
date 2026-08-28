import { removePushSubscription } from './_lib/push.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
};

export default async request => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido. Use POST.' }), { status: 405, headers });
  }

  try {
    const body = await request.json();
    await removePushSubscription(body?.endpoint);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (error) {
    console.error('Erro interno:', error);
    return new Response(
      JSON.stringify({ error: 'Não foi possível remover a assinatura de notificações.' }),
      { status: 400, headers },
    );
  }
};

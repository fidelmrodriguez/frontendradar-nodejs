import { getPushPublicKey } from './_lib/push.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
};

export default async request => {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Método não permitido. Use GET.' }), { status: 405, headers });
  }

  try {
    const publicKey = await getPushPublicKey();
    return new Response(JSON.stringify({ enabled: true, publicKey }), { status: 200, headers });
  } catch (error) {
    console.error('Erro interno:', error);
    return new Response(
      JSON.stringify({ enabled: false, error: 'Não foi possível carregar a configuração de notificações.' }),
      { status: 503, headers },
    );
  }
};

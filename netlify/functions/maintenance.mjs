import { runMaintenance } from './_lib/maintenance.mjs';

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
    const result = await runMaintenance();
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    console.error('Erro interno:', error);
    return new Response(
      JSON.stringify({ error: 'Não foi possível executar a manutenção.' }),
      { status: 500, headers },
    );
  }
};

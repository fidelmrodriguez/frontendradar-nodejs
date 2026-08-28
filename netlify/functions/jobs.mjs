import { readDashboardData, runCollector } from './_lib/collector.mjs';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
};

export default async () => {
  try {
    let data = await readDashboardData();

    if (!data.jobs.length) {
      await runCollector({ manual: false, maxRequests: 2 });
      data = await readDashboardData();
    }

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (error) {
    console.error('Erro interno:', error);
    return new Response(
      JSON.stringify({ error: 'Erro interno ao carregar as vagas.' }),
      { status: 500, headers },
    );
  }
};

import { runMaintenance } from './_lib/maintenance.mjs';

export default async () => {
  await runMaintenance();
  return new Response('ok');
};

import { runCollector } from './_lib/collector.mjs';

export default async () => {
  await runCollector({ manual: false, maxRequests: 2 });
};

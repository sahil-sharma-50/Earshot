import { createProxy } from './server.js';

const adminToken = process.env.PROXY_ADMIN_TOKEN;
if (!adminToken) {
  console.error('PROXY_ADMIN_TOKEN is required');
  process.exit(1);
}

createProxy({
  proxyPort: Number(process.env.PROXY_PORT ?? 3128),
  adminPort: Number(process.env.ADMIN_PORT ?? 3129),
  adminToken,
  eventsUrl: process.env.CONTROL_EVENTS_URL ?? 'http://control:3000/internal/proxy-events',
  eventsToken: process.env.CONTROL_EVENTS_TOKEN ?? '',
  log: (m) => console.log(m),
}).then((h) => console.log(`earshot egress proxy on :${h.proxyPort}, admin on :${h.adminPort}`));

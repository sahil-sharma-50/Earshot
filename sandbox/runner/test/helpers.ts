import type { FastifyInstance } from 'fastify';
import { createStoreServer } from '../../../apps/store/src/server.js';

export async function startStore(): Promise<{ app: FastifyInstance; base: string }> {
  const app = createStoreServer();
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  return { app, base };
}

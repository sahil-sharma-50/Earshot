import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { name: 'web', environment: 'node' },
});

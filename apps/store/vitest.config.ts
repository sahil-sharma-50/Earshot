import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { name: 'store', testTimeout: 60_000, hookTimeout: 120_000 },
});

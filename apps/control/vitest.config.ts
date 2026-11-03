import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { name: 'control', testTimeout: 60_000, hookTimeout: 180_000 },
});

import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    projects: ['{packages,apps}/*/vitest.config.ts', '{proxy,sandbox/runner}/vitest.config.ts'],
  },
});

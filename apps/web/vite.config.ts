import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/** In dev, /run/<id> is the run page (control does the same in production). */
const runPage = (): Plugin => ({
  name: 'earshot-run-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/run\/[a-f0-9]{6,32}\/?(\?.*)?$/.test(req.url)) req.url = '/run.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), runPage()],
  resolve: { conditions: ['development'] },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // the page kit is served as-is from public/assets; the bundles go next to it
    assetsDir: '_app',
    rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html'), run: resolve(import.meta.dirname, 'run.html') } },
  },
});

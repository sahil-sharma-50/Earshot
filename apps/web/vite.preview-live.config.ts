import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['development'] },
  server: { port: 5199, proxy: { '/api': { target: 'https://104-238-159-1.sslip.io', changeOrigin: true, secure: true } } },
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The site lives in web/; the API (server/) runs on its own port and is proxied in development.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': process.env.API_URL ?? 'http://127.0.0.1:8789' } },
});

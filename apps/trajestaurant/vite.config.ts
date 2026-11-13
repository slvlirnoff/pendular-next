import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { renderPage } from './src/page';
import { regionOf } from './src/regions';

// The site lives in web/; the API (server/) runs on its own port and is proxied in development.
// REGION picks the edition (src/regions.ts) and its ports: REGION=vinnytsia pnpm dev:web.
const region = regionOf(process.env.REGION);

/** The page of the region, in development (in production the server writes it: server/server.ts). */
const regionPage: Plugin = { name: 'region-page', apply: 'serve', transformIndexHtml: (html) => renderPage(html, region) };

export default defineConfig({
  root: 'web',
  plugins: [react(), regionPage],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: Number(process.env.WEB_PORT ?? region.defaults.webPort),
    strictPort: true,
    proxy: { '/api': process.env.API_URL ?? `http://127.0.0.1:${process.env.PORT ?? region.defaults.port}` },
  },
});

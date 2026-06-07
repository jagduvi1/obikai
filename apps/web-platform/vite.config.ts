/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Web-platform build/dev/test config (ADR-0024). The cross-tenant operator console. In dev the
 * `/api` prefix is proxied to the running api so the httpOnly refresh cookie stays same-origin; in
 * production it is served behind the same origin as the api (Traefik routes `/api` + `/platform`).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});

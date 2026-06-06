/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Web-admin build/dev/test config. In dev the `/api` prefix is proxied to the running api so the
 * httpOnly refresh cookie stays same-origin (no CORS credential dance). In production the app is
 * served behind the same origin as the api (or `VITE_API_URL` points at it). Tests run in jsdom.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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

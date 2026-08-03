import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@cabinet': fileURLToPath(new URL('../../packages/cabinet/src', import.meta.url)),
    },
  },
  server: { port: 5175, open: false },
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
});

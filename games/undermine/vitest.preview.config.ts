import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * A separate config for the headless preview renderer, so it never runs as part of the
 * ordinary suite. It writes a file, which a test has no business doing.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@cabinet': fileURLToPath(new URL('../../packages/cabinet/src', import.meta.url)),
    },
  },
  test: { environment: 'node', include: ['tools/preview.ts'] },
});

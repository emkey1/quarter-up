import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    // Two pages: the game, and the level editor that feeds it. The editor ships with
    // the build deliberately — it is how levels get made, and a tool that only runs on
    // the author's machine is a tool that rots.
    rollupOptions: { input: { game: page('index'), editor: page('editor') } },
  },
});

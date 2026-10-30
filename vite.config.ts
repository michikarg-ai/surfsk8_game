import { defineConfig } from 'vite';

export default defineConfig({
  css: {
    postcss: {},
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'esnext',
  },
});

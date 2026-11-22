import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.ITCH_BUILD === '1' ? './' : '/',
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

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [vue()],
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  clearScreen: false,
  server: {
    port: 5177,
    strictPort: true,
    proxy: { '/api': process.env.STUDIO_API_PROXY ?? 'http://127.0.0.1:3007' },
  },
  build: { target: 'es2022' },
});

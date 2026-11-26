import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('./', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const upstream = process.env.STUDIO_API_PROXY ?? env.STUDIO_API_PROXY ?? 'http://127.0.0.1:3009';
  return {
    plugins: [vue()],
    envDir,
    clearScreen: false,
    server: { port: 5179, strictPort: true, proxy: { '/api': upstream } },
    preview: { port: 5179, strictPort: true, proxy: { '/api': upstream } },
    build: { target: 'es2022' },
  };
});

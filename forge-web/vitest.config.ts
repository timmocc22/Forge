import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
  },
});

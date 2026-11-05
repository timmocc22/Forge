import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.spec.ts', 'apps/**/*.spec.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'packages/contracts/src/**',
        'packages/plugin-sdk/src/**',
        'apps/web/src/platform/**',
        'apps/api/src/generation/**',
        'apps/api/src/projects/**',
      ],
    },
  },
});

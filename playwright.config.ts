import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'html-projects.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @studio/api start',
      url: 'http://127.0.0.1:3108/api/health',
      env: {
        PROVIDER: 'demo',
        PORT: '3108',
        DATA_DIR: '.data/e2e-html-projects',
        WEB_ORIGIN: 'http://127.0.0.1:5188',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'pnpm --filter @studio/web dev --port 5188',
      url: 'http://127.0.0.1:5188',
      env: { STUDIO_API_PROXY: 'http://127.0.0.1:3108' },
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});

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
      command: 'pnpm dev --port 5188',
      url: 'http://127.0.0.1:5188',
      env: { STUDIO_API_PROXY: process.env.E2E_API_URL ?? 'http://127.0.0.1:3108' },
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});

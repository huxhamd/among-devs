import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});

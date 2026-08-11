import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 15_000,
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: { browserName: 'chromium', headless: true, trace: 'retain-on-failure' }
});

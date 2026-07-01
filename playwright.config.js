import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  workers: 2,
  timeout: 120000,
  globalTimeout: 600000,
  retries: 0,
  reporter: [['line'], ['html', { outputFolder: './report', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    viewport: { width: 1920, height: 1080 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Drive the installed Google Chrome (bundled Chromium download is blocked
        // by endpoint security on this machine — see world.js for details).
        channel: 'chrome',
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled'],
        },
      },
    },
  ],
});

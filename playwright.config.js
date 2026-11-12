// Browser tests (Playwright; optional, the game itself needs no install). `npm run test:e2e` starts scripts/serve.js, then runs e2e/*.spec.js in every project below:
// desktop Chrome, Firefox and Safari (WebKit), plus two phone-sized screens with touch (Android Chrome, iPhone Safari).
// Browsers: run `npx playwright install` once. To use the Chrome you already have for the two Chromium projects,
// set PW_CHANNEL=chrome. Run one project with e.g. `npm run test:e2e -- --project=webkit`.
const { defineConfig, devices } = require('@playwright/test');
const channel = process.env.PW_CHANNEL || undefined;

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', acceptDownloads: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'phone-android', use: { ...devices['Pixel 7'], channel } },
    { name: 'phone-iphone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: { command: 'node scripts/serve.js', url: 'http://127.0.0.1:4173/index.html', reuseExistingServer: !process.env.CI },
});

// Browser tests (Playwright). `npm run test:e2e` starts scripts/serve.js, then runs e2e/*.spec.js in a real browser.
// Browser: run `npx playwright install chromium` once, or use the Chrome you already have with PW_CHANNEL=chrome.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', channel: process.env.PW_CHANNEL || undefined, acceptDownloads: true },
  webServer: { command: 'node scripts/serve.js', url: 'http://127.0.0.1:4173/index.html', reuseExistingServer: !process.env.CI },
});

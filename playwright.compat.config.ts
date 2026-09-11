import { chromium, defineConfig, devices } from '@playwright/test';
import { createE2eConfig } from './scripts/lib/playwright-config';

// Functional/geometry contracts across engines; pixel baselines belong to the
// pinned print renderer, not to every device's antialiasing implementation.
process.env.PUPPETEER_EXECUTABLE_PATH = chromium.executablePath();
const base = createE2eConfig('release');
export default defineConfig({
  ...base,
  testMatch: ['compat/**/*.spec.ts', 'e2e/order-create.spec.ts', 'e2e/order-pricing-materialization-error.spec.ts', 'e2e/workbench.spec.ts'],
  // Reuse complete business scenarios: create/edit, pricing rollback and live
  // quote interaction. The standard release suite covers their other cases.
  grep: /login, self-hosted fonts|missing font stops|ADMIN 创建|生产事实缺失时核价|prices immediately on entry/,

  outputDir: 'test-results/compat',
  reporter: [['list'], ['json', { outputFile: '.review/playwright-compat.json' }]],
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'ios-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 5'] } },
  ],
});

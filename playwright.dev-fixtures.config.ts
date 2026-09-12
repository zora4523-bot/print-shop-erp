import { defineConfig } from '@playwright/test';
import { createE2eConfig } from './scripts/lib/playwright-config';

const config = createE2eConfig('development');

// These fixture routes intentionally do not exist in a production build.
// The release configuration keeps the real admin pages in its own six-view gate.
export default defineConfig({
  ...config,
  projects: config.projects?.filter((project) => project.name?.startsWith('admin-')),
  outputDir: 'test-results/dev-fixtures',
  grep: /deterministic external sales price tier fixture/,
  reporter: [process.env.CI ? ['github'] : ['list'], ['html', { open: 'never', outputFolder: 'playwright-report/dev-fixtures' }],
    ['json', { outputFile: '.review/playwright-dev-fixtures.json' }]],
});

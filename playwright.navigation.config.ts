import { defineConfig } from '@playwright/test';
import { createE2eConfig } from './scripts/lib/playwright-config';

const mode = process.env.E2E_NAVIGATION_MODE === 'development' ? 'development' : 'release';
const config = createE2eConfig(mode);
const server = config.webServer as Exclude<typeof config.webServer, unknown[] | undefined>;
const environment = {
  ...server.env,
  NOTIFICATION_MOCK_MODE: 'false',
  CDR_BUNDLE_MOCK_MODE: 'false',
  WECOM_SMART_BOT_ID: '',
  WECOM_SMART_BOT_SECRET: '',
  E2E_RELEASE_MODE: '1',
};
Object.assign(process.env, environment);

export default defineConfig({
  ...config,
  testMatch: 'e2e/admin-shell-navigation.spec.ts',
  projects: [{ name: 'navigation', use: { browserName: 'chromium' } }],
  use: { ...config.use, actionTimeout: 15_000, screenshot: 'off', video: 'off', trace: 'off' },
  webServer: {
    ...server,
    env: environment,
    ...(mode === 'development' ? {
      command: `pnpm exec tsx scripts/e2e-preflight.ts && pnpm dev:web --hostname 127.0.0.1 --port ${new URL(String(config.use?.baseURL)).port}`,
    } : {}),
  },
});

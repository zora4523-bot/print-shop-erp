import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';
import { activateE2eDatabase, controlledE2eBaseUrl } from './e2e-environment';

const workerViewportProjects = [
  { name: 'worker-375x667', width: 375, height: 667 },
  { name: 'worker-393x852', width: 393, height: 852 },
  { name: 'worker-768x1024', width: 768, height: 1024 },
  { name: 'worker-1024x768', width: 1024, height: 768 },
  { name: 'worker-1280x800', width: 1280, height: 800 },
  { name: 'worker-1920x1080', width: 1920, height: 1080 },
] as const;

const adminViewportProjects = [
  { name: 'admin-375x667', width: 375, height: 667 },
  { name: 'admin-393x852', width: 393, height: 852 },
  { name: 'admin-768x1024', width: 768, height: 1024 },
  { name: 'admin-1024x768', width: 1024, height: 768 },
  { name: 'admin-1280x800', width: 1280, height: 800 },
  { name: 'admin-1920x1080', width: 1920, height: 1080 },
] as const;

export function createE2eConfig(mode: 'development' | 'release') {
  const release = mode === 'release';
  loadEnvConfig(process.cwd(), !release);
  // Config collection (--list) remains read-only. Actual execution must pass
  // both the webServer preflight and globalSetup before opening a connection.
  try {
    activateE2eDatabase();
  } catch {
    process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED = '0';
    process.env.E2E_APPEND_ONLY_DATABASE_REASON = 'PREFLIGHT_REQUIRED';
  }
  const baseURL = controlledE2eBaseUrl(process.env.E2E_BASE_URL, mode);
  const port = new URL(baseURL).port;
  const serverEnv: Record<string, string> = {
    NODE_ENV: release ? 'production' : 'development',
    E2E_RELEASE_MODE: release ? '1' : '0',
    // These are isolated test processes, including when Next uses production
    // build/start. They never represent a live notification/worker acceptance.
    NOTIFICATION_MOCK_MODE: 'true',
    WECOM_SMART_BOT_ID: 'e2e-only-smart-bot',
    WECOM_SMART_BOT_SECRET: 'e2e-only-smart-bot-secret',
    CDR_BUNDLE_MOCK_MODE: 'true',
    BACKGROUND_JOBS_MODE: 'inline',
    AUTH_SECRET: 'e2e-only-auth-secret-for-isolated-release-tests',
    AUTH_TRUST_HOST: 'true',
    AUTH_URL: baseURL,
    NEXTAUTH_URL: baseURL,
    CRON_SECRET: 'e2e-only-cron-secret-for-isolated-release-tests',
    // QR snapshots intentionally preserve this public origin across test ports.
    APP_PUBLIC_URL: 'http://localhost:3000',
  };
  Object.assign(process.env, serverEnv);
  return defineConfig({
    // Cover both end-to-end specs (./tests/e2e) and visual regression
    // specs (./tests/visual) under one runner. Keep Vitest regression files in
    // ./tests/regression out of Playwright's default *.test.* discovery.
    testDir: './tests',
    testMatch: ['e2e/**/*.spec.ts', 'visual/**/*.spec.ts'],
    globalSetup: './tests/e2e/global-setup.ts',
    fullyParallel: false, // append-only fixtures deliberately share one isolated database
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: 1,
    reporter: [process.env.CI ? ['github'] : ['list'], ['html', { open: 'never', outputFolder: `playwright-report/${mode}` }],
        ['json', { outputFile: `.review/playwright-${mode}.json` }]],
      ...(release ? { grepInvert: /deterministic external sales price tier fixture/ } : {}),
    outputDir: `test-results/${mode}`,
    use: {
      baseURL,
      // Preserve the first failure even when retries are disabled.
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure',
    },
    projects: [
      {
        name: 'chromium',
        testIgnore: [
          '**/worker-responsive.spec.ts',
          '**/admin-responsive.spec.ts',
          // Has its own project below with JS turned off; running it here
          // too would just re-test the hydrated path.
          '**/no-js.spec.ts',
        ],
        use: { ...devices['Desktop Chrome'] },
      },
      // Zero-JS fallback gate (DECISIONS.md 2026-08-17). Only the three
      // paths whose failure mode is "user can't recover" are covered:
      // login / logout / change-password. Everything else keeps zero-JS
      // submit as a default coding preference, not an asserted contract.
      {
        name: 'no-js',
        testMatch: '**/no-js.spec.ts',
        use: { ...devices['Desktop Chrome'], javaScriptEnabled: false },
      },
      ...workerViewportProjects.map(({ name, width, height }) => ({
        name,
        testMatch: '**/worker-responsive.spec.ts',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width, height },
          screen: { width, height },
          hasTouch: width <= 768,
          isMobile: width <= 768,
        },
      })),
      ...adminViewportProjects.map(({ name, width, height }) => ({
        name,
        testMatch: '**/admin-responsive.spec.ts',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width, height },
          screen: { width, height },
          hasTouch: width <= 768,
          isMobile: width <= 768,
        },
      })),
    ],
    webServer: {
      command: release
        ? `pnpm exec tsx scripts/e2e-preflight.ts && pnpm exec prisma generate && pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port ${port}`
        : `pnpm exec tsx scripts/e2e-preflight.ts && pnpm run dev --hostname 127.0.0.1 --port ${port}`,
      url: baseURL,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: release ? 300_000 : 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  });
}

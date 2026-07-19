import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

// Mirror Next's .env loading so tests reuse SEED_ADMIN_PASSWORD without
// having to re-set an E2E_ env var. Playwright's runner doesn't load
// .env on its own. We use @next/env (not bare dotenv) so .env.local /
// .env.test / .env.development precedence and variable expansion match
// what `next dev` does — bare dotenv only reads .env literally and
// would diverge from the running app (Codex round 74 / P2).
loadEnvConfig(process.cwd(), /* dev */ true);

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const webServerPort = new URL(baseURL).port || '3000';

const workerViewportProjects = [
  { name: 'worker-375x667', width: 375, height: 667 },
  { name: 'worker-393x852', width: 393, height: 852 },
  { name: 'worker-768x1024', width: 768, height: 1024 },
  { name: 'worker-1024x768', width: 1024, height: 768 },
  { name: 'worker-1280x800', width: 1280, height: 800 },
  { name: 'worker-1920x1080', width: 1920, height: 1080 },
] as const;

// E2E config — runs against the Next.js dev server. Locally we reuse
// whatever dev server is already running at E2E_BASE_URL (default :3000);
// CI / one-shot `pnpm test:e2e` spawns its own. Tests share the dev
// database (per CLAUDE.md MVP posture) and use unique-per-run inputs
// so reruns don't collide. A separate test DB can be added later.
export default defineConfig({
  // Cover both end-to-end specs (./tests/e2e) and visual regression
  // specs (./tests/visual) under one runner. testMatch defaults pick
  // up *.spec.ts in either subdir.
  testDir: './tests',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false, // share dev DB; serial keeps assertions stable
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html']] : 'list',
  use: {
    baseURL,
    // Trace + screenshot on first retry — cheap to keep on, useful when
    // a failure surfaces in CI / a stale environment.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/worker-responsive.spec.ts',
      use: { ...devices['Desktop Chrome'] },
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
  ],
  webServer: {
    command: `node ./node_modules/next/dist/bin/next dev --port ${webServerPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

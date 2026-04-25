import { defineConfig, devices } from '@playwright/test';

// E2E config — runs against the Next.js dev server. Locally we reuse
// whatever dev server is already running on :3000 (via `pnpm dev`);
// CI / one-shot `pnpm test:e2e` spawns its own. Tests share the dev
// database (per CLAUDE.md MVP posture) and use unique-per-run inputs
// so reruns don't collide. A separate test DB can be added later.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // share dev DB; serial keeps assertions stable
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    // Trace + screenshot on first retry — cheap to keep on, useful when
    // a failure surfaces in CI / a stale environment.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

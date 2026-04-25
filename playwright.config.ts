import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

// Mirror Next's .env loading so tests reuse SEED_ADMIN_PASSWORD without
// having to re-set an E2E_ env var. Playwright's runner doesn't load
// .env on its own. We use @next/env (not bare dotenv) so .env.local /
// .env.test / .env.development precedence and variable expansion match
// what `next dev` does — bare dotenv only reads .env literally and
// would diverge from the running app (Codex round 74 / P2).
loadEnvConfig(process.cwd(), /* dev */ true);

// E2E config — runs against the Next.js dev server. Locally we reuse
// whatever dev server is already running on :3000 (via `pnpm dev`);
// CI / one-shot `pnpm test:e2e` spawns its own. Tests share the dev
// database (per CLAUDE.md MVP posture) and use unique-per-run inputs
// so reruns don't collide. A separate test DB can be added later.
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
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

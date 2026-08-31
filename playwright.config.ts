import { defineConfig, devices } from '@playwright/test';
import { loadEnvConfig } from '@next/env';

// Mirror Next's .env loading so tests reuse SEED_ADMIN_PASSWORD without
// having to re-set an E2E_ env var. Playwright's runner doesn't load
// .env on its own. We use @next/env (not bare dotenv) so .env.local /
// .env.test / .env.development precedence and variable expansion match
// what `next dev` does — bare dotenv only reads .env literally and
// would diverge from the running app (Codex round 74 / P2).
loadEnvConfig(process.cwd(), /* dev */ true);

const defaultDatabaseUrl = process.env.DATABASE_URL?.trim() || null;
const requestedE2eDatabaseUrl = process.env.E2E_DATABASE_URL?.trim() || null;

function postgresDatabaseTarget(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      return null;
    }
    const hostname =
      url.hostname === '127.0.0.1' || url.hostname === '::1'
        ? 'localhost'
        : url.hostname.toLowerCase();
    const port = url.port || '5432';
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return database ? `${hostname}:${port}/${database}` : null;
  } catch {
    return null;
  }
}

function pointsAtSameDatabase(left: string, right: string): boolean {
  if (left === right) return true;
  const leftTarget = postgresDatabaseTarget(left);
  const rightTarget = postgresDatabaseTarget(right);
  return leftTarget !== null && leftTarget === rightTarget;
}

const requestedE2eDatabaseTarget = requestedE2eDatabaseUrl
  ? postgresDatabaseTarget(requestedE2eDatabaseUrl)
  : null;
const e2eDatabaseMatchesDefault = Boolean(
  requestedE2eDatabaseTarget &&
    requestedE2eDatabaseUrl &&
    defaultDatabaseUrl &&
    pointsAtSameDatabase(requestedE2eDatabaseUrl, defaultDatabaseUrl),
);
const isolatedE2eDatabaseUrl =
  requestedE2eDatabaseTarget && !e2eDatabaseMatchesDefault
    ? requestedE2eDatabaseUrl
    : null;
const hasIsolatedE2eDatabase = isolatedE2eDatabaseUrl !== null;

// Workers inherit the resolved config environment. The marker lets the
// append-only scanner fixture fail closed before opening a DB connection; the
// URL itself is never included in skip/error output.
process.env.E2E_APPEND_ONLY_DATABASE_ISOLATED = hasIsolatedE2eDatabase
  ? '1'
  : '0';
let appendOnlyDatabaseReason = 'ISOLATED';
if (!requestedE2eDatabaseUrl) appendOnlyDatabaseReason = 'MISSING';
else if (!requestedE2eDatabaseTarget) appendOnlyDatabaseReason = 'INVALID';
else if (e2eDatabaseMatchesDefault) {
  appendOnlyDatabaseReason = 'SAME_AS_DEFAULT';
}
process.env.E2E_APPEND_ONLY_DATABASE_REASON = appendOnlyDatabaseReason;
if (hasIsolatedE2eDatabase) {
  process.env.DATABASE_URL = isolatedE2eDatabaseUrl;
}

const explicitBaseURL = process.env.E2E_BASE_URL?.trim();
const baseURL =
  explicitBaseURL ||
  (hasIsolatedE2eDatabase
    ? 'http://localhost:3100'
    : 'http://localhost:3000');
const webServerPort = new URL(baseURL).port || '3000';

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

// Ordinary E2E retains the shared-dev-DB MVP posture. When an explicit,
// genuinely separate E2E_DATABASE_URL is supplied, both Playwright workers and
// the spawned Next server use it. That mode defaults to :3100 and never reuses
// the normal :3000 server, because append-only production reports cannot be
// safely cleaned out of a developer's working database.
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
    // Keep Playwright on the same lifecycle as local development so predev
    // regenerates Prisma before Next loads its client.
    command: `pnpm run dev --port ${webServerPort}`,
    url: baseURL,
    ...(hasIsolatedE2eDatabase
      ? { env: { DATABASE_URL: isolatedE2eDatabaseUrl } }
      : {}),
    reuseExistingServer: !hasIsolatedE2eDatabase && !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

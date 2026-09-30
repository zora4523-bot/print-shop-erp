import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { createE2eConfig } from './scripts/lib/playwright-config';

// Keep the worker-controlled suite separate from inline browser tests. The
// factory still enforces the same disposable database and work-price gates.
process.env.E2E_BASE_URL = process.env.E2E_DURABLE_BASE_URL || 'http://127.0.0.1:3300';
const base = createE2eConfig('release');
if (!base.webServer || Array.isArray(base.webServer)) {
  throw new Error('Durable E2E requires one isolated production web server');
}
const artifactRoot = process.env.E2E_DURABLE_ARTIFACT_ROOT || path.resolve('.review/durable-artifacts', randomUUID());
const durableEnv = {
  ...base.webServer.env,
  E2E_DURABLE_MODE: '1',
  E2E_DURABLE_WORKER_CONTROL: '1',
  E2E_DURABLE_ARTIFACT_ROOT: artifactRoot,
  BACKGROUND_JOBS_MODE: 'durable', PDF_ORDER_MODE: 'queued',
  BACKGROUND_JOB_QUEUE: 'HEAVY',
  APP_VERSION: process.env.E2E_CANDIDATE_SHA || process.env.APP_VERSION || 'e2e-durable-candidate',
  ORDER_EXPORT_ARTIFACT_DIR: path.join(artifactRoot, 'order-exports'),
  AGENT_MONTHLY_BILL_EXPORT_ARTIFACT_DIR: path.join(artifactRoot, 'bill-exports'),
  PDF_ARTIFACT_DIR: path.join(artifactRoot, 'pdf'),
};
Object.assign(process.env, durableEnv);

export default defineConfig({
  ...base,
  testDir: './tests/durable',
  testMatch: '**/*.spec.ts',
  grepInvert: undefined,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-durable' }], ['json', { outputFile: '.review/playwright-durable.json' }]],
  outputDir: 'test-results-durable',
  projects: [{ name: 'durable-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { ...base.webServer, env: durableEnv },
});

import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { createE2eConfig } from './scripts/lib/playwright-config';

// Focused real-worker/CDR integration with a local HTTP object-store fixture.
process.env.E2E_BASE_URL = process.env.E2E_CDR_BASE_URL || 'http://127.0.0.1:3312';
const base = createE2eConfig(process.env.E2E_CDR_DEV === '1' ? 'development' : 'release');
if (!base.webServer || Array.isArray(base.webServer)) throw new Error('Expected one test server');
const env = {
  ...base.webServer.env,
  E2E_DURABLE_MODE: '1', E2E_DURABLE_WORKER_CONTROL: '1',
  BACKGROUND_JOBS_MODE: 'durable', CDR_BUNDLE_MOCK_MODE: 'false',
  APP_VERSION: 'cdr-workbench-e2e', APP_PUBLIC_URL: process.env.E2E_BASE_URL,
  OSS_ACCESS_KEY_ID: 'cdr-test-only', OSS_ACCESS_KEY_SECRET: 'cdr-test-only',
  OSS_STS_ROLE_ARN: 'acs:ram::test:role/test', OSS_BUCKET: 'cdr-test', OSS_REGION: 'oss-cn-shenzhen',
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${path.resolve('tests/durable/fixtures/cdr-loopback-dns.mjs')}`.trim(),
  OSS_ENDPOINT: 'http://localhost:3313', OSS_PUBLIC_BASE_URL: 'http://127.0.0.1:3313',
};
Object.assign(process.env, env);
export default defineConfig({
  ...base, testDir: './tests/durable', testMatch: 'cdr-workbench.spec.ts',
  projects: [{ name: 'cdr-worker', use: { ...devices['Desktop Chrome'] } }],
  outputDir: 'test-results/cdr-worker',
  webServer: { ...base.webServer, env },
});

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { createE2eConfig } from './scripts/lib/playwright-config';

// Real Next routes + manually controlled durable worker, on a disposable DB.
const base = createE2eConfig('development');
if (!base.webServer || Array.isArray(base.webServer)) throw new Error('PDF E2E requires one web server');
const runId = process.env.E2E_PDF_RUN_ID || randomUUID();
const env = {
  E2E_PDF_RUN_ID: runId,
  ...base.webServer.env,
  E2E_DURABLE_MODE: '1', E2E_DURABLE_WORKER_CONTROL: '1',
  BACKGROUND_JOBS_MODE: 'durable', PDF_JOB_WAIT_MS: '1000',
  APP_VERSION: `pdf-e2e-${runId}`,
  PDF_ARTIFACT_STORAGE: 'filesystem',
  PDF_ARTIFACT_DIR: path.resolve('.review/pdf-artifacts', runId),
};
Object.assign(process.env, env);
export default defineConfig({
  ...base, testDir: './tests/durable', testMatch: 'pdf-recovery.spec.ts', workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], hasTouch: true } }],
  webServer: {
    ...base.webServer, env,
    command: base.webServer.command.replace('pnpm run dev ', 'pnpm exec prisma generate && pnpm run dev:web '),
  },
});

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { activateE2eDatabase } from './lib/e2e-environment';

export function assertE2eAdminCredentials(env: Readonly<Record<string, string | undefined>>): void {
  if (!(env.E2E_ADMIN_PASSWORD ?? env.SEED_ADMIN_PASSWORD)?.trim()) {
    throw new Error('Set E2E_ADMIN_PASSWORD or SEED_ADMIN_PASSWORD for the seeded test administrator before starting E2E.');
  }
}

export function runE2ePreflight(): void {
  loadEnvConfig(process.cwd(), process.env.E2E_RELEASE_MODE !== '1');
  assertE2eAdminCredentials(process.env);
  const database = activateE2eDatabase();
  console.log(`[e2e-preflight] isolated database target: ${database.target}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runE2ePreflight(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'E2E preflight failed');
    process.exitCode = 1;
  }
}

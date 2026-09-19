import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvConfig } from '@next/env';
import { activateE2eDatabase } from './lib/e2e-environment';

export function assertE2eAdminCredentials(env: Readonly<Record<string, string | undefined>>): void {
  if (!(env.E2E_ADMIN_PASSWORD ?? env.SEED_ADMIN_PASSWORD)?.trim()) {
    throw new Error('Set E2E_ADMIN_PASSWORD or SEED_ADMIN_PASSWORD for the seeded test administrator before starting E2E.');
  }
}

/**
 * CI shards start `next start` on a build made by another job (E2E_PREBUILT=1).
 * Turbopack links external packages (sharp, ali-oss, @prisma/…) from
 * `<distDir>/node_modules` into `node_modules/.pnpm`; a transport that drops
 * symlinks (actions/upload-artifact does) leaves copies that cannot resolve
 * their own dependencies, and the only symptom is an error boundary on pages
 * that touch an image. Fail here, with the cause, instead.
 */
export function assertPrebuiltReleaseBundle(distDir: string): void {
  if (!existsSync(join(distDir, 'BUILD_ID'))) {
    throw new Error(`E2E_PREBUILT=1 but ${distDir}/BUILD_ID is missing: download and unpack the shared release build first.`);
  }
  const externals = join(distDir, 'node_modules');
  if (!existsSync(externals)) return;
  const entries = readdirSync(externals).flatMap((name) =>
    name.startsWith('@') ? readdirSync(join(externals, name)).map((child) => join(name, child)) : [name]);
  const broken = entries.filter((name) => {
    const path = join(externals, name);
    return !lstatSync(path).isSymbolicLink() || !existsSync(path);
  });
  if (broken.length > 0) {
    throw new Error(
      `E2E_PREBUILT=1 but ${externals} lost its package symlinks (${broken.slice(0, 3).join(', ')}…). ` +
      'Ship the build as a tarball; actions/upload-artifact does not preserve symlinks.',
    );
  }
}

export function runE2ePreflight(): void {
  loadEnvConfig(process.cwd(), process.env.E2E_RELEASE_MODE !== '1');
  assertE2eAdminCredentials(process.env);
  const database = activateE2eDatabase();
  console.log(`[e2e-preflight] isolated database target: ${database.target}`);
  if (process.env.E2E_PREBUILT === '1') assertPrebuiltReleaseBundle(resolve(process.cwd(), '.next-release'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runE2ePreflight(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'E2E preflight failed');
    process.exitCode = 1;
  }
}

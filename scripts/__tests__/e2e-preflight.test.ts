import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertE2eAdminCredentials, assertPrebuiltReleaseBundle } from '../e2e-preflight';

describe('browser credentials are validated before an expensive server build', () => {
  it.each([{}, { SEED_ADMIN_PASSWORD: '' }, { E2E_ADMIN_PASSWORD: '  ', SEED_ADMIN_PASSWORD: 'seed-fixture' }])('rejects missing or empty selected credentials %#', (env) => {
    expect(() => assertE2eAdminCredentials(env)).toThrow('test administrator');
  });
  it.each([{ SEED_ADMIN_PASSWORD: 'seed-fixture' }, { E2E_ADMIN_PASSWORD: 'override-fixture' }])('accepts explicitly supplied test credentials %#', (env) => {
    expect(() => assertE2eAdminCredentials(env)).not.toThrow();
  });
});

describe('a shared release build is checked before the server starts on it', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  function bundle(): { dist: string; target: string } {
    const root = mkdtempSync(join(tmpdir(), 'erp-prebuilt-')); dirs.push(root);
    const dist = join(root, '.next-release'); const target = join(root, 'real-package');
    mkdirSync(join(dist, 'node_modules', '@prisma'), { recursive: true }); mkdirSync(target);
    writeFileSync(join(dist, 'BUILD_ID'), 'build');
    return { dist, target };
  }

  it('accepts a bundle whose external packages are live symlinks, including scoped ones', () => {
    const { dist, target } = bundle();
    symlinkSync(target, join(dist, 'node_modules', 'sharp-71044da80993d1fb'));
    symlinkSync(target, join(dist, 'node_modules', '@prisma', 'client-803883fe438164da'));
    expect(() => assertPrebuiltReleaseBundle(dist)).not.toThrow();
  });

  it('rejects a missing build', () => {
    const { dist } = bundle(); rmSync(join(dist, 'BUILD_ID'));
    expect(() => assertPrebuiltReleaseBundle(dist)).toThrow('BUILD_ID is missing');
  });

  it('rejects packages that arrived as plain copies (upload-artifact dropped the symlinks)', () => {
    const { dist } = bundle();
    mkdirSync(join(dist, 'node_modules', 'sharp-71044da80993d1fb'));
    expect(() => assertPrebuiltReleaseBundle(dist)).toThrow(/lost its package symlinks \(sharp-71044da80993d1fb/);
  });

  it('rejects dangling links (dependencies were not installed in this job)', () => {
    const { dist, target } = bundle();
    symlinkSync(join(target, 'gone'), join(dist, 'node_modules', '@prisma', 'client-803883fe438164da'));
    expect(() => assertPrebuiltReleaseBundle(dist)).toThrow('lost its package symlinks');
  });
});

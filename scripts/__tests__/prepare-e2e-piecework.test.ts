import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareE2ePiecework } from '../prepare-e2e-piecework';
import { e2ePieceworkManifest, E2E_PIECEWORK_SOURCE } from '../lib/e2e-piecework';
import { requireReleasePrerequisite } from '../../tests/e2e/release-prerequisite';

function env(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/ordinary',
    E2E_DATABASE_URL: 'postgresql://localhost/erp_e2e_test',
    E2E_DATABASE_CONFIRM_DATABASE: 'erp_e2e_test', SEED_ADMIN_USERNAME: 'e2e-admin' };
}

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('audited E2E-only price-book publication', () => {
  it('validates isolation before loading any database dependency', async () => {
    const load = vi.fn();
    await expect(prepareE2ePiecework({ ...env(), E2E_DATABASE_CONFIRM_DATABASE: '' }, load)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'PUBLISHED'])('uses the formal service for %s without changing stored history', async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
    const effectiveFrom = new Date('2026-09-10T00:00:00Z');
    const publish = vi.fn().mockResolvedValue({ outcome: status === 'DRAFT' ? 'PUBLISHED' : 'ALREADY_PUBLISHED' });
    const close = vi.fn();
    const waitUntilEffective = vi.fn();
    await prepareE2ePiecework(env(), async () => ({
      readBook: async () => ({ status, effectiveFrom: status === 'PUBLISHED' ? effectiveFrom : null, updatedAt: effectiveFrom }),
      actor: async () => ({ id: 'admin', role: 'ADMIN', username: 'e2e-admin', displayName: 'test admin' }),
      publish, waitUntilEffective, close,
    }));
    const input = publish.mock.calls[0]![0];
    expect(input.manifest).toEqual(e2ePieceworkManifest(status === 'PUBLISHED'
      ? effectiveFrom : new Date('2026-09-11T00:00:05Z')));
    expect(input.manifest.sourceName).toBe(E2E_PIECEWORK_SOURCE);
    expect(input.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(waitUntilEffective).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails a release prerequisite while preserving ordinary development skip handling', () => {
    vi.stubEnv('E2E_RELEASE_MODE', '1');
    expect(() => requireReleasePrerequisite('price unavailable')).toThrow('price unavailable');
    expect(() => requireReleasePrerequisite(null)).not.toThrow();
    vi.stubEnv('E2E_RELEASE_MODE', '0');
    expect(() => requireReleasePrerequisite('price unavailable')).not.toThrow();
  });
});

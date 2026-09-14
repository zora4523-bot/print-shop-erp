import { describe, expect, it, vi } from 'vitest';
import { prepareE2eBoxPackaging } from '../prepare-e2e-box-packaging';

function env(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/ordinary',
    E2E_DATABASE_URL: 'postgresql://localhost/erp_e2e_test',
    E2E_DATABASE_CONFIRM_DATABASE: 'erp_e2e_test',
    SEED_ADMIN_USERNAME: 'e2e-admin',
  };
}

const admin = { id: 'admin', role: 'ADMIN' as const, username: 'e2e-admin', displayName: 'test admin' };

describe('E2E-only confirmed box packaging installation', () => {
  it('validates isolation before loading any database dependency', async () => {
    const load = vi.fn();
    await expect(
      prepareE2eBoxPackaging({ ...env(), E2E_DATABASE_CONFIRM_DATABASE: '' }, load),
    ).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it('requires the seed administrator name and an active admin account', async () => {
    const load = vi.fn();
    await expect(prepareE2eBoxPackaging({ ...env(), SEED_ADMIN_USERNAME: ' ' }, load)).rejects.toThrow(
      /SEED_ADMIN_USERNAME/,
    );
    expect(load).not.toHaveBeenCalled();

    const close = vi.fn();
    const install = vi.fn();
    await expect(
      prepareE2eBoxPackaging(env(), async () => ({ actor: async () => null, install, close })),
    ).rejects.toThrow(/seed administrator/);
    expect(install).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['already-installed', 'published'] as const)(
    'installs through the formal service as the seed administrator (%s)',
    async (status) => {
      const receipt =
        status === 'published'
          ? { status, id: 'book', version: 9 }
          : { status, version: 8 };
      const install = vi.fn().mockResolvedValue(receipt);
      const close = vi.fn();
      await expect(
        prepareE2eBoxPackaging(env(), async () => ({ actor: async () => admin, install, close })),
      ).resolves.toEqual(receipt);
      expect(install).toHaveBeenCalledWith(admin);
      expect(close).toHaveBeenCalledOnce();
    },
  );
});

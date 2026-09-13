import { describe, expect, it, vi } from 'vitest';
import { prepareE2eCatalog } from '../prepare-e2e-catalog';

function env(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/ordinary',
    E2E_DATABASE_URL: 'postgresql://localhost/erp_e2e_test',
    E2E_DATABASE_CONFIRM_DATABASE: 'erp_e2e_test',
  };
}

describe('E2E catalog preparation', () => {
  it.each([
    { E2E_DATABASE_CONFIRM_DATABASE: '' },
    { DATABASE_URL: 'postgresql://localhost/erp_e2e_test' },
    { E2E_DATABASE_URL: 'postgresql://localhost/erp_production', E2E_DATABASE_CONFIRM_DATABASE: 'erp_production' },
  ])('rejects unsafe target %j before opening a connection', async (override) => {
    const load = vi.fn();
    await expect(prepareE2eCatalog({ ...env(), ...override }, load)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it('passes only the validated disposable database to the guarded repair', async () => {
    const values = env();
    const receipt = { applied: true, removed: ['import'], referencesChecked: 8, snapshotsChecked: 33 };
    const repair = vi.fn().mockResolvedValue(receipt);
    const close = vi.fn();
    const load = vi.fn(async () => ({ repair, close }));
    await expect(prepareE2eCatalog(values, load)).resolves.toEqual(receipt);
    expect(values.DATABASE_URL).toBe(values.E2E_DATABASE_URL);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ url: values.E2E_DATABASE_URL }));
    expect(repair).toHaveBeenCalledExactlyOnceWith('erp_e2e_test');
    expect(close).toHaveBeenCalledOnce();
  });

  it('propagates a refused repair and closes the connection', async () => {
    const close = vi.fn();
    await expect(prepareE2eCatalog(env(), async () => ({
      repair: async () => { throw new Error('existing business reference'); }, close,
    }))).rejects.toThrow('existing business reference');
    expect(close).toHaveBeenCalledOnce();
  });
});

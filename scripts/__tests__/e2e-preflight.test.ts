import { describe, expect, it } from 'vitest';
import { assertE2eAdminCredentials } from '../e2e-preflight';

describe('browser credentials are validated before an expensive server build', () => {
  it.each([{}, { SEED_ADMIN_PASSWORD: '' }, { E2E_ADMIN_PASSWORD: '  ', SEED_ADMIN_PASSWORD: 'seed-fixture' }])('rejects missing or empty selected credentials %#', (env) => {
    expect(() => assertE2eAdminCredentials(env)).toThrow('test administrator');
  });
  it.each([{ SEED_ADMIN_PASSWORD: 'seed-fixture' }, { E2E_ADMIN_PASSWORD: 'override-fixture' }])('accepts explicitly supplied test credentials %#', (env) => {
    expect(() => assertE2eAdminCredentials(env)).not.toThrow();
  });
});

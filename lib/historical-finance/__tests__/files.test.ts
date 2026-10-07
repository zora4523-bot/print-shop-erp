import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readHistoricalFinanceFile } from '../files';

let directory: string;
beforeEach(async () => {
  await mkdir('output', { recursive: true });
  directory = await mkdtemp(path.resolve('output/historical-finance-'));
  vi.stubEnv('HISTORICAL_FINANCE_DIR', directory);
  await writeFile(path.join(directory, 'data.js'), 'window.data = { revenue: 198214.60 };');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('private historical finance files', () => {
  it('preserves file bytes and MIME type', async () => {
    const file = await readHistoricalFinanceFile('data.js');
    expect(file?.type).toBe('text/javascript; charset=utf-8');
    expect(new TextDecoder().decode(file?.body)).toBe('window.data = { revenue: 198214.60 };');
  });
  it.each(['../data.js', '/data.js', '.env', 'data.js/../index.html', '%2e%2e%2fdata.js', 'data.json', 'DATA.js'])('refuses unsafe or unsupported names: %s', async name => {
    expect(await readHistoricalFinanceFile(name)).toBeNull();
  });
  it('refuses symbolic links and missing files', async () => {
    await symlink(path.join(directory, 'data.js'), path.join(directory, 'other.js'));
    expect(await readHistoricalFinanceFile('other.js')).toBeNull();
    expect(await readHistoricalFinanceFile('missing.js')).toBeNull();
  });
  it('requires an explicit absolute private directory', async () => {
    vi.stubEnv('HISTORICAL_FINANCE_DIR', 'public');
    await expect(readHistoricalFinanceFile('data.js')).rejects.toThrow('directory unavailable');
  });
});

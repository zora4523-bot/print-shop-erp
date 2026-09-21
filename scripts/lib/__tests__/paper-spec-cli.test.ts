import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cli = 'scripts/maintenance/compare-paper-specs.ts';
function run(script: string, args: string[]) {
  return spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', script, ...args], {
    encoding: 'utf8', timeout: 15_000, env: { ...process.env, E2E_DATABASE_URL: '', E2E_DATABASE_CONFIRM_DATABASE: '',
      DATABASE_URL: 'postgresql://sentinel:never_print_this@127.0.0.1:1/erp_test_offline', DOTENV_CONFIG_PATH: '/dev/null' },
  });
}

describe('paper spec command boundaries without a database', () => {
  it('capture never falls back to DATABASE_URL or prints credentials', () => {
    const result = run(cli, ['--mode', 'capture']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('纸张规格对比失败');
    expect(result.stderr + result.stdout).not.toContain('never_print_this');
  });
  it('comparison exit code blocks exact-price changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paper-spec-cli-'));
    try {
      const before = join(dir, 'before.json'); const after = join(dir, 'after.json');
      const evidence = { format: 1, at: '2026-09-20', casesDigest: 'cases', dataDigest: 'data', catalog: {},
        results: [{ id: 'zero', input: {}, quote: { unitPrice: '0' }, processing: {} }] };
      writeFileSync(before, JSON.stringify(evidence)); writeFileSync(after, JSON.stringify(evidence));
      const args = ['--mode', 'compare', '--before', before, '--after', after];
      expect(run(cli, args).status).toBe(0);
      evidence.results[0]!.quote.unitPrice = '0.0001'; writeFileSync(after, JSON.stringify(evidence));
      const changed = run(cli, args);
      expect(changed.status).toBe(1);
      expect(JSON.parse(changed.stdout)).toEqual({ equal: false, differences: ['results'] });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

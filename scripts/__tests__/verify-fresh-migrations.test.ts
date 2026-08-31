import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = readFileSync(
  path.join(process.cwd(), 'scripts/verify-fresh-migrations.mjs'),
  'utf8',
);
const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as { scripts?: Record<string, string> };

describe('fresh migration replay gate', () => {
  it('requires an explicitly confirmed disposable database', () => {
    expect(script).toContain('process.env.FRESH_DATABASE_URL?.trim()');
    expect(script).toContain('FRESH_DATABASE_CONFIRM_DATABASE');
    expect(script).toContain('FRESH_DATABASE_URL 与当前 DATABASE_URL 指向同一数据库');
    expect(script).toContain('目标不是空库');
    expect(script).not.toMatch(/\b(?:CREATE|DROP)\s+DATABASE\b/iu);
    expect(script).not.toMatch(/migrate\s+reset|db\s+push/iu);
  });

  it('replays every migration and verifies the repaired pricing lineage', () => {
    expect(packageJson.scripts?.['test:migrations:fresh']).toBe(
      'node scripts/verify-fresh-migrations.mjs',
    );
    expect(script).toContain("runPrisma(['migrate', 'deploy'])");
    expect(script).toContain("runPrisma(['migrate', 'status'])");
    expect(script).toContain("createHash('sha256')");
    expect(script).toContain('SHOW server_version_num');
    expect(script).toContain('cpb_external_processing_rule_v4_five_tier');
    expect(script).toContain('cpb_external_processing_truth_repair_v1');
    expect(script).toContain('BASE_STOCK-PEARL-RED-160-LARGE');
    expect(script).toContain('BASE_STOCK-SOFT-TOUCH-200-LARGE');
    expect(script).toContain('BASE_STOCK-SOFT-TOUCH-200-SQUARE');
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260826183000_production_task_disputes',
    'migration.sql',
  ),
  'utf8',
);

describe('production task dispute migration', () => {
  it('enforces one pending record while preserving repeated historical disputes', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProductionTaskDispute_one_pending_per_task_key"',
    );
    expect(migration).toMatch(/WHERE "status" = 'PENDING'/);
    expect(migration).not.toContain('UNIQUE ("productionTaskId")');
  });

  it('blocks physical deletion and terminal-history rewrites', () => {
    expect(migration).toContain(
      'CREATE TRIGGER "ProductionTaskDispute_prevent_delete"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ProductionTaskDispute_protect_history"',
    );
    expect(migration).toContain("IF OLD.\"status\" <> 'PENDING'");
    expect(migration).toMatch(/ON DELETE RESTRICT/g);
  });

  it('requires complete handler evidence for terminal states', () => {
    expect(migration).toContain(
      'CONSTRAINT "ProductionTaskDispute_resolution_check"',
    );
    expect(migration).toContain('"resolvedById" IS NOT NULL');
    expect(migration).toContain('"resolvedAt" IS NOT NULL');
  });
});

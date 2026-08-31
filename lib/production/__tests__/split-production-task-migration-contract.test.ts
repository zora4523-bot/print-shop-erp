import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260826180000_split_production_tasks',
    'migration.sql',
  ),
  'utf8',
);

describe('split production task migration', () => {
  it('replaces pair uniqueness with a lookup index without weakening planned quantity', () => {
    expect(migration).toContain(
      'DROP INDEX IF EXISTS "ProductionTask_orderItemId_craftId_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX IF NOT EXISTS "ProductionTask_orderItemId_craftId_idx"',
    );
    expect(migration).not.toContain('DROP CONSTRAINT');

    const schema = readFileSync(
      path.join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8',
    );
    const model = schema.slice(
      schema.indexOf('model ProductionTask {'),
      schema.indexOf('\n}', schema.indexOf('model ProductionTask {')),
    );
    expect(model).toContain('@@index([orderItemId, craftId])');
    expect(model).not.toContain('@@unique([orderItemId, craftId])');
    expect(model).toContain('plannedQty');
  });
});

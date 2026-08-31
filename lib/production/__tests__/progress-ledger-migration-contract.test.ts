import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20260828112000_production_progress_ledger/migration.sql',
  'utf8',
);

describe('production progress ledger migration contract', () => {
  it('模型只保留无计件进度事实与追加式报工', () => {
    const stepModel = schema.match(
      /model ProductionProgressStep \{([\s\S]*?)\n\}/,
    )?.[1];
    const reportModel = schema.match(
      /model ProductionProgressReport \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(stepModel).toBeDefined();
    expect(reportModel).toBeDefined();
    expect(stepModel).toContain('plannedQty');
    expect(reportModel).toContain('completedQty');
    expect(reportModel).toContain('defectQty');
    expect(reportModel).toContain('reworkQty');
    expect(reportModel).not.toMatch(/rate|amount|priceBook|workerId|machine/iu);
  });

  it('数据库约束数量、幂等与不可变报工', () => {
    expect(migration).toContain(
      'CONSTRAINT "ProductionProgressStep_planned_qty_check"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProductionProgressReport_idempotencyKey_key"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ProductionProgressReport_immutable"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("orderId", "orderItemId") REFERENCES "OrderItem"("orderId", "id")',
    );
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120200_production_work_order_progress_and_scan_claim',
    'migration.sql',
  ),
  'utf8',
);
const candidateIndexMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260902120300_production_stagnation_candidate_index',
    'migration.sql',
  ),
  'utf8',
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`missing model ${name}`);
  return match[1];
}

describe('work-order progress and scanner claim migration contract', () => {
  it('新件数进度与计薪 ProductionReport 隔离但可追溯', () => {
    const progress = model('ProductionWorkOrderProgress');
    expect(progress).toContain(
      'workOrderProgressQuantity Decimal                  @db.Decimal(14, 3)',
    );
    expect(progress).toContain('stage                     ProductionWorkOrderStage');
    expect(progress).toContain('sourceReportId            String');
    expect(progress).not.toMatch(/rate|amount|priceBook|PER_BAG/);
  });

  it('扫码认领只接受新 operation/progress step，不引用旧任务', () => {
    const claim = model('ProductionScanClaim');
    expect(claim).toMatch(/operationId\s+String\?/);
    expect(claim).toMatch(/progressStepId\s+String\?/);
    expect(claim).toMatch(/workOrderVersion\s+Int/);
    expect(claim).toContain('@@unique([orderId, workOrderVersion])');
    expect(claim).not.toMatch(/ProductionTask|taskId/);
    expect(migration).toContain(
      'CHECK (num_nonnulls("operationId", "progressStepId") = 1)',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProductionScanClaim_orderId_workOrderVersion_key"',
    );
    expect(migration).toContain(
      'order_record."workOrderVersion" <> NEW."workOrderVersion"',
    );
  });

  it('数据库也串行硬拒超单量并禁止改删', () => {
    expect(migration).toContain(
      "hashtext('print-shop-erp:order-cascade:' || NEW.\"orderId\")",
    );
    expect(migration).toContain(
      'existing_total + NEW."workOrderProgressQuantity" > order_total',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ProductionWorkOrderProgress_immutable"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "ProductionScanClaim_immutable"',
    );
    expect(migration).toContain('NEW."claimedAt" := db_now');
  });

  it('迁移仅 additive，不回填工资或旧任务数据', () => {
    expect(migration).not.toMatch(
      /DROP\s+(?:TYPE|TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"(?:Order|ProductionReport|ProductionTask)"/i,
    );
    expect(migration).not.toMatch(/FROM\s+"ProductionTask"|PER_BAG/);
  });

  it('停滞候选索引使用独立非事务 concurrent migration', () => {
    expect(candidateIndexMigration).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_production_stagnation_candidate_idx"',
    );
    expect(candidateIndexMigration).toContain(
      'INCLUDE ("orderNo", "workOrderVersion")',
    );
    expect(candidateIndexMigration).not.toMatch(
      /^\s*(?:BEGIN|COMMIT|START\s+TRANSACTION)\s*;/im,
    );
    expect(candidateIndexMigration.match(/;/g)).toHaveLength(1);
  });
});

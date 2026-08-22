import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsRoot = path.join(process.cwd(), 'prisma', 'migrations');
const ledgerMigrationPath = path.join(
  migrationsRoot,
  '20260807170000_order_list_filters_and_exports',
  'migration.sql',
);

const concurrentMigrationNames = [
  '20260807170101_order_created_at_id_index',
  '20260807170102_order_submitter_created_at_id_index',
  '20260807170103_order_status_created_at_id_index',
  '20260807170104_task_worker_status_item_index',
  '20260807170105_task_craft_status_item_index',
  '20260807170106_order_receiver_address_trgm_index',
  '20260807170107_order_item_name_trgm_index',
  '20260807170108_order_item_specification_trgm_index',
  '20260807170109_order_item_paper_type_trgm_index',
  '20260807170110_order_item_crafts_gin_index',
  '20260807170111_order_item_foil_colors_gin_index',
  '20260807170112_shipment_receiver_name_trgm_index',
  '20260807170113_shipment_receiver_phone_trgm_index',
  '20260807170114_shipment_receiver_address_trgm_index',
  '20260807170115_shipment_tracking_no_trgm_index',
  '20260807170116_shipment_express_code_trgm_index',
  '20260807170117_outsource_supplier_name_trgm_index',
  '20260807170118_user_display_name_trgm_index',
] as const;

describe('order list/export migration contract', () => {
  it('builds every existing-table index in its own post-ledger concurrent migration', async () => {
    const entries = await readdir(migrationsRoot, { withFileTypes: true });
    const actualNames = entries
      .filter(
        (entry) =>
          entry.isDirectory() && /^202608071701\d{2}_/.test(entry.name),
      )
      .map((entry) => entry.name)
      .sort();

    expect(actualNames).toEqual([...concurrentMigrationNames]);

    for (const migrationName of concurrentMigrationNames) {
      const sql = await readFile(
        path.join(migrationsRoot, migrationName, 'migration.sql'),
        'utf8',
      );
      expect(sql).toMatch(
        /^CREATE INDEX CONCURRENTLY IF NOT EXISTS "[A-Za-z0-9_]+"\n[\s\S]+;\n$/,
      );
      expect(sql.match(/;/g)).toHaveLength(1);
      expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT)\b/);
    }

    const ledgerSql = await readFile(ledgerMigrationPath, 'utf8');
    const beforeLedger = ledgerSql.slice(
      0,
      ledgerSql.indexOf('CREATE TYPE "OrderExportStatus"'),
    );
    expect(beforeLedger).not.toMatch(/^CREATE INDEX /m);
  });

  it('masks stored filter PII and enumerable hashes down to normalized scope', async () => {
    const sql = await readFile(ledgerMigrationPath, 'utf8');

    expect(sql).toContain("'OrderExport',\n    'filters',\n    'pii'");
    expect(sql).toContain(
      `jsonb_build_object(''scope'', CASE WHEN "filters"->>''scope'' = ''all'' THEN ''all'' ELSE ''filtered'' END)`,
    );
    expect(sql).toContain(
      'masked datasets retain only normalized scope because deterministic hashes of enumerable filters are searchable',
    );
    const maskExpression = sql.slice(
      sql.indexOf("'OrderExport',\n    'filters',\n    'pii'"),
      sql.indexOf("'READ_WRITE',\n    39"),
    );
    expect(maskExpression).not.toContain('filterHash');
  });

  it('registers both missing cron candidates without overriding operator enablement', async () => {
    const sql = await readFile(ledgerMigrationPath, 'utf8');
    const cronUpsert = sql.slice(
      sql.indexOf('INSERT INTO app_ops.cron_http_job_candidate'),
      sql.indexOf('-- Keep the operational readiness contract'),
    );

    expect(cronUpsert).toContain("'erp-order-export-cleanup'");
    expect(cronUpsert).toContain("'/api/cron/order-export-cleanup'");
    expect(cronUpsert).toContain("'15 2 * * *'");
    expect(cronUpsert).toContain('the durable worker result exposes counts only');
    expect(cronUpsert).toContain("'erp-order-overdue'");
    expect(cronUpsert).toContain("'/api/cron/order-overdue'");
    expect(cronUpsert).toContain("'20 8 * * *'");
    expect(cronUpsert).not.toContain('is_enabled = EXCLUDED.is_enabled');
  });

  it('keeps the readiness probe aligned with AND and same-child query semantics', async () => {
    const sql = await readFile(ledgerMigrationPath, 'utf8');
    const requiredIndexes = sql.slice(
      sql.indexOf('required_indexes = ARRAY['),
      sql.indexOf('optional_indexes = ARRAY['),
    );
    const explainSql = sql.slice(
      sql.indexOf('explain_sql = $$'),
      sql.indexOf("rationale = '探针忠实复制 buildOrderWhere"),
    );

    expect(requiredIndexes).toContain(
      'public."ProductionTask_workerId_status_orderItemId_idx"',
    );
    expect(requiredIndexes).toContain('public."OrderItem_orderId_idx"');
    expect(requiredIndexes).toContain(
      'public."OrderShipment_orderId_status_idx"',
    );
    expect(requiredIndexes).toContain('public."OutsourceOrder_orderId_idx"');
    expect(requiredIndexes).not.toContain(
      'public."ProductionTask_craftId_status_orderItemId_idx"',
    );

    expect(explainSql).toContain('FROM public."User" AS submitter');
    expect(explainSql).toContain('FROM public."OrderShipment" AS qs');
    expect(explainSql).toContain('FROM public."Product" AS qp');
    expect(explainSql).toContain('FROM public."ProductionTask" AS qt');
    expect(explainSql).toContain('AND EXISTS (\n    SELECT 1\n    FROM public."OrderShipment" AS fs');
    expect(explainSql).toContain('AND EXISTS (\n    SELECT 1\n    FROM public."OrderItem" AS fi');
    expect(explainSql).toContain('AND EXISTS (\n    SELECT 1\n    FROM public."OutsourceOrder" AS fo');
    expect(explainSql).toContain(
      'ft."workerId" = \'worker-id\'\n          AND ft."status" IN',
    );
    expect(explainSql).not.toContain(
      't."workerId" = \'worker-id\' OR\n          t."craftId"',
    );
  });

  it('treats unfinished concurrent indexes as readiness blockers', async () => {
    const sql = await readFile(ledgerMigrationPath, 'utf8');

    expect(sql).toContain('required_index_missing_or_invalid:');
    expect(sql.match(/pi\.indisready/g)).toHaveLength(2);
    expect(sql.match(/pi\.indisvalid/g)).toHaveLength(2);
    expect(sql.match(/pi\.indislive/g)).toHaveLength(2);
  });
});

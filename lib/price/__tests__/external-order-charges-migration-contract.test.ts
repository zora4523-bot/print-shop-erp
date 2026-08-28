import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260808100000_external_sales_logistics_charges',
    'migration.sql',
  ),
  'utf8',
);
const schema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const priceSnapshotReader = readFileSync(
  path.join(process.cwd(), 'lib', 'order', 'create-order-price-snapshot.ts'),
  'utf8',
);

describe('external-sales logistics charge migration contract', () => {
  it('is one guarded forward transaction and versions price books by purpose', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain(
      "hashtext('print-shop-erp:price-rule-snapshot:v1')",
    );
    expect(migration).toContain('CREATE TYPE "CustomerPriceBookPurpose"');
    expect(migration).toContain(
      '"CustomerPriceBook_active_settlement_purpose_window_no_overlap"',
    );
    expect(migration).toContain(
      'CREATE INDEX "CustomerPriceBook_settlementType_purpose_isActive_effective_idx"',
    );
    expect(migration).not.toContain(
      'CustomerPriceBook_settlementType_purpose_isActive_effectiveFrom_idx',
    );
    expect(schema).toContain('purpose        CustomerPriceBookPurpose');
    expect(priceSnapshotReader).toContain(
      'CustomerPriceBookPurpose.PROCESSING',
    );
  });

  it('keeps customer receivables separate from internal order costs', () => {
    expect(schema).toContain('model OrderCustomerCharge {');
    expect(schema).toContain('customerCharges OrderCustomerCharge[]');
    expect(schema).toContain('processingAmount');
    expect(migration).toContain('CREATE TABLE "OrderCustomerCharge"');
    expect(migration).not.toMatch(
      /INSERT INTO "OrderCostEntry"[\s\S]+(?:SHIPPING_FEE|PACKING_MATERIAL)/,
    );
  });

  it('imports the two exact workbook revisions and all reviewed groups', () => {
    expect(migration).toContain(
      'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060',
    );
    expect(migration).toContain(
      '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b',
    );
    for (const code of [
      'ZTO_GUANGDONG',
      'ZTO_STANDARD_2_8',
      'ZTO_STANDARD_3_5',
      'ZTO_STANDARD_4_5',
      'ZTO_REMOTE_FIRST_12',
      'ZTO_REMOTE_FIRST_10',
      'CARTON_Q1_500',
      'CARTON_Q501_1000',
      'CARTON_Q1001_2000',
      'CARTON_Q2001_3000',
      'CARTON_Q3001_5000',
    ]) {
      expect(migration).toContain(`'${code}'`);
    }
  });

  it('does not invent raw-weight rounding or a carton rule above 5000', () => {
    expect(migration).toContain('承运商已进位的计费重量');
    expect(migration).not.toMatch(/\bceil\s*\(/i);
    expect(migration).toContain('纸箱表没有 5000 个以上规则');
    expect(migration).not.toMatch(/CARTON_[^\n]+5001/);
  });

  it('preserves historical totals while making missing legacy evidence explicit', () => {
    expect(migration).toContain(
      'UPDATE "Order"\nSET "processingAmount" = "totalAmount";',
    );
    expect(migration).toContain('occ_legacy_shipping_');
    expect(migration).toContain('occ_legacy_packing_');
    expect(migration).toContain('未从地址或重量臆测费用');
    expect(migration).toContain('未从数量臆测纸箱计费粒度');
    expect(migration).toMatch(
      /LOCK TABLE[\s\S]*"OrderShipment",\s*"OrderShipmentLine",/,
    );
  });

  it('normalizes legacy zero sentinels before positive charge constraints', () => {
    expect(migration).toMatch(
      /UPDATE "OrderShipment"\s+SET "weightKg" = NULL\s+WHERE "weightKg" = 0;/,
    );
    expect(migration).toMatch(
      /CASE\s+WHEN COUNT\(\*\) > 0\s+AND bool_and\(line\."quantity" > 0\)\s+AND SUM\(line\."quantity"\) <= 999999999\s+THEN SUM\(line\."quantity"\)::DECIMAL\(12,3\)\s+ELSE NULL\s+END AS "itemQuantity"/,
    );
  });
});

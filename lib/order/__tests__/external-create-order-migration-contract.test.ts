import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = process.cwd();
const schema = readFileSync(
  path.join(workspace, 'prisma', 'schema.prisma'),
  'utf8',
);
const expandMigration = readFileSync(
  path.join(
    workspace,
    'prisma',
    'migrations',
    '20260828100000_create_order_c_expand',
    'migration.sql',
  ),
  'utf8',
);
const backfillMigration = readFileSync(
  path.join(
    workspace,
    'prisma',
    'migrations',
    '20260828101000_create_order_c_backfill',
    'migration.sql',
  ),
  'utf8',
);
const externalDraftRevisionMigration = readFileSync(
  path.join(
    workspace,
    'prisma',
    'migrations',
    '20260828102000_external_draft_price_revision_zero',
    'migration.sql',
  ),
  'utf8',
);

const combinedMigration = `${expandMigration}\n${backfillMigration}`;

describe('external create-order schema and migration contract', () => {
  it('仅允许尚未锁价的外部销售 DRAFT 以 priceRevision=0 开始', () => {
    expect(externalDraftRevisionMigration.trimStart()).toMatch(/^BEGIN;/u);
    expect(externalDraftRevisionMigration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(externalDraftRevisionMigration).toContain(
      'DROP CONSTRAINT "Order_priceRevision_check"',
    );
    expect(externalDraftRevisionMigration).toMatch(
      /"priceRevision"\s*=\s*0[\s\S]*"settlementType"\s*=\s*'EXTERNAL_SALES'[\s\S]*"status"\s*=\s*'DRAFT'[\s\S]*"quotedPricingRevisionId"\s+IS\s+NULL/u,
    );
  });

  it('expands the legacy status model without removing old states', () => {
    expect(expandMigration.trimStart()).toMatch(/^BEGIN;/u);
    expect(expandMigration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(backfillMigration.trimStart()).toMatch(/^BEGIN;/u);
    expect(backfillMigration.trimEnd()).toMatch(/COMMIT;$/u);

    expect(expandMigration).toMatch(
      /ALTER TYPE "OrderStatus"\s+ADD VALUE IF NOT EXISTS 'PENDING_FACTORY' AFTER 'DRAFT'/u,
    );
    for (const status of [
      'DRAFT',
      'SUBMITTED',
      'SCHEDULING',
      'IN_PRODUCTION',
      'COMPLETED',
      'SHIPPED',
      'FINISHED',
      'CANCELLED',
    ]) {
      expect(schema).toMatch(
        new RegExp(`enum OrderStatus \\{[\\s\\S]*?\\b${status}\\b`, 'u'),
      );
    }
    expect(schema).toMatch(
      /enum OrderStatus \{[\s\S]*?\bPENDING_FACTORY\b/u,
    );
    expect(schema).toContain('enum OrderItemPricingRoute {');
  });

  it('adds canonical craft, stable fig, pack, quote, and idempotency facts additively', () => {
    expect(schema).toMatch(
      /enum OrderCraft \{\s+PARTIAL\s+FULL\s+PRINT\s+\}/u,
    );
    expect(schema).toMatch(/nextItemFig\s+Int\s+@default\(1\)/u);
    expect(schema).toMatch(/clientSubmissionId\s+String\?\s+@unique/u);
    expect(schema).toMatch(/fig\s+Int\?/u);
    expect(schema).toMatch(/craft\s+OrderCraft\?/u);
    expect(schema).toMatch(/pack\s+Int\?/u);
    expect(schema).toMatch(
      /quoteDisposition\s+OrderItemQuoteDisposition\?/u,
    );
    expect(schema).toMatch(
      /quotedAmount\s+Decimal\?\s+@db\.Decimal\(12, 2\)/u,
    );
    expect(schema).toContain('@@unique([orderId, fig])');

    expect(expandMigration).not.toMatch(
      /DROP\s+(?:COLUMN|TABLE|TYPE)\b/iu,
    );
    expect(backfillMigration).not.toMatch(
      /DROP\s+(?:COLUMN|TABLE|TYPE)\b/iu,
    );
    expect(combinedMigration).not.toMatch(
      /^\s*(?:DELETE\s+FROM|TRUNCATE\s+TABLE)\b/imu,
    );
  });

  it('keeps quoted, confirmed, and settled fees independent and snapshot-qualified', () => {
    expect(schema).toMatch(
      /enum OrderQuotedFeeCompleteness \{\s+COMPLETE\s+EXCLUDES_MANUAL_ITEMS\s+\}/u,
    );
    for (const field of ['quotedFee', 'confirmedFee', 'settledFee']) {
      expect(schema).toMatch(
        new RegExp(`${field}\\s+Decimal\\?\\s+@db\\.Decimal\\(12, 2\\)`, 'u'),
      );
    }
    expect(schema).toMatch(
      /quotedFeeCompleteness\s+OrderQuotedFeeCompleteness\?/u,
    );
    expect(schema).toMatch(/quotedPricingRevisionId\s+String\?/u);
    expect(expandMigration).toContain(
      'CONSTRAINT "Order_quotedPricingRevisionId_fkey"',
    );
    expect(backfillMigration).toContain(
      'Order.quotedPricingRevisionId must reference a revision of the same order',
    );

    // No uncertain historical fee or current price book is fabricated.
    expect(backfillMigration).not.toContain('SET "quotedFee"');
    expect(backfillMigration).not.toContain('SET "confirmedFee"');
    expect(backfillMigration).not.toContain('SET "settledFee"');
    expect(backfillMigration).not.toMatch(/UPDATE\s+"CustomerPriceBook"/u);
  });

  it('locks both independent price-book purposes per immutable pricing revision', () => {
    expect(schema).toContain('model OrderPriceVersionLock {');
    expect(schema).toMatch(
      /purpose\s+CustomerPriceBookPurpose/u,
    );
    expect(schema).toMatch(/priceBookVersion\s+Int/u);
    expect(schema).toMatch(/sourceSha256\s+String\s+@db\.VarChar\(64\)/u);
    expect(schema).toContain('@@unique([pricingRevisionId, purpose])');
    expect(expandMigration).toContain(
      'CREATE UNIQUE INDEX "OrderPriceVersionLock_pricingRevisionId_purpose_key"',
    );
    expect(expandMigration).toContain(
      'CREATE TRIGGER "OrderPriceVersionLock_immutable"',
    );
    expect(expandMigration).toContain(
      "RAISE EXCEPTION 'OrderPriceVersionLock rows are immutable'",
    );
    expect(backfillMigration).toContain(
      'CREATE TRIGGER "OrderPriceVersionLock_snapshot_match"',
    );
    expect(backfillMigration).toContain(
      'OrderPriceVersionLock must match referenced CustomerPriceBook evidence',
    );
  });

  it('backfills only deterministic item facts and never invents a MANUAL_QUOTE craft', () => {
    expect(backfillMigration).toMatch(
      /UPDATE "OrderItem"\s+SET "fig" = "sequence"\s+WHERE "fig" IS NULL;/u,
    );
    expect(backfillMigration).toContain(
      "WHEN 'STOCK_BLANK'::\"OrderItemPricingRoute\"",
    );
    expect(backfillMigration).toContain("THEN 'PARTIAL'::\"OrderCraft\"");
    expect(backfillMigration).toContain(
      "WHEN 'CUSTOM_SINGLE_FLAT_FOIL'::\"OrderItemPricingRoute\"",
    );
    expect(backfillMigration).toContain("THEN 'FULL'::\"OrderCraft\"");
    expect(backfillMigration).toContain(
      "WHEN 'COLOR_PRINT'::\"OrderItemPricingRoute\"",
    );
    expect(backfillMigration).toContain("THEN 'PRINT'::\"OrderCraft\"");
    expect(backfillMigration).not.toMatch(
      /WHEN\s+'MANUAL_QUOTE'[\s\S]{0,120}THEN/iu,
    );

    expect(backfillMigration).toContain('HAVING COUNT(*) = 1');
    expect(backfillMigration).toContain(
      'MIN(line."unitsPerBag") = MAX(line."unitsPerBag")',
    );
    expect(backfillMigration).toContain(
      'AND MIN(line."unitsPerBag") > 0',
    );
    expect(backfillMigration).toMatch(
      /SET "nextItemFig" = COALESCE\([\s\S]*MAX\(item\."fig"\) \+ 1[\s\S]*,\s+1\s+\);/u,
    );
  });

  it('adds configuration metadata without guessing product-paper mappings', () => {
    expect(schema).toMatch(/paperMaterialId\s+String\?/u);
    expect(schema).toMatch(/weight\s+Int\?/u);
    expect(schema).toMatch(
      /paperMaterial\s+Material\?\s+@relation\("ProductPaperMaterial"/u,
    );
    expect(schema).toMatch(/outOfStock\s+Boolean\s+@default\(false\)/u);
    expect(schema).toMatch(/displayColor\s+String\?/u);
    expect(schema).toMatch(/sortOrder\s+Int\s+@default\(0\)/u);
    expect(backfillMigration).not.toMatch(/UPDATE\s+"Product"/u);
    expect(backfillMigration).not.toMatch(/UPDATE\s+"Material"/u);
  });

  it('represents an unknown plate fee as pending with a null amount', () => {
    expect(schema).toMatch(
      /enum OrderCustomerChargeStatus \{[\s\S]*?\bPENDING_AMOUNT\b/u,
    );
    expect(schema).toMatch(
      /model OrderCustomerCharge \{[\s\S]*?amount\s+Decimal\?/u,
    );
    expect(expandMigration).toContain(
      'ALTER COLUMN "amount" DROP NOT NULL',
    );
    expect(backfillMigration).toContain(
      '"status" = \'PENDING_AMOUNT\'::"OrderCustomerChargeStatus"',
    );
    expect(backfillMigration).toContain('AND "amount" IS NULL');
    expect(backfillMigration).toContain(
      'VALIDATE CONSTRAINT "OrderCustomerCharge_status_amount_shape_check"',
    );
  });
});

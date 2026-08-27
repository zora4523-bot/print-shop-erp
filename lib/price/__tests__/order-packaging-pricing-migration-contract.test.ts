import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const enumMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260826160000_customer_price_per_bag/migration.sql',
  ),
  'utf8',
);
const structureMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260826161000_order_packaging_pricing/migration.sql',
  ),
  'utf8',
);
const renameMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260826162000_rename_packaging_fee_rules/migration.sql',
  ),
  'utf8',
);
const structuredReleaseMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma/migrations/20260826170000_rule_center_domain_consolidation/migration.sql',
  ),
  'utf8',
);

describe('order packaging pricing migration contract', () => {
  it('先单独提交 PER_BAG 枚举，再在后续事务中使用', () => {
    expect(enumMigration).toContain(
      `ALTER TYPE "CustomerPriceCalculationType" ADD VALUE IF NOT EXISTS 'PER_BAG'`,
    );
    expect(enumMigration).not.toContain('BEGIN;');
    expect(structureMigration.trimStart()).toMatch(/^BEGIN;/);
    expect(structureMigration.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('增加订单入袋小计和包装组价格快照字段', () => {
    expect(structureMigration).toContain(
      'ADD COLUMN "packagingAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0',
    );
    for (const field of [
      'unitPrice',
      'subtotal',
      'suggestedSubtotal',
      'pricingSnapshot',
      'priceOverrideReason',
    ]) {
      expect(structureMigration).toContain(`ADD COLUMN "${field}"`);
    }
    expect(structureMigration).toContain(
      'OrderPackagingGroup_pricing_snapshot_object_check',
    );
  });

  it('建表迁移不原地改写已发布价目规则', () => {
    expect(structureMigration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/i);
    expect(renameMigration).not.toMatch(/UPDATE\s+"CustomerPriceRule"/i);
    expect(structureMigration).toContain(
      'Do not rewrite published price-book rules',
    );
  });

  it('仅在 next_book_id 克隆中将两条入袋规则升级为按袋', () => {
    const packagingBlock = structuredReleaseMigration.slice(
      structuredReleaseMigration.indexOf(
        '-- The confirmed 0.1 / 0.2 rates apply to packaging-group bag counts',
      ),
      structuredReleaseMigration.indexOf(
        '-- Keep the old warning for audit',
      ),
    );
    expect(packagingBlock).toContain(
      'WHERE rule."priceBookId" = next_book_id',
    );
    expect(packagingBlock).toContain('REF_PACKING_SINGLE_ITEM');
    expect(packagingBlock).toContain('REF_PACKING_MIXED_ITEMS');
    expect(packagingBlock).toContain(
      `'ADD_ON'::"CustomerPriceRuleKind"`,
    );
    expect(packagingBlock).toContain(
      `'PER_BAG'::"CustomerPriceCalculationType"`,
    );
    expect(packagingBlock).toContain(
      '"target":"PACKAGING_GROUP","packagingModes":["SINGLE_STYLE"]',
    );
    expect(packagingBlock).toContain(
      '"target":"PACKAGING_GROUP","packagingModes":["MIXED_STYLE"]',
    );
    expect(packagingBlock).toContain(
      '"exclusiveGroup" = \'PACKAGING_GROUP_MODE\'',
    );
    expect(packagingBlock).not.toMatch(/"amount"\s*=/);
  });

  it('不回写任何历史价格修订快照', () => {
    expect(structureMigration).not.toMatch(
      /(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+"OrderPricingRevision"/i,
    );
  });

  it('克隆后的自动按袋费使用业务名称', () => {
    expect(structuredReleaseMigration).toContain("THEN '单款装入袋费'");
    expect(structuredReleaseMigration).toContain("THEN '混装入袋费'");
    expect(structuredReleaseMigration).toContain(
      '"calculationType" = \'PER_BAG\'::"CustomerPriceCalculationType"',
    );
    expect(structuredReleaseMigration).toContain(
      'Cloned price book is missing the two structured packaging-group rules',
    );
  });
});

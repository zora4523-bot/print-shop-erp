import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807185000_external_sales_price_book',
    'migration.sql',
  ),
  'utf8',
);
const prismaSchema = readFileSync(
  path.join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);
const safetyMigration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260807185100_external_sales_quote_safety_guards',
    'migration.sql',
  ),
  'utf8',
);

const importedRuleRows = migration.match(
  /^\s+\('cpr_ext_202608_[^\n]+$/gm,
) ?? [];
const importedProducts = [
  ...migration.matchAll(
    /^\s+\('prd_ext_[^']*', '([^']+)', '[^']+', '[^']+', '[^']+', '([^']+)', '([^']+)'\),?$/gm,
  ),
].map((match) => ({
  code: match[1],
  specification: match[2],
  paperType: match[3],
}));
const baseConditions = new Map(
  [...migration.matchAll(/^\s+\('(EXT-[^']+)', '(\{[^\n]+\})'\),?$/gm)].map(
    (match) => [
      match[1],
      JSON.parse(match[2]) as {
        productCodes: string[];
        specifications: string[];
        paperTypes: string[];
      },
    ],
  ),
);

describe('external-sales customer price-book migration contract', () => {
  it('is one forward transaction and locks the source product dictionary before importing', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration.indexOf('LOCK TABLE')).toBeGreaterThan(
      migration.indexOf('BEGIN;'),
    );
    expect(migration).toContain(
      'LOCK TABLE "ProductCategoryNode", "Product" IN SHARE ROW EXCLUSIVE MODE;',
    );
  });

  it('models price-book scope, charge categories and typed rules in Prisma', () => {
    for (const model of [
      'model CustomerPriceBook {',
      'model CustomerChargeCategory {',
      'model CustomerPriceRule {',
    ]) {
      expect(prismaSchema).toContain(model);
    }
    expect(prismaSchema).toContain('enum CustomerPriceRuleKind {');
    expect(prismaSchema).toContain('enum CustomerPriceCalculationType {');
    expect(prismaSchema).toContain(
      'settlementType OrderSettlementType',
    );
    expect(prismaSchema).toMatch(
      /blocksAutomaticQuote\s+Boolean\s+@default\(false\)/,
    );
    expect(prismaSchema).toContain('@@unique([priceBookId, code])');
  });

  it('enforces active-book and active-BASE quantity non-overlap in PostgreSQL', () => {
    expect(migration).toContain(
      'CONSTRAINT "CustomerPriceBook_active_settlement_window_no_overlap"',
    );
    expect(migration).toContain(
      'CONSTRAINT "CustomerPriceRule_active_base_quantity_no_overlap"',
    );
    expect(migration).toContain('WHERE ("isActive")');
    expect(migration).toContain(
      'WHERE ("isActive" AND "kind" = \'BASE\'::"CustomerPriceRuleKind")',
    );
    expect(migration).toContain('"minQty" <= "maxQty"');
    expect(migration).toContain(
      'NOT "blocksAutomaticQuote" OR',
    );
    expect(migration).toContain(
      '"kind" = \'REFERENCE\'::"CustomerPriceRuleKind"',
    );
  });

  it('imports exactly the reviewed workbook revision through idempotent keys', () => {
    expect(migration).toContain('EXTERNAL_SALES_PROCESSING_202608');
    expect(migration).toContain("'EXTERNAL_SALES'");
    expect(migration).toContain('长昆-线下报价表(3)(1).xlsx');
    expect(migration).toContain(
      '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733',
    );
    expect(migration).toContain(
      'ON CONFLICT ("code", "version") DO UPDATE SET',
    );
    expect(migration).toContain('ON CONFLICT ("code") DO UPDATE SET');
    expect(migration).toContain(
      'ON CONFLICT ("priceBookId", "code") DO UPDATE SET',
    );
  });

  it('imports the audited 111-rule split without activating ambiguous references as charges', () => {
    expect(importedRuleRows).toHaveLength(111);
    expect(importedRuleRows.filter((row) => row.includes(", 'BASE',"))).toHaveLength(
      75,
    );
    expect(
      importedRuleRows.filter((row) => row.includes(", 'ADD_ON',")),
    ).toHaveLength(18);
    expect(
      importedRuleRows.filter((row) => row.includes(", 'REFERENCE',")),
    ).toHaveLength(18);

    const ids = importedRuleRows.map((row) => row.match(/\('([^']+)'/)?.[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps custom-foil and color-print BASE prices at exact source anchors', () => {
    expect(migration).toContain(
      "'BASE_CUSTOM_MID_Q500', '专版单色平烫 中号/方形 500个锚点', 'BASE', 'PER_PIECE', '0.4800', 500, 500",
    );
    expect(migration).toContain(
      "'BASE_CUSTOM_LARGE_Q50000', '专版单色平烫 大号 50000个锚点', 'BASE', 'PER_PIECE', '0.1800', 50000, 50000",
    );
    expect(migration).toContain(
      "'BASE_COLOR_200_COATED_LARGE_Q100', '200克双铜纸彩印 大号 100个固定总额', 'BASE', 'FIXED_AMOUNT', '130.0000', 100, 100",
    );
    expect(migration).toContain(
      "'BASE_COLOR_160_ICE_LARGE_Q20000', '160克冰白纸彩印 大号 20000个固定总额', 'BASE', 'FIXED_AMOUNT', '3200.0000', 20000, 20000",
    );
    expect(migration).toContain(
      "'BASE_COLOR_200_COATED_MID_Q500', '200克双铜纸彩印 中号 500个固定总额', 'BASE', 'FIXED_AMOUNT', '210.0000', 500, 500",
    );
    expect(migration).toContain(
      "'BASE_STOCK_A06', '空封现货基础价（A6:C6）', 'BASE', 'PER_PIECE', '0.1300', 1, 9999999",
    );
    expect(migration).toContain(
      "'BASE_STOCK_A16_230', '空封现货基础价（A16:C16）', 'BASE', 'PER_PIECE', '0.4200', 1, 9999999",
    );

    expect(migration).not.toMatch(/BASE_(?:CUSTOM|COLOR)_[^\n]+, 7001, 7999/);
    expect(migration).not.toMatch(/BASE_(?:CUSTOM|COLOR)_[^\n]+, 15000, 15000/);
    expect(migration).toContain('REF_COLOR_ICEWHITE_UNKNOWN_SPEC_A10');
  });

  it('binds every imported BASE product to its exact default facts and reviewed UI aliases', () => {
    expect(importedProducts).toHaveLength(22);
    expect(baseConditions.size).toBe(22);

    for (const product of importedProducts) {
      const condition = baseConditions.get(product.code);

      expect(condition, product.code).toBeDefined();
      expect(condition?.productCodes, product.code).toContain(product.code);
      expect(condition?.specifications, product.code).toContain(
        product.specification,
      );
      expect(condition?.paperTypes, product.code).toContain(product.paperType);
    }

    expect(baseConditions.get('EXT-CUSTOM-FOIL-MID-SQUARE')).toMatchObject({
      specifications: expect.arrayContaining(['中号', '方形']),
      paperTypes: expect.arrayContaining([
        '艳红珠光纸',
        '暗红珠光纸',
        '紫色珠光纸',
        '黄色珠光纸',
        '米金珠光纸',
        '酒红',
        '玫红',
        '粉色',
        '红卡纸',
        '金葱纸',
        '莱尼纹',
        '触感纸',
      ]),
    });
    expect(baseConditions.get('EXT-CUSTOM-FOIL-LARGE')).toMatchObject({
      specifications: expect.arrayContaining(['大号', '大号西封']),
    });
    expect(baseConditions.get('EXT-STOCK-FOIL-A05')).toMatchObject({
      paperTypes: expect.arrayContaining([
        '艳红珠光纸',
        '暗红珠光纸',
        '红卡纸',
      ]),
    });
    expect(baseConditions.get('EXT-COLOR-200-COATED-LARGE')).toMatchObject({
      paperTypes: expect.arrayContaining(['铜版纸']),
    });
    expect(baseConditions.get('EXT-COLOR-160-ICE-LARGE')).toMatchObject({
      paperTypes: expect.arrayContaining(['冰白纸']),
    });

    expect(migration).not.toContain('INSERT INTO "PriceTier"');
    expect(migration).toContain(
      '-- PriceTier stay empty so the old quote engine cannot silently apply a partial',
    );
  });

  it('stores only unambiguous add-ons as ADD_ON and fail-closes expressible ambiguity', () => {
    for (const code of [
      'ADDON_CUSTOM_EMBOSS_PIECE',
      'ADDON_CUSTOM_EMBOSS_SETUP',
      'ADDON_CUSTOM_WESTERN_ENVELOPE',
      'ADDON_CUSTOM_DOUBLE_COLOR',
      'ADDON_CUSTOM_PAPER_LINEN_150',
      'ADDON_COLOR_SINGLE_FOIL_Q20000',
    ]) {
      const row = importedRuleRows.find((candidate) => candidate.includes(`'${code}'`));
      expect(row).toBeDefined();
      expect(row).toContain(", 'ADD_ON',");
    }

    for (const code of [
      'REF_MACHINE_FOIL_AMBIGUOUS',
      'REF_COLOR_MULTI_FOIL_CONSULT',
      'REF_CUSTOM_THREE_PLUS_COLORS',
      'REF_COLOR_PRINT_FOIL_COLOR_REQUIRED',
      'REF_PACKING_SINGLE_ITEM',
      'REF_PACKING_MIXED_ITEMS',
    ]) {
      const row = importedRuleRows.find((candidate) => candidate.includes(`'${code}'`));
      expect(row).toBeDefined();
      expect(row).toContain(", 'REFERENCE',");
      expect(row?.trimEnd()).toMatch(/TRUE\),?$/);
    }

    expect(
      importedRuleRows.find((row) =>
        row.includes("'ADDON_CUSTOM_DOUBLE_COLOR'"),
      ),
    ).toContain('"foilColorCount":2');
    expect(
      importedRuleRows.find((row) =>
        row.includes("'REF_CUSTOM_THREE_PLUS_COLORS'"),
      ),
    ).toContain('"minFoilColorCount":3');
    expect(
      importedRuleRows.find((row) =>
        row.includes("'REF_COLOR_MULTI_FOIL_CONSULT'"),
      ),
    ).toContain('"minFoilColorCount":2');
    expect(
      importedRuleRows.find((row) =>
        row.includes("'REF_COLOR_PRINT_FOIL_COLOR_REQUIRED'"),
      ),
    ).toContain('"foilColorCount":0');
    expect(
      importedRuleRows.filter((row) =>
        row.includes('ADDON_COLOR_SINGLE_FOIL_Q'),
      ),
    ).toHaveLength(8);
    for (const row of importedRuleRows.filter((candidate) =>
      candidate.includes('ADDON_COLOR_SINGLE_FOIL_Q'),
    )) {
      expect(row).toContain('"foilColorCount":1');
    }

    const paperAliasCases = [
      [
        'ADDON_CUSTOM_PAPER_VARIEGATED_PEARL_160',
        [
          '暗红珠光纸',
          '紫色珠光纸',
          '黄色珠光纸',
          '米金珠光纸',
          '酒红',
          '玫红',
          '粉色',
        ],
      ],
      ['ADDON_CUSTOM_PAPER_LINEN_150', ['莱尼纹']],
      ['ADDON_CUSTOM_PAPER_GOLD_GLITTER_230', ['金葱纸']],
      ['ADDON_CUSTOM_PAPER_SOFT_TOUCH_200', ['触感纸']],
    ] as const;

    for (const [code, aliases] of paperAliasCases) {
      const row = importedRuleRows.find((candidate) =>
        candidate.includes(`'${code}'`),
      );

      expect(row, code).toBeDefined();
      for (const alias of aliases) {
        expect(row, `${code}: ${alias}`).toContain(`"${alias}"`);
      }
    }

    const redCard180 = importedRuleRows.find((row) =>
      row.includes("'ADDON_CUSTOM_PAPER_RED_CARD_180'"),
    );
    const redCard230 = importedRuleRows.find((row) =>
      row.includes("'ADDON_CUSTOM_PAPER_RED_CARD_230'"),
    );
    expect(redCard180).toContain('"paperTypes":["180g红卡"]');
    expect(redCard230).toContain('"paperTypes":["230g红卡"]');
    expect(redCard180).not.toContain('红卡纸');
    expect(redCard230).not.toContain('红卡纸');
  });

  it('preserves sample and exclusion lines as references, never automatic charges', () => {
    for (const code of [
      'REF_CUSTOM_EXCLUSIONS',
      'REF_SAMPLE_SMALL_MACHINE_SINGLE_SIDE',
      'REF_SAMPLE_SMALL_MACHINE_DOUBLE_SIDE',
      'REF_SAMPLE_WINDMILL_SINGLE_COLOR',
      'REF_SAMPLE_WINDMILL_DOUBLE_COLOR',
      'REF_SAMPLE_DIE_CUT',
      'REF_SAMPLE_UV',
      'REF_SAMPLE_WESTERN_GLUING',
    ]) {
      const row = importedRuleRows.find((candidate) => candidate.includes(`'${code}'`));
      expect(row).toBeDefined();
      expect(row).toContain(", 'REFERENCE',");
    }
    expect(migration).toContain('打样参考');
    expect(migration).toContain('不含制烫金版费、快递费和入袋费');
  });
});

describe('external-sales quote safety-guard migration contract', () => {
  it('is transactionally fenced to the exact audited workbook revision', () => {
    expect(safetyMigration.trimStart()).toMatch(/^BEGIN;/);
    expect(safetyMigration.trimEnd()).toMatch(/COMMIT;$/);
    expect(safetyMigration).toContain(
      "hashtext('print-shop-erp:price-rule-snapshot:v1')",
    );
    expect(safetyMigration).toContain('EXTERNAL_SALES_PROCESSING_202608');
    expect(safetyMigration).toContain("'EXTERNAL_SALES'::\"OrderSettlementType\"");
    expect(safetyMigration).toContain(
      '9e9185881123235062d6921169fa9e8c93152d565ef9529553927d1f85fd4733',
    );
    expect(safetyMigration).toContain(
      'External-sales quote safety migration requires the audited 2026-08 workbook price book',
    );
  });

  it('stores warnings on the price-book version instead of hard-coding this workbook in the UI', () => {
    expect(prismaSchema).toMatch(/notes\s+Json\?/);
    expect(safetyMigration).toContain(
      'ALTER COLUMN "notes" TYPE JSONB',
    );
    expect(safetyMigration).toContain(
      "'warnings', jsonb_build_array(",
    );
    expect(safetyMigration).toContain(
      '彩印 7001–7999 个没有覆盖，15000 个同时落入两条不同口径',
    );
  });

  it('persists every reviewed undercharge guard as a blocking reference', () => {
    for (const code of [
      'GUARD_COLOR_SINGLE_FOIL_LOW_QTY',
      'GUARD_CUSTOM_FOIL_COLOR_REQUIRED',
      'GUARD_COATED_COLOR_PRINT_PROCESS_REQUIRED',
      'GUARD_COATED_UNSUPPORTED_CRAFT',
    ]) {
      expect(safetyMigration).toContain(`'${code}'`);
    }

    expect(safetyMigration).toContain("'REFERENCE'::\"CustomerPriceRuleKind\"");
    expect(safetyMigration).toMatch(/source\."note",\s+TRUE,\s+TRUE,/);
    expect(safetyMigration).toContain('"blocksAutomaticQuote" = TRUE');
  });

  it('covers low-quantity foil, missing foil color and STOCK_FOIL without inventing prices', () => {
    expect(safetyMigration).toContain(
      `'GUARD_COLOR_SINGLE_FOIL_LOW_QTY',\n      '彩印单色烫金 500 个以下未定价',\n      1,\n      499`,
    );
    expect(safetyMigration).toContain(
      '"craftCodes":["COATED_COLOR_PRINT_FOIL","COLOR_PRINT_FOIL"],"foilColorCount":1',
    );
    expect(safetyMigration).toContain(
      '"productCodes":["EXT-CUSTOM-FOIL-MID-SQUARE","EXT-CUSTOM-FOIL-LARGE"],"foilColorCount":0',
    );
    expect(safetyMigration).toContain(
      '"craftCodes":["FLAT_FOIL_PARTIAL","STOCK_FOIL"]',
    );
    expect(safetyMigration).toContain(
      'AND "code" = \'REF_MACHINE_FOIL_AMBIGUOUS\'',
    );
  });

  it('requires the matching color-print craft and blocks every craft outside the reviewed allow-list', () => {
    expect(safetyMigration).toContain(
      '"noneOfCraftCodes":["COATED_COLOR_PRINT","COATED_COLOR_PRINT_FOIL"]',
    );
    expect(safetyMigration).toContain(
      '"noneOfCraftCodes":["COLOR_PRINT","COLOR_PRINT_FOIL"]',
    );
    expect(safetyMigration).toContain(
      '"anyCraftCodeOutside":["COATED_COLOR_PRINT","COATED_COLOR_PRINT_FOIL","DIE_CUT","GLUING","EMBOSS","BUMP","PACKING"]',
    );
    expect(safetyMigration).toContain(
      '"anyCraftCodeOutside":["COLOR_PRINT","COLOR_PRINT_FOIL","DIE_CUT","GLUING","EMBOSS","BUMP","PACKING"]',
    );
    expect(safetyMigration).not.toContain(
      '"anyCraftCodeOutside":["COATED_COLOR_PRINT","COATED_COLOR_PRINT_FOIL","UV"',
    );
  });
});

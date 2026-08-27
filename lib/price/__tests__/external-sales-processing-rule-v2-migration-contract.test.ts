import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20260826184000_external_sales_processing_rule_v2',
    'migration.sql',
  ),
  'utf8',
);

function normalizeSql(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

const compactMigration = normalizeSql(migration);

function sqlBetween(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);

  expect(startIndex, `missing SQL marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing SQL marker: ${end}`).toBeGreaterThan(startIndex);

  return migration.slice(startIndex, endIndex);
}

function expectCompactSql(fragment: string) {
  expect(compactMigration).toContain(normalizeSql(fragment));
}

const stockMatrix = [
  ['EXT-STOCK-PEARL-FLASH-120-MINI', '0.1000', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-PEARL-FLASH-160-SQUARE', '0.1200', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-PEARL-FLASH-160-MID', '0.1200', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-PEARL-FLASH-160-LARGE', '0.1300', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-PEARL-FLASH-160-WEST-MID', '0.1200', 'WESTERN_ENVELOPE'],
  ['EXT-STOCK-PEARL-FLASH-160-WEST-LARGE', '0.1200', 'WESTERN_ENVELOPE'],
  ['EXT-STOCK-PEARL-RED-160-SQUARE', '0.1200', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-PEARL-RED-160-MID', '0.1200', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-PEARL-RED-160-LARGE', '0.1300', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-PEARL-RED-160-WEST-MID', '0.1300', 'WESTERN_ENVELOPE'],
  ['EXT-STOCK-PEARL-RED-160-WEST-LARGE', '0.1300', 'WESTERN_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-160-SQUARE', '0.1200', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-160-MID', '0.1200', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-160-LARGE', '0.1300', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-160-WEST-MID', '0.1700', 'WESTERN_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-160-WEST-LARGE', '0.1700', 'WESTERN_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-180-MID', '0.1350', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-180-LARGE', '0.1500', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-230-MID', '0.1500', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-RED-CARD-230-LARGE', '0.1700', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-SOFT-TOUCH-200-SQUARE', '0.2200', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-SOFT-TOUCH-200-MID', '0.2300', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-SOFT-TOUCH-200-LARGE', '0.2500', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-VARIEGATED-PEARL-160-LARGE', '0.1700', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-GOLD-GLITTER-230-MID', '0.1700', 'STANDARD_ENVELOPE'],
  ['EXT-STOCK-GOLD-GLITTER-230-LARGE', '0.1900', 'STANDARD_ENVELOPE'],
] as const;

const customTiers = [
  ['LE_750', '1', '750', '0.4800', '0.5200'],
  ['751_1500', '751', '1500', '0.3100', '0.3250'],
  ['1501_2500', '1501', '2500', '0.2700', '0.2850'],
  ['2501_3500', '2501', '3500', '0.2500', '0.2700'],
  ['3501_4500', '3501', '4500', '0.2300', '0.2450'],
  ['4501_7500', '4501', '7500', '0.2000', '0.2200'],
  ['7501_15000', '7501', '15000', '0.1800', '0.2000'],
  ['15001_25000', '15001', '25000', '0.1700', '0.1900'],
  ['GTE_25001', '25001', '9999999', '0.1700', '0.1900'],
] as const;

const colorPriceTables = {
  'EXT-COLOR-COATED-200-LARGE': [
    ['Q100', '100', '100', '130.0000'],
    ['Q200', '200', '200', '200.0000'],
    ['Q300', '300', '300', '220.0000'],
    ['Q400', '400', '400', '240.0000'],
    ['Q500', '500', '500', '260.0000'],
    ['Q1000', '1000', '1000', '310.0000'],
    ['Q2000', '2000', '2000', '450.0000'],
    ['Q3000', '3000', '3000', '580.0000'],
    ['Q4000', '4000', '4000', '700.0000'],
    ['Q5000', '5000', '7999', '870.0000'],
    ['Q10000', '8000', '14999', '1520.0000'],
    ['Q20000', '15000', '20000', '2580.0000'],
  ],
  'EXT-COLOR-COATED-200-MID': [
    ['Q500', '500', '500', '210.0000'],
    ['Q1000', '1000', '1000', '290.0000'],
    ['Q2000', '2000', '2000', '400.0000'],
    ['Q3000', '3000', '3000', '470.0000'],
    ['Q4000', '4000', '4000', '570.0000'],
    ['Q5000', '5000', '7999', '700.0000'],
    ['Q10000', '8000', '14999', '1200.0000'],
    ['Q20000', '15000', '20000', '2100.0000'],
  ],
  'EXT-COLOR-ICE-WHITE-160-LARGE': [
    ['Q100', '100', '100', '150.0000'],
    ['Q200', '200', '200', '230.0000'],
    ['Q300', '300', '300', '260.0000'],
    ['Q400', '400', '400', '290.0000'],
    ['Q500', '500', '500', '320.0000'],
    ['Q1000', '1000', '1000', '340.0000'],
    ['Q2000', '2000', '2000', '510.0000'],
    ['Q3000', '3000', '3000', '700.0000'],
    ['Q4000', '4000', '4000', '830.0000'],
    ['Q5000', '5000', '7999', '1000.0000'],
    ['Q10000', '8000', '14999', '1750.0000'],
    ['Q20000', '15000', '20000', '3200.0000'],
  ],
  'EXT-COLOR-ICE-WHITE-160-MID': [
    ['Q100', '100', '100', '165.0000'],
    ['Q200', '200', '200', '245.0000'],
    ['Q300', '300', '300', '275.0000'],
    ['Q400', '400', '400', '275.0000'],
    ['Q500', '500', '500', '290.0000'],
    ['Q1000', '1000', '1000', '320.0000'],
  ],
} as const;

const colorFoilTiers = [
  ['Q1000', '1000', '1000', '200.0000'],
  ['Q2000', '2000', '2000', '250.0000'],
  ['Q3000', '3000', '3000', '350.0000'],
  ['Q4000', '4000', '4000', '480.0000'],
  ['Q5000', '5000', '7999', '580.0000'],
  ['Q10000', '8000', '14999', '700.0000'],
  ['Q20000', '15000', '20000', '1200.0000'],
  ['Q30000', '30000', '30000', '1700.0000'],
] as const;

describe('external-sales processing rule v2 migration contract', () => {
  it('adds explicit front/back facts without removing legacy columns', () => {
    expect(migration).toContain(
      'ADD COLUMN "frontFoilColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]',
    );
    expect(migration).toContain(
      'ADD COLUMN "backFoilColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]',
    );
    expect(migration).toContain('cardinality("frontFoilColors") <= 3');
    expect(migration).toContain('cardinality("backFoilColors") <= 3');
    expect(migration).not.toMatch(/DROP COLUMN "(?:foilColors|isDoubleSided|isDoubleColor)"/);
  });

  it('publishes a new immutable book from the provided rule source', () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain('cpb_external_processing_rule_v2');
    expect(migration).toContain('EXTERNAL_SALES_PROCESSING_RULES');
    expect(migration).toContain(
      '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817',
    );
    expect(migration).toContain('pg_advisory_xact_lock');
  });

  it('locks every exact stock SKU cell, including 200g touch-paper large at 0.25', () => {
    const stockSection = sqlBetween(
      'WITH stock("productCode", "rate", "structure") AS (',
      ')\nINSERT INTO "_ExternalProcessingV2RuleSeed"',
    );
    const actualRows = [...stockSection.matchAll(
      /\('([^']+)',\s*(\d+\.\d+),\s*'([^']+)'\)/g,
    )].map((match) => [match[1], match[2], match[3]]);

    expect(actualRows).toEqual(stockMatrix);
    expect(actualRows).toContainEqual([
      'EXT-STOCK-SOFT-TOUCH-200-LARGE',
      '0.2500',
      'STANDARD_ENVELOPE',
    ]);
  });

  it('charges local foil by pass: 40 per pass below 1000 and 0.04 per piece/pass from 1000', () => {
    expectCompactSql(`
      (NULL, 'FOIL_SURCHARGE', 'STOCK_LOCAL_FOIL_LT_1000_PER_PASS',
      '局部烫金 · 1–999个', 'ADD_ON', 'FIXED_AMOUNT', 40.0000, 1, 999,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],
      "foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilPassCount":1,
      "perFoilPass":true}', 'STOCK_LOCAL_FOIL_MACHINE', 300, '§1.2', NULL, FALSE)
    `);
    expectCompactSql(`
      (NULL, 'FOIL_SURCHARGE', 'STOCK_LOCAL_FOIL_GTE_1000_PER_PASS',
      '局部烫金 · 1000个起', 'ADD_ON', 'PER_PIECE', 0.0400, 1000, 9999999,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["STOCK_BLANK"],
      "foilTechniques":["FLAT"],"hasLocalFoil":true,"minFoilPassCount":1,
      "perFoilPass":true}', 'STOCK_LOCAL_FOIL_MACHINE', 300, '§1.2', NULL, FALSE)
    `);
  });

  it('uses every continuous custom interval with the exact mid/large rate pair', () => {
    const tierSection = sqlBetween(
      '), tier("tier", "minQty", "maxQty", "midRate", "largeRate") AS (',
      ')\nINSERT INTO "_ExternalProcessingV2RuleSeed"',
    );
    const actualTiers = [...tierSection.matchAll(
      /\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+\.\d+),\s*(\d+\.\d+)\)/g,
    )].map((match) => [match[1], match[2], match[3], match[4], match[5]]);

    expect(actualTiers).toEqual(customTiers);
    expect(migration).not.toContain('0.1600');
    expect(migration).not.toContain('Q50000');
  });

  it('locks all six custom-paper surcharges and the four confirmed craft add-ons', () => {
    for (const [code, label, amount, paper] of [
      [
        'CUSTOM_PAPER_VARIEGATED_PEARL_160',
        '杂色珠光 160g',
        '0.0300',
        '160g杂色珠光',
      ],
      ['CUSTOM_PAPER_LINEN_150', '莱尼纹 150g', '0.0350', '150g莱尼纹'],
      ['CUSTOM_PAPER_RED_CARD_180', '红卡 180g', '0.0250', '180g红卡'],
      ['CUSTOM_PAPER_RED_CARD_230', '红卡 230g', '0.0400', '230g红卡'],
      ['CUSTOM_PAPER_GOLD_GLITTER_230', '金葱 230g', '0.1000', '230g金葱'],
      ['CUSTOM_PAPER_SOFT_TOUCH_200', '触感纸 200g', '0.1000', '200g触感纸'],
    ] as const) {
      expectCompactSql(`
        (NULL, 'PAPER_SURCHARGE', '${code}', '${label}',
        'ADD_ON', 'PER_PIECE', ${amount}, NULL, NULL,
        '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],
        "paperTypes":["${paper}"]}', 'CUSTOM_PAPER_SURCHARGE', 200, '§2.2',
        NULL, FALSE)
      `);
    }

    expectCompactSql(`
      (NULL, 'SPEC_SURCHARGE', 'CUSTOM_WESTERN_ENVELOPE', '西封',
      'ADD_ON', 'PER_PIECE', 0.0600, NULL, NULL,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],
      "productStructures":["WESTERN_ENVELOPE"]}', NULL, 200, '§2.3', NULL, FALSE)
    `);
    expectCompactSql(`
      (NULL, 'COLOR_SURCHARGE', 'CUSTOM_DOUBLE_COLOR', '双色',
      'ADD_ON', 'PER_PIECE', 0.0900, NULL, NULL,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],
      "foilColorCount":2}', NULL, 200, '§2.3', NULL, FALSE)
    `);
    expectCompactSql(`
      (NULL, 'SPECIAL_EFFECT', 'CUSTOM_RELIEF_OR_RAISED_PIECE', '浮雕或激凸',
      'ADD_ON', 'PER_PIECE', 0.0500, NULL, NULL,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],
      "foilTechniques":["RELIEF","RAISED"]}', NULL, 200, '§2.3', NULL, FALSE)
    `);
    expectCompactSql(`
      (NULL, 'SPECIAL_EFFECT', 'CUSTOM_RELIEF_OR_RAISED_SETUP', '浮雕或激凸调版费',
      'ADD_ON', 'FIXED_AMOUNT', 90.0000, NULL, NULL,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],
      "foilTechniques":["RELIEF","RAISED"]}', NULL, 200, '§2.3', NULL, FALSE)
    `);
  });

  it('publishes all four color-print fixed-total tables with only the documented ranges', () => {
    const colorSection = sqlBetween(
      'WITH color_price("productCode", "tier", "minQty", "maxQty", "amount") AS (',
      ')\nINSERT INTO "_ExternalProcessingV2RuleSeed"',
    );
    const actualRows = [...colorSection.matchAll(
      /\('([^']+)','([^']+)',(\d+),(\d+),(\d+\.\d+)\)/g,
    )].map((match) => [match[1], match[2], match[3], match[4], match[5]]);
    const expectedRows = Object.entries(colorPriceTables).flatMap(
      ([productCode, tiers]) => tiers.map((tier) => [productCode, ...tier]),
    );

    expect(actualRows).toEqual(expectedRows);
    expect(
      new Set(actualRows.filter((row) => row[2] === '5000').map((row) => row[3])),
    ).toEqual(new Set(['7999']));
    expect(
      new Set(actualRows.filter((row) => row[2] === '8000').map((row) => row[3])),
    ).toEqual(new Set(['14999']));
    expect(
      new Set(actualRows.filter((row) => row[2] === '15000').map((row) => row[3])),
    ).toEqual(new Set(['20000']));
  });

  it('locks every color-print single-front-foil fixed total', () => {
    const foilSection = sqlBetween(
      'WITH foil_price("tier", "minQty", "maxQty", "amount") AS (',
      ')\nINSERT INTO "_ExternalProcessingV2RuleSeed"',
    );
    const actualTiers = [...foilSection.matchAll(
      /\('([^']+)',(\d+),(\d+),(\d+\.\d+)\)/g,
    )].map((match) => [match[1], match[2], match[3], match[4]]);

    expect(actualTiers).toEqual(colorFoilTiers);
    expectCompactSql(`
      'ADD_ON', 'FIXED_AMOUNT', foil_price."amount",
      foil_price."minQty", foil_price."maxQty"
    `);
    expectCompactSql(`
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],
      "foilTechniques":["FLAT"],"foilPassCount":1}'
    `);
  });

  it('blocks sub-1000 color-print foil quantities instead of charging only the color base', () => {
    expectCompactSql(`
      (NULL, 'FOIL_SURCHARGE', 'COLOR_SINGLE_FRONT_FOIL_LT_1000_MANUAL',
      '彩印单色烫金 1000 个以下', 'REFERENCE', NULL, NULL, 1, 999,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["COLOR_PRINT"],
      "foilTechniques":["FLAT"],"foilPassCount":1}', NULL, 500, '§3',
      '单色烫金附加总价从 1000 个起才有明确报价', TRUE)
    `);
  });

  it('keeps 157g and ten-thousand envelopes out of automatic pricing', () => {
    const productSeed = sqlBetween(
      'INSERT INTO "_ExternalProcessingV2Products" VALUES',
      'INSERT INTO "Product" (',
    );

    expect(productSeed).not.toMatch(/157g|TEN[-_]THOUSAND|万元/);
    expect(migration.match(/157/g)).toEqual(['157']);
    expect(migration.match(/TEN_THOUSAND_ENVELOPE/g)).toHaveLength(1);
    expectCompactSql(`
      (NULL, 'REFERENCE', 'CUSTOM_TEN_THOUSAND_MANUAL', '万元封专版',
      'REFERENCE', NULL, NULL, NULL, NULL,
      '{"schemaVersion":1,"target":"ITEM","pricingRoutes":["CUSTOM_SINGLE_FLAT_FOIL"],
      "productStructures":["TEN_THOUSAND_ENVELOPE"]}', NULL, 500, '§7',
      '无自动阶梯价', TRUE)
    `);
    expect(migration).toContain("product.\"code\"::TEXT LIKE '%157%'");
    expect(migration).toContain("product.\"code\"::TEXT LIKE '%TEN-THOUSAND%'");
    expect(migration).toContain("\"name\" ILIKE '%纸张未标%'");
    expect(migration).toContain("\"name\" ILIKE '%克重未标%'");
  });
});

import 'dotenv/config';

import { describe, expect, it } from 'vitest';
import { db } from '../../db';
import {
  calculateCreateOrderQuote,
  selectFullUnitPrice,
} from '../../price/create-order';
import type { CreateOrderPriceSnapshot } from '../../price/create-order';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
  RULE8_CARTON_GOLDEN_CASES,
  RULE8_FULL_GOLDEN_CASES,
  RULE8_GOLDEN_CASE_COUNT,
  RULE8_PARTIAL_GOLDEN_CASES,
  RULE8_PRINT_GOLDEN_CASES,
  RULE8_SHIPPING_GOLDEN_CASES,
  createGoldenOrderInput,
  createGoldenOrderItem,
} from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import { readPublishedCreateOrderPriceSnapshot } from '../create-order-published-rule-adapter';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;

/**
 * 黄金用例锁定的是迁移 20260830170000_external_processing_print_null_sentinel
 * 发布的那一版加工费价目簿。迁移链之后还可能有 CLI / 规则中心发布的新版本
 * （如 2026-09-13 的「达到档位取价」十一档），它们会改变「当前生效」的快照，
 * 但不改写这一版。所以第一条用例按谱系标识定位该版本，并以它的生效时刻回读
 * 快照，让断言在任何已跑完迁移链的库上都成立。
 *
 * 第二条用例守的是「此刻生效的版本」：按当前版 notes.ruleVersion 选对应的
 * 黄金期望集；没有登记期望的谱系直接失败——发布新版本的人必须同时登记它对
 * 黄金用例的影响，而不是让门禁静默失效。
 */
const PRINT_SENTINEL_LINEAGE = {
  ruleVersion: '2026-08-30-print-null-sentinel',
  sourceSha256:
    '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
} as const;

/**
 * 某个谱系相对 §8 黄金值的差异：只允许覆盖专版大号数量边界例的取价结果。
 * 其余 PARTIAL / PRINT / 装盒 / 物流用例在所有已登记谱系下期望不变。
 */
type FullBoundaryOverride = {
  unitPrice: string;
  minQuantity: number;
  maxQuantity: number;
};
type LineageExpectations = {
  fullBoundary: ReadonlyMap<string, FullBoundaryOverride>;
};

/**
 * 2026-09-13「按达到档位取价，补齐 200 个档」（config/customer-price-books/
 * custom-tiers-20260913.json，由 scripts/publish-confirmed-custom-tiers.ts 发布）。
 * 档位变成 [200,499] [500,999] [1000,1999] … [50000,∞)，单价表本身没变；
 * 大号封 200 个档单价 ¥1.00 是业主确认的报价表值。
 */
const ATTAINED_CUSTOM_TIERS_FULL_BOUNDARY: ReadonlyMap<string, FullBoundaryOverride> =
  new Map<string, FullBoundaryOverride>([
    ['S8-FULL-005', { unitPrice: '1.0000', minQuantity: 1, maxQuantity: 499 }],
    ['S8-FULL-006', { unitPrice: '0.5200', minQuantity: 500, maxQuantity: 999 }],
    ['S8-FULL-007', { unitPrice: '0.5200', minQuantity: 500, maxQuantity: 999 }],
    ['S8-FULL-008', { unitPrice: '0.2450', minQuantity: 4_000, maxQuantity: 4_999 }],
    ['S8-FULL-009', { unitPrice: '0.2450', minQuantity: 4_000, maxQuantity: 4_999 }],
    ['S8-FULL-010', { unitPrice: '0.2200', minQuantity: 5_000, maxQuantity: 9_999 }],
    ['S8-FULL-011', { unitPrice: '0.2200', minQuantity: 5_000, maxQuantity: 9_999 }],
    ['S8-FULL-012', { unitPrice: '0.1900', minQuantity: 20_000, maxQuantity: 29_999 }],
    ['S8-FULL-013', { unitPrice: '0.1900', minQuantity: 20_000, maxQuantity: 29_999 }],
    ['S8-FULL-014', { unitPrice: '0.1900', minQuantity: 30_000, maxQuantity: 49_999 }],
    ['S8-FULL-015', { unitPrice: '0.1900', minQuantity: 30_000, maxQuantity: 49_999 }],
  ]);

const LINEAGE_EXPECTATIONS: Record<string, LineageExpectations> = {
  [PRINT_SENTINEL_LINEAGE.ruleVersion]: { fullBoundary: new Map() },
  '2026-09-13-attained-custom-tiers': {
    fullBoundary: ATTAINED_CUSTOM_TIERS_FULL_BOUNDARY,
  },
};

function runRule8GoldenCases(
  snapshot: CreateOrderPriceSnapshot,
  expectations: LineageExpectations,
) {
  const passed: string[] = [];
  const failed: Array<{ caseId: string; actual: unknown }> = [];
  const record = (caseId: string, ok: boolean, actual: unknown) => {
    if (ok) {
      passed.push(caseId);
    } else {
      failed.push({ caseId, actual });
    }
  };
  const quote = (
    item: ReturnType<typeof createGoldenOrderItem>,
    options: Parameters<typeof createGoldenOrderInput>[1] = {},
  ) =>
    calculateCreateOrderQuote(
      createGoldenOrderInput([item], options),
      snapshot,
    );

  for (const testCase of RULE8_PARTIAL_GOLDEN_CASES) {
    const result = quote(createGoldenOrderItem(testCase.item));
    const item = result.items[0]!;
    const lines = new Map(item.lines.map((line) => [line.code, line]));
    const bagging = result.packagingGroups[0]?.line.amount;
    record(
      testCase.caseId,
      item.status === 'QUOTED' &&
        lines.get('PARTIAL_BLANK')?.amount === testCase.expected.blank &&
        lines.get('PARTIAL_MACHINE')?.amount === testCase.expected.machine &&
        bagging === testCase.expected.bagging,
      { item, bagging },
    );
  }

  for (const testCase of RULE8_FULL_GOLDEN_CASES) {
    const input = createGoldenOrderItem({
      craft: 'FULL',
      paperType: '珠光艳闪',
      paperWeightGsm: 160,
      specification: '大号封',
      pricingGroup: 'LARGE',
      quantity: 5_000,
      frontColors: ['哑金'],
      backColors: [],
      ...testCase.item,
    });
    const result = quote(input, { unitsPerBag: 6 });
    const item = result.items[0]!;
    const selected = selectFullUnitPrice(input, snapshot.full);
    const override = expectations.fullBoundary.get(testCase.caseId);
    if (override) {
      record(
        testCase.caseId,
        item.status === 'QUOTED' &&
          item.unitPrice === override.unitPrice &&
          selected?.pricingGroup === input.pricingGroup &&
          selected.minQuantity === override.minQuantity &&
          selected.maxQuantity === override.maxQuantity,
        { item, selected },
      );
      continue;
    }
    const expected = testCase.expected;
    const expectedTier =
      'tierCode' in expected
        ? CREATE_ORDER_GOLDEN_SNAPSHOT.full.unitPrices.find(
            (tier) =>
              tier.tierCode === expected.tierCode &&
              tier.pricingGroup === input.pricingGroup,
          )
        : null;
    const ok =
      item.status === expected.status &&
      ('manualReason' in expected
        ? item.amount === null &&
          result.manualReasons.some(
            (reason) => reason.code === expected.manualReason,
          )
        : item.unitPrice === expected.unitPrice &&
          (!('processing' in expected) ||
            item.processingAmount === expected.processing) &&
          (!('tierCode' in expected) ||
            (expectedTier !== null &&
              expectedTier !== undefined &&
              selected?.pricingGroup === expectedTier.pricingGroup &&
              selected.minQuantity === expectedTier.minQuantity &&
              selected.maxQuantity === expectedTier.maxQuantity)));
    record(testCase.caseId, ok, { item, selected });
  }

  for (const testCase of RULE8_PRINT_GOLDEN_CASES) {
    const result = quote(
      createGoldenOrderItem({
        craft: 'PRINT',
        paperType: '铜版纸',
        paperWeightGsm: 200,
        specification: '大号封',
        frontColors: [],
        backColors: [],
        printFoilMode: 'NONE',
        ...testCase.item,
      }),
    );
    const item = result.items[0]!;
    const expected = testCase.expected;
    const printLine = item.lines.find(
      (line) => line.code === 'PRINT_PER_ORDER',
    );
    const ok =
      item.status === expected.status &&
      ('manualReason' in expected
        ? item.amount === null &&
          result.manualReasons.some(
            (reason) => reason.code === expected.manualReason,
          )
        : item.processingAmount === expected.processing &&
          printLine?.amount === expected.processing &&
          printLine.basis.tierQuantity === expected.tierQuantity);
    record(testCase.caseId, ok, { item, manualReasons: result.manualReasons });
  }

  for (const testCase of RULE8_CARTON_GOLDEN_CASES) {
    const result = quote(
      createGoldenOrderItem({ quantity: testCase.quantity }),
    );
    const carton = result.order.lines.find((line) => line.code === 'CARTON');
    record(
      testCase.caseId,
      carton?.amount === testCase.amount,
      carton,
    );
  }

  for (const testCase of RULE8_SHIPPING_GOLDEN_CASES) {
    const item =
      testCase.kind === 'WEIGHT_180'
        ? createGoldenOrderItem({
            quantity: 2_000,
            paperType: '红卡',
            paperWeightGsm: 180,
          })
        : createGoldenOrderItem({
            quantity: testCase.kind === 'FREIGHT_PENDING' ? 2_001 : 2_000,
          });
    const result = quote(item, {
      province: testCase.province,
      isSfCollect: testCase.kind === 'SF_COLLECT',
    });
    const shipping = result.order.lines.find((line) =>
      line.code.startsWith('SHIPPING:'),
    );
    record(
      testCase.caseId,
      shipping?.amount === testCase.amount &&
        shipping.status ===
          (testCase.kind === 'FREIGHT_PENDING'
            ? 'PENDING_AMOUNT'
            : 'QUOTED'),
      shipping,
    );
  }

  return { passed, failed };
}

databaseDescribe.sequential(
  'create-order price snapshot · 42-case golden gate',
  () => {
    it('print-sentinel lineage matches every authoritative §8 case', async () => {
      const lineageBook = await db.customerPriceBook.findFirst({
        where: {
          settlementType: 'EXTERNAL_SALES',
          purpose: 'PROCESSING',
          sourceSha256: PRINT_SENTINEL_LINEAGE.sourceSha256,
          notes: { path: ['ruleVersion'], equals: PRINT_SENTINEL_LINEAGE.ruleVersion },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
        select: { id: true, version: true, effectiveFrom: true },
      });
      expect(
        lineageBook,
        '未找到 print-sentinel 谱系的加工费价目簿，请确认迁移链已完整应用',
      ).not.toBeNull();
      const snapshot = await db.$transaction((tx) =>
        readPublishedCreateOrderPriceSnapshot(tx, { now: lineageBook!.effectiveFrom }),
      );
      expect(snapshot.priceVersion.processing.id).toBe(lineageBook!.id);

      const { passed, failed } = runRule8GoldenCases(
        snapshot,
        LINEAGE_EXPECTATIONS[PRINT_SENTINEL_LINEAGE.ruleVersion]!,
      );
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
      expect(passed).toHaveLength(RULE8_GOLDEN_CASE_COUNT);
      // 快照证据必须指向谱系里那一版已发布的加工费价目簿；后续发布会给它
      // 写上 effectiveTo，但不会撤销它（isActive 仍为 true），也不改其规则。
      const book = await db.customerPriceBook.findUniqueOrThrow({where: {id: snapshot.priceVersion.processing.id}});
      expect(book).toMatchObject({
        id: lineageBook!.id,
        isActive: true,
        purpose: 'PROCESSING',
        version: snapshot.priceVersion.processing.version,
      });
    });

    it('currently published lineage matches its registered §8 expectations', async () => {
      const snapshot = await db.$transaction((tx) =>
        readPublishedCreateOrderPriceSnapshot(tx, { now: new Date() }),
      );
      const book = await db.customerPriceBook.findUniqueOrThrow({
        where: { id: snapshot.priceVersion.processing.id },
      });
      const notes = book.notes as Record<string, unknown> | null;
      const ruleVersion =
        typeof notes?.ruleVersion === 'string' ? notes.ruleVersion : null;
      const expectations = ruleVersion ? LINEAGE_EXPECTATIONS[ruleVersion] : undefined;
      expect(
        expectations,
        `当前生效的加工费价目簿（version ${book.version}，ruleVersion=${ruleVersion ?? '缺失'}）` +
          '没有登记黄金期望。发布新谱系时必须在 LINEAGE_EXPECTATIONS 里登记它对 §8 黄金用例的影响。',
      ).toBeDefined();

      const { passed, failed } = runRule8GoldenCases(snapshot, expectations!);
      expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
      expect(passed).toHaveLength(RULE8_GOLDEN_CASE_COUNT);
      // Publishing an additive rule version changes the book ID. Keep every
      // golden amount above, and verify that its evidence identifies the active,
      // currently effective processing book rather than a retired version ID.
      expect(book).toMatchObject({
        isActive: true,
        purpose: 'PROCESSING',
        version: snapshot.priceVersion.processing.version,
      });
      expect(book.effectiveTo).toBeNull();
    });
  },
);

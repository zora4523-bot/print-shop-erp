import 'dotenv/config';

import { describe, expect, it } from 'vitest';
import { db } from '../../db';
import {
  calculateCreateOrderQuote,
  selectFullUnitPrice,
} from '../../price/create-order';
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
 * 但不改写这一版。所以这里按谱系标识定位该版本，并以它的生效时刻回读快照，
 * 让断言在任何已跑完迁移链的库上都成立，而不依赖库里之后发布过什么。
 */
const PRINT_SENTINEL_LINEAGE = {
  ruleVersion: '2026-08-30-print-null-sentinel',
  sourceSha256:
    '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852',
} as const;

databaseDescribe.sequential(
  'print-sentinel lineage create-order price snapshot · 42-case golden gate',
  () => {
    it('matches every authoritative §8 case after the print-sentinel release', async () => {
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
  },
);

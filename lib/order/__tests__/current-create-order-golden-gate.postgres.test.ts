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

databaseDescribe.sequential(
  'current published create-order price snapshot · 42-case golden gate',
  () => {
    it('matches every authoritative §8 case after the print-sentinel release', async () => {
      const snapshot = await db.$transaction((tx) =>
        readPublishedCreateOrderPriceSnapshot(tx, { now: new Date() }),
      );
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
      expect(snapshot.priceVersion.processing.id).toBe(
        'cpb_external_processing_print_sentinel_v1',
      );
    });
  },
);

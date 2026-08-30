import 'dotenv/config';

import { describe, expect, it } from 'vitest';
import { db } from '../../db';
import { listExternalCreateOrderProductOptions } from '../../product';
import { calculateCreateOrderQuote } from '../../price/create-order';
import {
  createGoldenOrderInput,
  createGoldenOrderItem,
} from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import { readPublishedCreateOrderPriceProjection } from '../create-order-published-rule-adapter';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const REPAIRED_PROCESSING_BOOK_ID =
  'cpb_external_processing_truth_repair_v1';
const RETIRED_TACTILE_SQUARE_PRODUCT_CODE =
  'EXT-STOCK-SOFT-TOUCH-200-SQUARE';

databaseDescribe.sequential(
  'external processing truth repair · runtime PostgreSQL contract',
  () => {
    it('只把真值价格和合法产品组合投影到新建工单', async () => {
      const repairedBook = await db.customerPriceBook.findUniqueOrThrow({
        where: { id: REPAIRED_PROCESSING_BOOK_ID },
        select: { effectiveFrom: true },
      });
      const repairedAt = new Date(repairedBook.effectiveFrom.getTime() + 1);
      const { snapshot, audit } = await db.$transaction((tx) =>
        readPublishedCreateOrderPriceProjection(tx, { now: repairedAt }),
      );

      expect(snapshot.priceVersion.processing.id).toBe(
        REPAIRED_PROCESSING_BOOK_ID,
      );
      expect(audit.processingRuleCount).toBe(144);
      expect(audit.projectedRuleCodes.partialBlank).toHaveLength(25);

      const blankPrice = (
        paperType: string,
        paperWeightGsm: number,
        specification: string,
      ) =>
        snapshot.partial.blankUnitPrices.find(
          (price) =>
            price.paperType === paperType &&
            price.paperWeightGsm === paperWeightGsm &&
            price.specification === specification,
        );

      expect(blankPrice('珠光闪红', 160, '大号封')?.unitPrice).toBe(
        '0.13',
      );
      expect(blankPrice('触感纸', 200, '大号封')?.unitPrice).toBe(
        '0.25',
      );
      expect(blankPrice('触感纸', 200, '方形封')).toBeUndefined();

      expect(snapshot.full.unitPrices.slice(-4)).toEqual([
        {
          tierCode: 'BASE_CUSTOM-MID_25001_40000',
          pricingGroup: 'MID',
          minQuantity: 25_001,
          maxQuantity: 40_000,
          unitPrice: '0.17',
        },
        {
          tierCode: 'BASE_CUSTOM-LARGE_25001_40000',
          pricingGroup: 'LARGE',
          minQuantity: 25_001,
          maxQuantity: 40_000,
          unitPrice: '0.19',
        },
        {
          tierCode: 'BASE_CUSTOM-MID_GTE_40001',
          pricingGroup: 'MID',
          minQuantity: 40_001,
          maxQuantity: null,
          unitPrice: '0.16',
        },
        {
          tierCode: 'BASE_CUSTOM-LARGE_GTE_40001',
          pricingGroup: 'LARGE',
          minQuantity: 40_001,
          maxQuantity: null,
          unitPrice: '0.18',
        },
      ]);

      const catalog = await db.$transaction((tx) =>
        listExternalCreateOrderProductOptions(tx),
      );
      expect(
        catalog.some(
          (product) => product.code === RETIRED_TACTILE_SQUARE_PRODUCT_CODE,
        ),
      ).toBe(false);

      const tactileSquareQuote = calculateCreateOrderQuote(
        createGoldenOrderInput([
          createGoldenOrderItem({
            craft: 'PARTIAL',
            paperType: '触感纸',
            paperWeightGsm: 200,
            specification: '方形封',
          }),
        ]),
        snapshot,
      );
      expect(tactileSquareQuote.items[0]?.status).toBe(
        'MANUAL_PRICING_REQUIRED',
      );
      expect(
        tactileSquareQuote.manualReasons.map((reason) => reason.code),
      ).toContain('PARTIAL_BLANK_PRICE_NOT_FOUND');
    });
  },
);

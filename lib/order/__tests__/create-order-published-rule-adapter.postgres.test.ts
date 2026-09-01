import 'dotenv/config';

import { describe, expect, it } from 'vitest';
import { db } from '../../db';
import { calculateCreateOrderQuote } from '../../price/create-order';
import {
  createGoldenOrderInput,
  createGoldenOrderItem,
} from '../../price/__tests__/fixtures/create-order-golden-fixtures';
import { ZTO_PROVINCE_OPTIONS } from '../../price/external-order-charges';
import {
  projectPublishedCreateOrderPriceSnapshot,
  readCandidatePublishedCreateOrderPriceProjection,
  readPublishedCreateOrderPriceProjection,
  type PublishedCreateOrderPriceProjectionInput,
  type PublishedCreateOrderRuleRow,
} from '../create-order-published-rule-adapter';
import { readExternalCreateOrderPriceSnapshot } from '../create-order-price-snapshot';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const PROCESSING_BOOK_ID = 'cpb_external_processing_rule_v3';
const FIVE_TIER_PROCESSING_BOOK_ID =
  'cpb_external_processing_rule_v4_five_tier';
const RETIRED_INCOMPATIBLE_PROCESSING_BOOK_ID =
  'cpb_stock_local_foil_bef5f8d170b81d40ad1e338e';
const FRESH_INCOMPATIBLE_PROCESSING_BOOK_ID =
  'cpb_external_sales_processing_202608_v1';
const LOGISTICS_BOOK_ID = 'cpb_external_logistics_weight_policy_v3';
const PROCESSING_SOURCE_SHA =
  '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817';
const FIVE_TIER_PROCESSING_SOURCE_SHA =
  '8a5e1149a2e62920c7ebf9d14a6cedf4e6dac5e0769d556b5a52dbeb99dbd852';
const LOGISTICS_SOURCE_SHA =
  '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69';
const SHIPPING_SOURCE_SHA =
  'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060';
const CARTON_SOURCE_SHA =
  '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b';

type ProjectionWindow = {
  at: Date;
  start: Date;
  end: Date | null;
};

async function readProjectionWindow(
  processingBookId: string,
): Promise<ProjectionWindow> {
  const books = await db.customerPriceBook.findMany({
    where: { id: { in: [processingBookId, LOGISTICS_BOOK_ID] } },
    select: { id: true, effectiveFrom: true, effectiveTo: true },
  });
  const processing = books.find((book) => book.id === processingBookId);
  const logistics = books.find((book) => book.id === LOGISTICS_BOOK_ID);
  if (!processing || !logistics) {
    throw new Error('Published projection test books are missing');
  }

  const startMillis = Math.max(
    processing.effectiveFrom.getTime(),
    logistics.effectiveFrom.getTime(),
  );
  const finiteEnds = [processing.effectiveTo, logistics.effectiveTo]
    .filter((value): value is Date => value !== null)
    .map((value) => value.getTime());
  const endMillis = finiteEnds.length === 0 ? null : Math.min(...finiteEnds);
  if (endMillis !== null && startMillis >= endMillis) {
    throw new Error('Published projection test books have no shared window');
  }

  return {
    at: new Date(
      endMillis === null
        ? startMillis
        : startMillis + Math.floor((endMillis - startMillis) / 2),
    ),
    start: new Date(startMillis),
    end: endMillis === null ? null : new Date(endMillis),
  };
}

async function readCurrentProjectionInput(
  now: Date,
): Promise<PublishedCreateOrderPriceProjectionInput> {
  return db.$transaction(async (tx) => {
    const priceVersion = await readExternalCreateOrderPriceSnapshot(tx, {
      now,
    });
    const bookIds = [priceVersion.processing.id, priceVersion.logistics.id];
    const [books, rules] = await Promise.all([
      tx.customerPriceBook.findMany({
        where: { id: { in: bookIds } },
        select: { id: true, notes: true },
      }),
      tx.customerPriceRule.findMany({
        where: { priceBookId: { in: bookIds } },
        select: {
          id: true,
          priceBookId: true,
          code: true,
          name: true,
          kind: true,
          calculationType: true,
          amount: true,
          includedUnits: true,
          incrementUnits: true,
          incrementAmount: true,
          minQty: true,
          maxQty: true,
          triggerCondition: true,
          exclusiveGroup: true,
          priority: true,
          sourceSheet: true,
          sourceRange: true,
          sourceName: true,
          sourceSha256: true,
          blocksAutomaticQuote: true,
          isActive: true,
          category: { select: { code: true, name: true } },
        },
        orderBy: [{ priceBookId: 'asc' }, { code: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const notes = new Map(books.map((book) => [book.id, book.notes]));
    return {
      priceVersion,
      processingNotes: notes.get(priceVersion.processing.id),
      logisticsNotes: notes.get(priceVersion.logistics.id),
      rules: rules as PublishedCreateOrderRuleRow[],
    };
  });
}

databaseDescribe.sequential('published create-order rule adapter · PostgreSQL contract', () => {
  it('projects the exact currently published v3 rows and evidence', async () => {
    const { at } = await readProjectionWindow(PROCESSING_BOOK_ID);
    const { snapshot, audit } = await db.$transaction((tx) =>
      readPublishedCreateOrderPriceProjection(tx, {
        now: at,
      }),
    );

    expect(snapshot.priceVersion).toEqual({
      processing: {
        id: PROCESSING_BOOK_ID,
        code: 'EXTERNAL_SALES_PROCESSING_RULES',
        version: 3,
        sourceSha256: PROCESSING_SOURCE_SHA,
      },
      logistics: {
        id: LOGISTICS_BOOK_ID,
        code: 'EXTERNAL_SALES_LOGISTICS_RULES',
        version: 2,
        sourceSha256: LOGISTICS_SOURCE_SHA,
      },
    });
    expect(audit.processingRuleCount).toBe(140);
    expect(audit.logisticsRuleCount).toBe(11);
    expect(audit.processingRuleCodes).toHaveLength(140);
    expect(audit.logisticsRuleCodes).toHaveLength(11);
    expect(audit.projectedRuleCodes.partialBlank).toHaveLength(26);
    expect(audit.projectedRuleCodes.fullTiers).toHaveLength(45);
    expect(audit.projectedRuleCodes.printBase).toHaveLength(38);
    expect(audit.projectedRuleCodes.printFoil).toHaveLength(8);

    expect(snapshot.full.unitPrices).toHaveLength(18);
    expect(snapshot.full.unitPrices.slice(-2)).toEqual([
      {
        tierCode: 'BASE_CUSTOM-MID_GTE_25001',
        pricingGroup: 'MID',
        minQuantity: 25_001,
        maxQuantity: null,
        unitPrice: '0.17',
      },
      {
        tierCode: 'BASE_CUSTOM-LARGE_GTE_25001',
        pricingGroup: 'LARGE',
        minQuantity: 25_001,
        maxQuantity: null,
        unitPrice: '0.19',
      },
    ]);
    expect(
      snapshot.full.unitPrices.some((tier) => tier.minQuantity === 40_001),
    ).toBe(false);
    expect(snapshot.full.westEnvelopeUnitSurcharge).toBe('0.06');
    expect(snapshot.full.basePapers).toEqual([
      { paperType: '红卡', paperWeightGsm: 160 },
      { paperType: '珠光艳闪', paperWeightGsm: 160 },
    ]);
    expect(snapshot.partial.blankUnitPrices).toContainEqual(
      expect.objectContaining({
        paperType: '珠光艳闪',
        paperWeightGsm: 160,
        specification: '西封大号',
      }),
    );
    expect(snapshot.print.perOrderPrices).toContainEqual(
      expect.objectContaining({ paperType: '铜版纸', paperWeightGsm: 200 }),
    );

    const chargeRules = snapshot.orderCharges.rules;
    const shippingRules = chargeRules.filter((rule) => rule.kind === 'SHIPPING');
    const cartonRules = chargeRules.filter((rule) => rule.kind === 'PACKAGING');
    expect(new Set(shippingRules.flatMap((rule) => rule.provinces))).toEqual(
      new Set(ZTO_PROVINCE_OPTIONS),
    );
    expect(new Set(shippingRules.map((rule) => rule.source.sha256))).toEqual(
      new Set([SHIPPING_SOURCE_SHA]),
    );
    expect(new Set(cartonRules.map((rule) => rule.source.sha256))).toEqual(
      new Set([CARTON_SOURCE_SHA]),
    );
    expect(audit.logisticsRuleCodes).toEqual(
      expect.arrayContaining(['ZTO_GUANGDONG', 'CARTON_Q3001_5000']),
    );
  });

  it('projects the published five-tier successor across the retired schedule boundary', async () => {
    const window = await readProjectionWindow(FIVE_TIER_PROCESSING_BOOK_ID);
    const retiredBook = await db.customerPriceBook.findUnique({
      where: { id: RETIRED_INCOMPATIBLE_PROCESSING_BOOK_ID },
      select: { effectiveFrom: true },
    });
    const projected = await db.$transaction((tx) =>
      readPublishedCreateOrderPriceProjection(tx, { now: window.at }),
    );
    const retiredBoundary = retiredBook?.effectiveFrom;
    const boundaryAt =
      retiredBoundary &&
      retiredBoundary >= window.start &&
      (window.end === null || retiredBoundary < window.end)
        ? retiredBoundary
        : window.at;
    const afterRetiredSchedule = await db.$transaction((tx) =>
      readPublishedCreateOrderPriceProjection(tx, {
        now: boundaryAt,
      }),
    );

    expect(projected.snapshot.priceVersion.processing).toEqual({
      id: FIVE_TIER_PROCESSING_BOOK_ID,
      code: 'EXTERNAL_SALES_PROCESSING_RULES',
      version: 4,
      sourceSha256: FIVE_TIER_PROCESSING_SOURCE_SHA,
    });
    expect(afterRetiredSchedule.snapshot.priceVersion.processing.id).toBe(
      FIVE_TIER_PROCESSING_BOOK_ID,
    );
    expect(projected.audit.processingRuleCount).toBe(145);
    expect(projected.audit.projectedRuleCodes.fullTiers).toHaveLength(50);
    expect(projected.snapshot.full.unitPrices).toHaveLength(20);
    expect(projected.snapshot.full.unitPrices.slice(-4)).toEqual([
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

    const quote = (pricingGroup: 'MID' | 'LARGE', specification: string) =>
      calculateCreateOrderQuote(
        createGoldenOrderInput([
          createGoldenOrderItem({
            craft: 'FULL',
            paperType: '珠光艳闪',
            paperWeightGsm: 160,
            specification,
            pricingGroup,
            quantity: 40_001,
            frontColors: ['哑金'],
            backColors: [],
          }),
        ]),
        projected.snapshot,
      ).items[0];

    expect(quote('MID', '中号封')).toMatchObject({
      status: 'QUOTED',
      unitPrice: '0.1600',
      processingAmount: '6400.16',
    });
    expect(quote('LARGE', '大号封')).toMatchObject({
      status: 'QUOTED',
      unitPrice: '0.1800',
      processingAmount: '7200.18',
    });
  });

  it('projects the exact release candidate with its effective-time counterpart and rejects the retired incompatible candidate', async () => {
    const { at: effectiveFrom } = await readProjectionWindow(
      FIVE_TIER_PROCESSING_BOOK_ID,
    );
    const candidate = await db.$transaction((tx) =>
      readCandidatePublishedCreateOrderPriceProjection(tx, {
        candidatePriceBookId: FIVE_TIER_PROCESSING_BOOK_ID,
        effectiveFrom,
      }),
    );

    expect(candidate.snapshot.priceVersion).toMatchObject({
      processing: { id: FIVE_TIER_PROCESSING_BOOK_ID },
      logistics: { id: LOGISTICS_BOOK_ID },
    });
    expect(candidate.audit.processingRuleCount).toBe(145);
    expect(candidate.audit.projectedRuleCodes.fullTiers).toHaveLength(50);

    const logisticsCandidate = await db.$transaction((tx) =>
      readCandidatePublishedCreateOrderPriceProjection(tx, {
        candidatePriceBookId: LOGISTICS_BOOK_ID,
        effectiveFrom,
      }),
    );
    expect(logisticsCandidate.snapshot.priceVersion).toMatchObject({
      processing: { id: FIVE_TIER_PROCESSING_BOOK_ID },
      logistics: { id: LOGISTICS_BOOK_ID },
    });

    const retiredCandidate = await db.customerPriceBook.findUnique({
      where: { id: RETIRED_INCOMPATIBLE_PROCESSING_BOOK_ID },
      select: { id: true },
    });
    await expect(
      db.$transaction((tx) =>
        readCandidatePublishedCreateOrderPriceProjection(tx, {
          candidatePriceBookId:
            retiredCandidate?.id ?? FRESH_INCOMPATIBLE_PROCESSING_BOOK_ID,
          effectiveFrom,
        }),
      ),
    ).rejects.toThrow('缺少局部烫金空白封单价');
  });

  it('preserves null versus zero and fails closed on duplicate or missing rules', async () => {
    const { at } = await readProjectionWindow(PROCESSING_BOOK_ID);
    const input = await readCurrentProjectionInput(at);
    const blank = input.rules.find(
      (rule) => rule.code === 'BASE_STOCK-PEARL-FLASH-160-MID',
    )!;

    const withAmount = (amount: unknown) => ({
      ...input,
      rules: input.rules.map((rule) =>
        rule.id === blank.id ? { ...rule, amount } : rule,
      ),
    });
    const nullProjection = projectPublishedCreateOrderPriceSnapshot(
      withAmount(null),
    );
    const zeroProjection = projectPublishedCreateOrderPriceSnapshot(
      withAmount('0'),
    );
    const projectedBlank = (projection: typeof nullProjection) =>
      projection.snapshot.partial.blankUnitPrices.find(
        (price) =>
          price.paperType === '珠光艳闪' &&
          price.paperWeightGsm === 160 &&
          price.specification === '中号封',
      )!;
    expect(projectedBlank(nullProjection).unitPrice).toBeNull();
    expect(projectedBlank(zeroProjection).unitPrice).toBe('0');

    expect(() =>
      projectPublishedCreateOrderPriceSnapshot({
        ...input,
        rules: [
          ...input.rules,
          { ...blank, id: `${blank.id}-duplicate`, code: `${blank.code}-DUP` },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_RULE' }));

    expect(() =>
      projectPublishedCreateOrderPriceSnapshot({
        ...input,
        rules: input.rules.filter(
          (rule) => rule.code !== 'PACKAGING_MIXED_STYLE_PER_BAG',
        ),
      }),
    ).toThrow(expect.objectContaining({ code: 'MISSING_RULE' }));

    const multiProvinceRule = input.rules.find(
      (rule) =>
        rule.priceBookId === LOGISTICS_BOOK_ID &&
        typeof rule.triggerCondition === 'object' &&
        rule.triggerCondition !== null &&
        Array.isArray(
          (rule.triggerCondition as { provinces?: unknown }).provinces,
        ) &&
        (
          (rule.triggerCondition as { provinces: unknown[] }).provinces.length
        ) > 1,
    )!;
    const condition = multiProvinceRule.triggerCondition as {
      carrierCode: string;
      provinces: string[];
    };
    expect(() =>
      projectPublishedCreateOrderPriceSnapshot({
        ...input,
        rules: input.rules.map((rule) =>
          rule.id === multiProvinceRule.id
            ? {
                ...rule,
                triggerCondition: {
                  ...condition,
                  provinces: condition.provinces.slice(1),
                },
              }
            : rule,
        ),
      }),
    ).toThrow(expect.objectContaining({ code: 'MISSING_RULE' }));
  });
});

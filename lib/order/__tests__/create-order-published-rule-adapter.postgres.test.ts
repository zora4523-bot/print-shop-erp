import 'dotenv/config';

import { describe, expect, it } from 'vitest';
import { db } from '../../db';
import { ZTO_PROVINCE_OPTIONS } from '../../price/external-order-charges';
import {
  projectPublishedCreateOrderPriceSnapshot,
  readPublishedCreateOrderPriceProjection,
  type PublishedCreateOrderPriceProjectionInput,
  type PublishedCreateOrderRuleRow,
} from '../create-order-published-rule-adapter';
import { readExternalCreateOrderPriceSnapshot } from '../create-order-price-snapshot';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;
const FIXED_CURRENT_TIME = new Date('2026-08-28T08:00:00.000Z');
const PROCESSING_BOOK_ID = 'cpb_external_processing_rule_v3';
const LOGISTICS_BOOK_ID = 'cpb_external_logistics_weight_policy_v3';
const PROCESSING_SOURCE_SHA =
  '3596993e283d1d06f01dd7048b6ccf2f1c0e4b27394541e004a37419c856d817';
const LOGISTICS_SOURCE_SHA =
  '7d3d0b6dddb2ee910046b3bc80f1d7fc8e35aa94dd25d5cf14f23c58a6ab8a69';
const SHIPPING_SOURCE_SHA =
  'a92088a9ba0093afcbb96c6b3b182ab29e4f7d675cacf929c6745987bf4d6060';
const CARTON_SOURCE_SHA =
  '9f0c30333a737ab9d36398b8af2c84ece599317f9df21af5dacb8f365fa5401b';

async function readCurrentProjectionInput(): Promise<PublishedCreateOrderPriceProjectionInput> {
  return db.$transaction(async (tx) => {
    const priceVersion = await readExternalCreateOrderPriceSnapshot(tx, {
      now: FIXED_CURRENT_TIME,
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
    const { snapshot, audit } = await db.$transaction((tx) =>
      readPublishedCreateOrderPriceProjection(tx, {
        now: FIXED_CURRENT_TIME,
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

  it('preserves null versus zero and fails closed on duplicate or missing rules', async () => {
    const input = await readCurrentProjectionInput();
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

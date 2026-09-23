import { describe, expect, it } from 'vitest';
import {
  suggestWorkbenchAmount,
  workbenchPricingReasons,
  workbenchQuoteSchema,
} from '../quote';
import type { CreateOrderManualReasonCode } from '@/lib/price/create-order/types';

describe('workbench markup', () => {
  it.each([
    ['365.00', 35, '492.75', '127.75'],
    ['0.10', 35, '0.14', '0.04'],
    ['170.00', 0, '170.00', '0.00'],
    ['170.00', 100, '340.00', '170.00'],
  ])(
    'prices %s at %s percent with decimal half-up rounding',
    (base, markup, suggestedAmount, markupAmount) => {
      expect(suggestWorkbenchAmount(base, markup)).toEqual({
        suggestedAmount,
        markupAmount,
      });
    },
  );
  it('does not turn unknown costs into zero or partial totals', () => {
    expect(suggestWorkbenchAmount(null, 35)).toEqual({
      suggestedAmount: null,
      markupAmount: null,
    });
  });
  it.each([0, -1, 1.5, Infinity, NaN, 10_000_000])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(
        workbenchQuoteSchema.safeParse({
          productId: 'p',
          specification: '大号封',
          paperType: '160g珠光艳闪',
          pricingRoute: 'STOCK_BLANK',
          quantity,
          frontFoilColors: ['哑金'],
          backFoilColors: [],
          foilTechnique: 'FLAT',
          markup: 35,
        }).success,
      ).toBe(false);
    },
  );
});

describe('workbench controlled pricing guidance', () => {
  it('projects only approved guidance and deduplicates repeated reasons', () => {
    const reasons = [
      {
        code: 'FULL_THREE_OR_MORE_COLORS' as const,
        message: 'private source details',
      },
      {
        code: 'FULL_THREE_OR_MORE_COLORS' as const,
        message: 'internal formula',
      },
      {
        code: 'FULL_PAPER_SURCHARGE_NOT_FOUND' as const,
        message: 'database payload',
      },
    ];
    expect(workbenchPricingReasons(reasons)).toEqual([
      '专版烫金三色及以上需要管理员核价',
      '所选纸张暂无专版烫金价格，请选择其他纸张或联系管理员核价',
    ]);
  });
  it('explains the ice-white administrator pricing policy', () => {
    expect(workbenchPricingReasons([{ code: 'FULL_ICE_WHITE_ADMIN_PRICING' }])).toEqual([
      '冰白珠光纸专版烫金由管理员手动核价，请提交工单后等待核价',
    ]);
  });
  it('uses a safe fallback for an empty or newly introduced engine reason', () => {
    const expected = ['该组合暂未取得完整加工费，请联系管理员核价'];
    expect(workbenchPricingReasons([])).toEqual(expected);
    expect(
      workbenchPricingReasons([
        { code: 'NEW_REASON' as CreateOrderManualReasonCode },
      ]),
    ).toEqual(expected);
  });
  it('keeps valid production facts available to the versioned engine', () => {
    const input = {
      productId: 'p',
      specification: '大号封',
      paperType: '160g珠光艳闪',
      pricingRoute: 'CUSTOM_SINGLE_FLAT_FOIL',
      quantity: 1000,
      frontFoilColors: ['哑金'],
      backFoilColors: ['银'],
      foilTechnique: 'FLAT',
      markup: 35,
    };
    expect(workbenchQuoteSchema.safeParse(input).success).toBe(true);
    expect(
      workbenchQuoteSchema.safeParse({ ...input, pricingRoute: 'COLOR_PRINT' })
        .success,
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { calculateCreateOrderQuote } from '../create-order';
import {
  CREATE_ORDER_GOLDEN_SNAPSHOT,
  createGoldenOrderInput,
  createGoldenOrderItem,
} from './fixtures/create-order-golden-fixtures';

describe('internal create pure quote contract', () => {
  it('quotes processing and BAGGING from the same snapshot without external charges', () => {
    const item = createGoldenOrderItem();
    const result = calculateCreateOrderQuote(
      {
        ...createGoldenOrderInput([item]),
        includeOrderCharges: false,
      },
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );

    expect(result).toMatchObject({
      status: 'PARTIAL',
      submittable: true,
      knownTotal: '180.00',
      total: null,
    });
    expect(result.packagingGroups[0]).toMatchObject({
      status: 'QUOTED',
      amount: '10.00',
    });
    expect(result.order.lines).toEqual([
      expect.objectContaining({
        code: 'PLATE_FEE',
        status: 'PENDING_AMOUNT',
        amount: null,
      }),
    ]);
    expect(result.pendingReasons.map((reason) => reason.code)).toContain(
      'PLATE_AMOUNT_PENDING',
    );
  });

  it('turns one non-empty configuration-outside note into typed manual pricing', () => {
    const item = createGoldenOrderItem({
      paperType: '',
      paperWeightGsm: null,
      specification: '',
      frontColors: [],
      manualPricingReason: '  客供云纹纸与特殊击凸  ',
    });
    const result = calculateCreateOrderQuote(
      {
        ...createGoldenOrderInput([item]),
        includeOrderCharges: false,
      },
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );

    expect(result.items[0]).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      amount: null,
      knownAmount: '0.00',
      manualReasons: [
        {
          code: 'CONFIGURATION_OUTSIDE_NOTE',
          message: '配置外项目：客供云纹纸与特殊击凸',
        },
      ],
    });
    expect(result.packagingGroups[0]).toMatchObject({
      status: 'EXCLUDED_MANUAL',
      amount: null,
      knownAmount: '0.00',
    });
    expect(result).toMatchObject({
      status: 'MANUAL_PRICING_REQUIRED',
      total: null,
      knownTotal: '0.00',
    });
  });

  it('rejects an explicitly supplied but blank configuration-outside note', () => {
    const item = createGoldenOrderItem({ manualPricingReason: '   ' });
    const result = calculateCreateOrderQuote(
      {
        ...createGoldenOrderInput([item]),
        includeOrderCharges: false,
      },
      CREATE_ORDER_GOLDEN_SNAPSHOT,
    );

    expect(result).toMatchObject({
      status: 'INVALID_INPUT',
      submittable: false,
      total: null,
    });
    expect(result.items[0]?.errors).toContain('配置外项目说明不能为空');
  });
});

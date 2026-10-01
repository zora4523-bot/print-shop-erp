import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_ORDER_GOLDEN_SNAPSHOT } from '@/lib/price/__tests__/fixtures/create-order-golden-fixtures';
import { createBlankItem } from '../order-item-configuration';

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), transaction: vi.fn(), papers: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { $transaction: mocks.transaction } }));
vi.mock('../create-order-published-rule-adapter', () => ({
  readPublishedCreateOrderPriceSnapshot: mocks.snapshot,
}));

import { quoteSampleOrder, SampleOrderError } from '../sample-order';

const tx = { material: { findMany: mocks.papers } };
function input(purpose: 'PROOF' | 'SAMPLE_SHIPMENT' = 'PROOF') {
  return {
    purpose, customerRef: null, receiverName: '测试', receiverPhone: '13800000000',
    receiverAddress: '浙江省测试地址', destinationProvince: '浙江', expressCode: null,
    packageRequirement: null, remark: null, isUrgent: false, isSfCollect: false,
    packagingGroups: [], additionalShipments: [],
    items: [{ ...createBlankItem([]), name: '样品', quantity: 2,
      ...(purpose === 'PROOF' ? {
        paperType: '珠光艳闪', paperWeightGsm: 160, specification: '大号封90×165',
        actualWidthMm: 90, actualHeightMm: 165, crafts: ['craft-1'],
      } : {
        pricingRoute: 'MANUAL_QUOTE', crafts: [], frontFoilColors: [],
        backFoilColors: [], foilColors: [], foilTechnique: 'NONE', hasLocalFoil: null, pack: null,
      }),
    }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.snapshot.mockResolvedValue(CREATE_ORDER_GOLDEN_SNAPSHOT);
  mocks.papers.mockResolvedValue([{
    id: 'paper', name: '珠光艳闪', specification: '160g', isActive: true, outOfStock: false,
  }]);
});

describe('proof preview uses the published blank sale gate', () => {
  it('reuses the quoted snapshot within the same transaction for admission', async () => {
    await expect(quoteSampleOrder(input())).resolves.toMatchObject({ total: null, knownTotal: '0.00' });
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(tx, { now: expect.any(Date) });
    expect(mocks.papers).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'stopped'])('rejects %s blank prices during preview', async (state) => {
    mocks.snapshot.mockResolvedValue({ ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: { ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial,
        blankUnitPrices: state === 'missing' ? [] : [{
          ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial.blankUnitPrices[0]!, unitPrice: '0',
        }],
      },
    });
    const result = quoteSampleOrder(input());
    await expect(result).rejects.toBeInstanceOf(SampleOrderError);
    await expect(result).rejects.toThrow('未启用');
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(mocks.papers).not.toHaveBeenCalled();
  });
  it('rejects an unavailable paper even with a positive published price', async () => {
    mocks.papers.mockResolvedValue([{
      id: 'paper', name: '珠光艳闪', specification: '160g', isActive: true, outOfStock: true,
    }]);
    await expect(quoteSampleOrder(input())).rejects.toThrow('缺货');
  });
  it('prices prepaid sample freight at the destination first weight', async () => {
    await expect(quoteSampleOrder(input('SAMPLE_SHIPMENT'))).resolves.toMatchObject({
      shippingAmount: '2.80', packagingAmount: '1.00', total: '3.80', errors: [],
    });
  });
  it('uses the remote first-weight fee rather than a flat default', async () => {
    const remote = { ...input('SAMPLE_SHIPMENT'), destinationProvince: '新疆' };
    await expect(quoteSampleOrder(remote)).resolves.toMatchObject({ shippingAmount: '12.00', total: '13.00' });
  });
  it('keeps freight pending, never free, when the province has no tariff', async () => {
    mocks.snapshot.mockResolvedValue({ ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      orderCharges: { ...CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges,
        rules: CREATE_ORDER_GOLDEN_SNAPSHOT.orderCharges.rules.filter((rule) => rule.code !== 'ZTO_STANDARD_2_8'),
      },
    });
    await expect(quoteSampleOrder(input('SAMPLE_SHIPMENT'))).resolves.toMatchObject({
      shippingAmount: null, total: null, knownTotal: '1.00',
    });
  });
  it('keeps sample shipment previews independent of blank sale availability', async () => {
    mocks.snapshot.mockResolvedValue({ ...CREATE_ORDER_GOLDEN_SNAPSHOT,
      partial: { ...CREATE_ORDER_GOLDEN_SNAPSHOT.partial, blankUnitPrices: [] },
    });
    await expect(quoteSampleOrder(input('SAMPLE_SHIPMENT'))).resolves.toHaveProperty('quoteToken');
    expect(mocks.papers).not.toHaveBeenCalled();
  });
});

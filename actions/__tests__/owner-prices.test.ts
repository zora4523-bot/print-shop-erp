import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { AdjustmentType } from '../../generated/prisma/enums';
import { UnauthorizedError } from '../../lib/auth/errors';

const {
  permissionsMock,
  priceMock,
  revalidatePathMock,
  redirectMock,
  MockPriceDictionaryInvariantError,
} = vi.hoisted(() => ({
  permissionsMock: { requirePermission: vi.fn() },
  priceMock: {
    createPriceTier: vi.fn(),
    updatePriceTier: vi.fn(),
    createPriceAdjustment: vi.fn(),
    updatePriceAdjustment: vi.fn(),
    setPriceAdjustmentActive: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  MockPriceDictionaryInvariantError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'PriceDictionaryInvariantError';
    }
  },
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: permissionsMock.requirePermission,
}));
vi.mock('@/lib/price', () => ({
  createPriceTier: priceMock.createPriceTier,
  updatePriceTier: priceMock.updatePriceTier,
  createPriceAdjustment: priceMock.createPriceAdjustment,
  updatePriceAdjustment: priceMock.updatePriceAdjustment,
  setPriceAdjustmentActive: priceMock.setPriceAdjustmentActive,
  PriceDictionaryInvariantError: MockPriceDictionaryInvariantError,
}));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import {
  createPriceAdjustmentAction,
  createPriceTierAction,
  setPriceAdjustmentActiveAction,
  updatePriceAdjustmentAction,
  updatePriceTierAction,
} from '../owner-prices';

const ownerActor = {
  id: 'actor-owner',
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  workerType: null,
  machineType: null,
};

const validTier = {
  productId: 'prod1',
  minQty: '1000',
  unitPrice: '0.1200',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-06-01',
};

const validAdjustment = {
  name: '烫金加价',
  adjustmentType: 'PER_SHEET',
  amount: '0.0300',
  triggerCondition:
    '{"craftIds":["craft-foil"],"craftMode":"ANY","unitsPerSheet":500}',
};

const fd = (data: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(data)) form.set(key, value);
  return form;
};

beforeEach(() => {
  permissionsMock.requirePermission.mockReset();
  priceMock.createPriceTier.mockReset();
  priceMock.updatePriceTier.mockReset();
  priceMock.createPriceAdjustment.mockReset();
  priceMock.updatePriceAdjustment.mockReset();
  priceMock.setPriceAdjustmentActive.mockReset();
  revalidatePathMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('createPriceTierAction', () => {
  it("first-line requirePermission('dict:price:manage')", async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(createPriceTierAction(null, fd(validTier))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(permissionsMock.requirePermission).toHaveBeenCalledWith('dict:price:manage');
    expect(priceMock.createPriceTier).not.toHaveBeenCalled();
  });

  it('passes parsed tier fields to lib.createPriceTier', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.createPriceTier.mockResolvedValue({ id: 'tier1' });

    await expect(createPriceTierAction(null, fd(validTier))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    expect(priceMock.createPriceTier).toHaveBeenCalledWith({
      productId: 'prod1',
      minQty: 1000,
      unitPrice: '0.1200',
      effectiveFrom: new Date('2025-12-31T16:00:00.000Z'),
      effectiveTo: new Date('2026-05-31T16:00:00.000Z'),
    });
    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/internal-pricing/tiers/tier1',
    );
  });

  it('rejects inverted effective windows at schema boundary', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createPriceTierAction(
      null,
      fd({ ...validTier, effectiveTo: '2025-12-31' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.effectiveTo).toContain(
        '有效截止日期必须晚于有效起始日期',
      );
    }
    expect(priceMock.createPriceTier).not.toHaveBeenCalled();
  });

  it('maps overlapping effective windows to field errors', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.createPriceTier.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('overlap', {
        code: 'P2004',
        clientVersion: 'test',
        meta: { constraint: 'PriceTier_product_minQty_effective_no_overlap' },
      }),
    );

    const result = await createPriceTierAction(null, fd(validTier));

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.effectiveFrom).toContain(
        '同一产品、同一起订量的有效期不能重叠',
      );
      expect(result.fieldErrors.effectiveTo).toContain(
        '同一产品、同一起订量的有效期不能重叠',
      );
    }
  });
});

describe('updatePriceTierAction', () => {
  it('maps invariant errors', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.updatePriceTier.mockRejectedValueOnce(
      new MockPriceDictionaryInvariantError('价格阶梯不存在'),
    );

    const result = await updatePriceTierAction('tier1', null, fd(validTier));
    expect(result.status).toBe('error');
  });

  it('revalidates price tier paths on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.updatePriceTier.mockResolvedValue({ id: 'tier1' });

    const result = await updatePriceTierAction('tier1', null, fd(validTier));

    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/internal-pricing',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/internal-pricing/tiers/tier1',
    );
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/owner/prices');
  });
});

describe('createPriceAdjustmentAction', () => {
  it('不向管理端暴露内部加价类型', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    const result = await createPriceAdjustmentAction(
      null,
      fd({
        ...validAdjustment,
        adjustmentType: 'INTERNAL_ADJUSTMENT_TYPE',
      }),
    );

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.adjustmentType).toContain(
        '请选择有效的加价类型',
      );
      const visibleErrors = JSON.stringify(result.fieldErrors);
      expect(visibleErrors).not.toContain('INTERNAL_ADJUSTMENT_TYPE');
      expect(visibleErrors).not.toContain('PER_ORDER');
      expect(visibleErrors).not.toContain('PER_PIECE');
      expect(visibleErrors).not.toContain('PER_SHEET');
    }
    expect(priceMock.createPriceAdjustment).not.toHaveBeenCalled();
  });

  it('rejects non-object triggerCondition JSON', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    const result = await createPriceAdjustmentAction(
      null,
      fd({ ...validAdjustment, triggerCondition: '[]' }),
    );
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.triggerCondition).toContain(
        '触发条件必须是 JSON object',
      );
    }
    expect(priceMock.createPriceAdjustment).not.toHaveBeenCalled();
  });

  it('parses object triggerCondition and redirects on create', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.createPriceAdjustment.mockResolvedValue({ id: 'adj1' });

    await expect(
      createPriceAdjustmentAction(null, fd(validAdjustment)),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(priceMock.createPriceAdjustment).toHaveBeenCalledWith({
      name: '烫金加价',
      adjustmentType: AdjustmentType.PER_SHEET,
      amount: '0.0300',
      triggerCondition: {
        craftIds: ['craft-foil'],
        craftMode: 'ANY',
        unitsPerSheet: 500,
      },
    });
    expect(redirectMock).toHaveBeenCalledWith(
      '/owner/rules/internal-pricing/adjustments/adj1',
    );
  });

  it.each([
    ['{"craft":"foil","unitsPerSheet":500}', '页面不支持的设置'],
    ['{"craftIds":"craft-foil","unitsPerSheet":500}', '限定工艺'],
    ['{"craftMode":"ALL","unitsPerSheet":500}', '请先选择至少一项工艺'],
    ['{"minQty":2000,"maxQty":1000,"unitsPerSheet":500}', '最小数量不能大于最大数量'],
    ['{"perFoilColor":1,"unitsPerSheet":500}', '按烫金颜色数量计费'],
    ['{}', '按张计价必须填写“每张可生产数量”'],
    ['{"unitsPerSheet":0}', '每张可生产数量”必须填写正整数'],
  ])(
    'rejects triggerCondition outside the quote contract: %s',
    async (triggerCondition, expectedMessage) => {
      permissionsMock.requirePermission.mockResolvedValue(ownerActor);

      const result = await createPriceAdjustmentAction(
        null,
        fd({ ...validAdjustment, triggerCondition }),
      );

      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.fieldErrors.triggerCondition?.join('\n')).toContain(
          expectedMessage,
        );
      }
      expect(priceMock.createPriceAdjustment).not.toHaveBeenCalled();
    },
  );

  it('accepts every supported trigger key with the quote-engine value types', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.createPriceAdjustment.mockResolvedValue({ id: 'adj-all-fields' });
    const triggerCondition = {
      productIds: ['product-1'],
      craftIds: ['craft-foil', 'craft-glue'],
      craftMode: 'ALL',
      specifications: ['大号'],
      paperTypes: ['艳红珠光纸'],
      foilColors: ['哑金'],
      isDoubleSided: true,
      isDoubleColor: false,
      minQty: 1000,
      maxQty: 5000,
      settlementTypes: ['EXTERNAL_SALES'],
      unitsPerSheet: 4,
      perFoilColor: true,
    };

    await expect(
      createPriceAdjustmentAction(
        null,
        fd({
          ...validAdjustment,
          triggerCondition: JSON.stringify(triggerCondition),
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(priceMock.createPriceAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ triggerCondition }),
    );
  });

  it('maps database JSON object constraint to triggerCondition field error', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.createPriceAdjustment.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('json object only', {
        code: 'P2004',
        clientVersion: 'test',
        meta: { constraint: 'PriceAdjustment_triggerCondition_object' },
      }),
    );

    const result = await createPriceAdjustmentAction(null, fd(validAdjustment));

    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.fieldErrors.triggerCondition).toContain(
        '触发条件必须是 JSON object',
      );
    }
  });
});

describe('updatePriceAdjustmentAction', () => {
  it('rejects an unknown trigger key before calling the update layer', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);

    const result = await updatePriceAdjustmentAction(
      'adj1',
      null,
      fd({
        ...validAdjustment,
        triggerCondition: '{"futureField":true,"unitsPerSheet":500}',
      }),
    );

    expect(result.status).toBe('invalid');
    expect(priceMock.updatePriceAdjustment).not.toHaveBeenCalled();
  });

  it('does not forward isActive through basic edit', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.updatePriceAdjustment.mockResolvedValue({ id: 'adj1' });

    await updatePriceAdjustmentAction(
      'adj1',
      null,
      fd({ ...validAdjustment, isActive: 'on' }),
    );

    const passed = priceMock.updatePriceAdjustment.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect('isActive' in passed).toBe(false);
  });
});

describe('setPriceAdjustmentActiveAction', () => {
  it('requires dict:price:manage', async () => {
    permissionsMock.requirePermission.mockImplementation(async () => {
      throw new UnauthorizedError('未登录');
    });
    await expect(setPriceAdjustmentActiveAction('adj1', false)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('revalidates adjustment paths on success', async () => {
    permissionsMock.requirePermission.mockResolvedValue(ownerActor);
    priceMock.setPriceAdjustmentActive.mockResolvedValue({ id: 'adj1' });

    const result = await setPriceAdjustmentActiveAction('adj1', false);

    expect(result.status).toBe('success');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/internal-pricing',
    );
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/rules/internal-pricing/adjustments/adj1',
    );
    expect(revalidatePathMock).not.toHaveBeenCalledWith('/owner/prices');
  });
});

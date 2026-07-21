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
  triggerCondition: '{"craft":"foil"}',
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
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(redirectMock).toHaveBeenCalledWith('/owner/prices/tiers/tier1');
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
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/prices');
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/prices/tiers/tier1');
  });
});

describe('createPriceAdjustmentAction', () => {
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
      triggerCondition: { craft: 'foil' },
    });
    expect(redirectMock).toHaveBeenCalledWith('/owner/prices/adjustments/adj1');
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
    expect(revalidatePathMock).toHaveBeenCalledWith('/owner/prices');
    expect(revalidatePathMock).toHaveBeenCalledWith(
      '/owner/prices/adjustments/adj1',
    );
  });
});

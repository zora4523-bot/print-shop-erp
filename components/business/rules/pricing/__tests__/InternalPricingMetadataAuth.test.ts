import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const {
  getSessionMock,
  getPriceTierSummaryMock,
  getPriceAdjustmentSummaryMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getPriceTierSummaryMock: vi.fn(),
  getPriceAdjustmentSummaryMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: vi.fn() }));
vi.mock('@/lib/price', () => ({
  getPriceTierSummary: getPriceTierSummaryMock,
  getPriceAdjustmentSummary: getPriceAdjustmentSummaryMock,
}));
vi.mock('@/lib/product', () => ({ listProductOptions: vi.fn() }));
vi.mock('@/lib/craft', () => ({ listCrafts: vi.fn() }));
vi.mock('@/actions/owner-prices', () => ({
  updatePriceTierAction: vi.fn(),
  updatePriceAdjustmentAction: vi.fn(),
  setPriceAdjustmentActiveAction: vi.fn(),
}));
vi.mock('@/components/business/price/PriceTierForm', () => ({
  PriceTierForm: vi.fn(),
}));
vi.mock('@/components/business/price/PriceAdjustmentForm', () => ({
  PriceAdjustmentForm: vi.fn(),
}));
vi.mock(
  '@/components/business/price/TogglePriceAdjustmentActiveButton',
  () => ({ TogglePriceAdjustmentActiveButton: vi.fn() }),
);
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

import { generateMetadata as getAdjustmentMetadata } from '../EditInternalPriceAdjustmentPage';
import { generateMetadata as getTierMetadata } from '../EditInternalPriceTierPage';

function session(role: Role) {
  return { user: { id: `${role.toLowerCase()}-1`, role } };
}

beforeEach(() => {
  getSessionMock.mockReset();
  getPriceTierSummaryMock.mockReset();
  getPriceAdjustmentSummaryMock.mockReset();
});

describe('internal pricing metadata authorization', () => {
  it.each([
    [
      '价格阶梯',
      getTierMetadata,
      getPriceTierSummaryMock,
      'tier-private',
    ],
    [
      '加价规则',
      getAdjustmentMetadata,
      getPriceAdjustmentSummaryMock,
      'adjustment-private',
    ],
  ] as const)('未登录时 %s metadata 不读取业务实体', async (title, helper, loader, id) => {
    getSessionMock.mockResolvedValue(null);

    await expect(
      helper({ params: Promise.resolve({ id }) }),
    ).resolves.toEqual({ title });
    expect(loader).not.toHaveBeenCalled();
  });

  it.each([
    [
      '价格阶梯',
      getTierMetadata,
      getPriceTierSummaryMock,
      'tier-private',
    ],
    [
      '加价规则',
      getAdjustmentMetadata,
      getPriceAdjustmentSummaryMock,
      'adjustment-private',
    ],
  ] as const)('已登录但无权限时 %s metadata 同样不读取业务实体', async (title, helper, loader, id) => {
    getSessionMock.mockResolvedValue(session(Role.SALES));

    await expect(
      helper({ params: Promise.resolve({ id }) }),
    ).resolves.toEqual({ title });
    expect(loader).not.toHaveBeenCalled();
  });

  it('有管理权限时保留动态标题', async () => {
    getSessionMock.mockResolvedValue(session(Role.ADMIN));
    getPriceTierSummaryMock.mockResolvedValue({
      product: { name: '现货大号（产品表!C2）' },
    });
    getPriceAdjustmentSummaryMock.mockResolvedValue({
      name: '局部烫金加价（价格表!B13）',
    });

    await expect(
      getTierMetadata({ params: Promise.resolve({ id: 'tier-1' }) }),
    ).resolves.toEqual({ title: '编辑 现货大号 价格阶梯' });
    await expect(
      getAdjustmentMetadata({
        params: Promise.resolve({ id: 'adjustment-1' }),
      }),
    ).resolves.toEqual({ title: '编辑 局部烫金加价 · 加价规则' });

    expect(getPriceTierSummaryMock).toHaveBeenCalledWith('tier-1');
    expect(getPriceAdjustmentSummaryMock).toHaveBeenCalledWith(
      'adjustment-1',
    );
  });
});

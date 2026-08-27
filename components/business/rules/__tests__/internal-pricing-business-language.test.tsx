import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdjustmentType } from '@/generated/prisma/enums';

const {
  getPriceAdjustmentSummaryMock,
  listCraftsMock,
  listProductOptionsMock,
  requirePermissionMock,
} = vi.hoisted(() => ({
  getPriceAdjustmentSummaryMock: vi.fn(),
  listCraftsMock: vi.fn(),
  listProductOptionsMock: vi.fn(),
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/craft', () => ({ listCrafts: listCraftsMock }));
vi.mock('@/lib/product', () => ({
  listProductOptions: listProductOptionsMock,
}));
vi.mock('@/lib/price', () => ({
  getPriceAdjustmentSummary: getPriceAdjustmentSummaryMock,
}));
vi.mock('@/actions/owner-prices', () => ({
  createPriceAdjustmentAction: vi.fn(async () => ({ status: 'success' })),
  updatePriceAdjustmentAction: vi.fn(async () => ({ status: 'success' })),
}));
vi.mock(
  '@/components/business/price/TogglePriceAdjustmentActiveButton',
  () => ({ TogglePriceAdjustmentActiveButton: () => null }),
);
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

import EditInternalPriceAdjustmentPage from '../pricing/EditInternalPriceAdjustmentPage';
import NewInternalPriceAdjustmentPage from '../pricing/NewInternalPriceAdjustmentPage';

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
  listCraftsMock.mockReset();
  listProductOptionsMock.mockReset().mockResolvedValue([]);
  getPriceAdjustmentSummaryMock.mockReset();
});

describe('internal pricing craft option labels', () => {
  it('shows only the Chinese craft name on create', async () => {
    const internalCode = 'INTERNAL_CRAFT_CODE';
    listCraftsMock.mockResolvedValue([
      {
        id: 'craft-1',
        code: internalCode,
        name: '局部烫金',
        isActive: true,
      },
    ]);

    const html = renderToStaticMarkup(
      await NewInternalPriceAdjustmentPage(),
    );

    expect(html).toContain('返回内部直单价格');
    expect(html).not.toContain('内部兼容');
    expect(html).toContain('局部烫金');
    expect(html).not.toContain(internalCode);
  });

  it('keeps the inactive hint but not the internal code on edit', async () => {
    const internalCode = 'INTERNAL_CRAFT_CODE';
    getPriceAdjustmentSummaryMock.mockResolvedValue({
      id: 'adjustment-1',
      name: '局部烫金加价',
      adjustmentType: AdjustmentType.PER_ORDER,
      amount: '90',
      triggerCondition: { craftIds: ['craft-1'] },
      isActive: true,
      updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    listCraftsMock.mockResolvedValue([
      {
        id: 'craft-1',
        code: internalCode,
        name: '局部烫金',
        isActive: false,
      },
    ]);

    const html = renderToStaticMarkup(
      await EditInternalPriceAdjustmentPage({
        params: Promise.resolve({ id: 'adjustment-1' }),
      }),
    );

    expect(html).toContain('局部烫金（已停用）');
    expect(html).not.toContain(internalCode);
  });

  it('hides imported workbook coordinates from product options', async () => {
    listProductOptionsMock.mockResolvedValue([
      {
        id: 'product-1',
        code: 'PRD-1',
        name: '现货大号（产品表!C2）',
        isActive: true,
      },
    ]);
    listCraftsMock.mockResolvedValue([]);

    const html = renderToStaticMarkup(
      await NewInternalPriceAdjustmentPage(),
    );

    expect(html).toContain('PRD-1 · 现货大号');
    expect(html).not.toContain('产品表!C2');
  });
});

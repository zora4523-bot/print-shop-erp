import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAdjustmentsMock, listTiersMock, requirePermissionMock } = vi.hoisted(
  () => ({
    listAdjustmentsMock: vi.fn(),
    listTiersMock: vi.fn(),
    requirePermissionMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock('@/lib/price', () => ({
  listPriceAdjustments: listAdjustmentsMock,
  listPriceTiers: listTiersMock,
}));

import OwnerPricesPage from '@/app/(admin)/owner/prices/page';

beforeEach(() => {
  requirePermissionMock.mockReset();
  listAdjustmentsMock.mockReset();
  listTiersMock.mockReset();
  requirePermissionMock.mockResolvedValue({ id: 'admin-1' });
  listAdjustmentsMock.mockResolvedValue([]);
  listTiersMock.mockResolvedValue([]);
});

describe('owner price management entry', () => {
  it('uses one external-sales entry and collapses legacy internal prices by default', async () => {
    const html = renderToStaticMarkup(
      await OwnerPricesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(requirePermissionMock).toHaveBeenCalledWith('dict:price:manage');
    expect(html).toContain('报价管理');
    expect(
      html.match(/href="\/owner\/prices\/external-sales\/items"/g),
    ).toHaveLength(1);
    expect(html).not.toContain('/owner/prices/external-sales/logistics');
    expect(html).toContain('外部销售报价管理');
    expect(html).toContain('内部销售/工厂直单兼容价格（低频）');
    expect(html).toContain('内部销售/工厂直单价格阶梯');
    expect(html).toContain('内部销售/工厂直单加价规则');
    const lowFrequencyDetails = html.match(/<details\b[^>]*>/)?.[0];
    expect(lowFrequencyDetails).toBeDefined();
    expect(lowFrequencyDetails).not.toMatch(/\sopen(?:=|\s|>)/);
    expect(lowFrequencyDetails).toContain('group');
    expect(html).toContain('min-h-11');
  });

  it('opens the internal compatibility area when an internal-price search is active', async () => {
    const html = renderToStaticMarkup(
      await OwnerPricesPage({
        searchParams: Promise.resolve({ q: '红包' }),
      }),
    );

    expect(listTiersMock).toHaveBeenCalledWith({ q: '红包' });
    expect(listAdjustmentsMock).toHaveBeenCalledWith({ q: '红包' });
    expect(html.match(/<details\b[^>]*>/)?.[0]).toMatch(/\sopen=""/);
  });
});

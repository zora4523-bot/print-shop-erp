import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const { getSessionMock, getProductSummaryMock, getBomDetailMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    getProductSummaryMock: vi.fn(),
    getBomDetailMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/session', () => ({
  getSession: getSessionMock,
}));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: vi.fn(),
}));
vi.mock('@/lib/product', () => ({
  getProductSummary: getProductSummaryMock,
  listProductCategoryOptions: vi.fn(),
  listProductCategoryNodes: vi.fn(),
  categoryChainLabelMap: vi.fn(() => new Map()),
}));
vi.mock('@/lib/bom', () => ({
  getBomDetail: getBomDetailMock,
}));
vi.mock('@/actions/owner-products', () => ({
  updateProductAction: vi.fn(),
}));
vi.mock('@/components/business/product/ProductForm', () => ({
  ProductForm: () => null,
}));
vi.mock('@/components/business/product/ToggleActiveButton', () => ({
  ToggleActiveButton: () => null,
}));
vi.mock('@/components/business/bom/ToggleBomActiveButton', () => ({
  ToggleBomActiveButton: () => null,
}));
vi.mock('@/components/ui/badge', () => ({
  Badge: () => null,
}));
vi.mock('@/components/ui-business', () => ({
  PageHeader: () => null,
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

import { generateMetadata as generateProductMetadata } from '@/app/(admin)/owner/products/[id]/page';
import { generateMetadata as generateBomMetadata } from '@/app/(admin)/owner/boms/[id]/page';

function session(role: Role) {
  return {
    user: {
      id: `${role.toLowerCase()}-1`,
      role,
    },
  };
}

beforeEach(() => {
  getSessionMock.mockReset();
  getProductSummaryMock.mockReset();
  getBomDetailMock.mockReset();
});

describe('owner 详情页 metadata 权限边界', () => {
  it('未登录时只返回通用标题，不查产品或 BOM', async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(
      generateProductMetadata({
        params: Promise.resolve({ id: 'product-private' }),
      }),
    ).resolves.toEqual({ title: '产品字典' });
    await expect(
      generateBomMetadata({ params: Promise.resolve({ id: 'bom-private' }) }),
    ).resolves.toEqual({ title: 'BOM/用料' });

    expect(getProductSummaryMock).not.toHaveBeenCalled();
    expect(getBomDetailMock).not.toHaveBeenCalled();
  });

  it('已登录但无管理权限时也不查实体', async () => {
    getSessionMock.mockResolvedValue(session(Role.SALES));

    await expect(
      generateProductMetadata({
        params: Promise.resolve({ id: 'product-private' }),
      }),
    ).resolves.toEqual({ title: '产品字典' });
    await expect(
      generateBomMetadata({ params: Promise.resolve({ id: 'bom-private' }) }),
    ).resolves.toEqual({ title: 'BOM/用料' });

    expect(getProductSummaryMock).not.toHaveBeenCalled();
    expect(getBomDetailMock).not.toHaveBeenCalled();
  });

  it('有权限时才读产品名生成标题', async () => {
    getSessionMock.mockResolvedValue(session(Role.ADMIN));
    getProductSummaryMock.mockResolvedValue({ name: '烫金红包' });

    await expect(
      generateProductMetadata({ params: Promise.resolve({ id: 'product-1' }) }),
    ).resolves.toEqual({ title: '编辑 烫金红包 · 产品字典' });
    expect(getProductSummaryMock).toHaveBeenCalledOnce();
    expect(getProductSummaryMock).toHaveBeenCalledWith('product-1');
  });

  it('有权限时才读 BOM 名生成标题', async () => {
    getSessionMock.mockResolvedValue(session(Role.ADMIN));
    getBomDetailMock.mockResolvedValue({ name: '通用红包用料 v2' });

    await expect(
      generateBomMetadata({ params: Promise.resolve({ id: 'bom-1' }) }),
    ).resolves.toEqual({ title: '通用红包用料 v2 · BOM/用料' });
    expect(getBomDetailMock).toHaveBeenCalledOnce();
    expect(getBomDetailMock).toHaveBeenCalledWith('bom-1');
  });
});

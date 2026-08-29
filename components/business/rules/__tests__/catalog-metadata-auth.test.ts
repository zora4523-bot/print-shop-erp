import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaterialCategory, Role } from '@/generated/prisma/enums';

const {
  getSessionMock,
  getMaterialSummaryMock,
  getCraftSummaryMock,
  getProductCategoryNodeSummaryMock,
  requirePermissionMock,
  listMaterialLocationStocksMock,
  listActiveWarehouseLocationOptionsMock,
  redirectMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getMaterialSummaryMock: vi.fn(),
  getCraftSummaryMock: vi.fn(),
  getProductCategoryNodeSummaryMock: vi.fn(),
  requirePermissionMock: vi.fn(),
  listMaterialLocationStocksMock: vi.fn(),
  listActiveWarehouseLocationOptionsMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/auth/session', () => ({ getSession: getSessionMock }));
vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));
vi.mock('@/lib/material', () => ({
  getMaterialSummary: getMaterialSummaryMock,
  listMaterialLocationStocks: listMaterialLocationStocksMock,
  listMaterialsPage: vi.fn(),
  MATERIAL_CATEGORY_LABELS: {},
  MATERIAL_LIST_SORT_KEYS: [],
}));
vi.mock('@/lib/craft', () => ({
  getCraftSummary: getCraftSummaryMock,
  isRetiredCraft: vi.fn(() => false),
  listCraftsPage: vi.fn(),
}));
vi.mock('@/lib/product', () => ({
  getProductCategoryNodeSummary: getProductCategoryNodeSummaryMock,
  isRetiredProductCategory: vi.fn(() => false),
  listProductCategoryNodes: vi.fn(),
}));
vi.mock('@/actions/owner-materials', () => ({
  createMaterialAction: vi.fn(),
  createNonPaperMaterialAction: vi.fn(),
  createMaterialTransactionAction: vi.fn(),
  createPaperAction: vi.fn(),
  createPaperTransactionAction: vi.fn(),
  setPaperActiveAction: vi.fn(),
  updateMaterialAction: vi.fn(),
  updatePaperAction: vi.fn(),
}));
vi.mock('@/actions/owner-crafts', () => ({
  createRuleCenterCraftAction: vi.fn(),
  updateCraftAction: vi.fn(),
}));
vi.mock('@/actions/owner-product-categories', () => ({
  createRuleCenterProductCategoryNodeAction: vi.fn(),
  updateProductCategoryNodeAction: vi.fn(),
}));
vi.mock('@/lib/warehouse', () => ({
  listActiveWarehouseLocationOptions: listActiveWarehouseLocationOptionsMock,
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  redirect: redirectMock,
}));

import { getCraftCatalogMetadata } from '../catalog/CraftCatalogPages';
import {
  EditMaterialCatalogItem,
  getMaterialCatalogMetadata,
} from '../catalog/MaterialCatalogPages';
import { getProductCategoryCatalogMetadata } from '../catalog/ProductCategoryCatalogPages';

function session(role: Role) {
  return { user: { id: `${role.toLowerCase()}-1`, role } };
}

beforeEach(() => {
  getSessionMock.mockReset();
  getMaterialSummaryMock.mockReset();
  getCraftSummaryMock.mockReset();
  getProductCategoryNodeSummaryMock.mockReset();
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
  listMaterialLocationStocksMock.mockReset();
  listActiveWarehouseLocationOptionsMock.mockReset();
  redirectMock.mockReset().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('rule catalog metadata authorization', () => {
  it.each([
    ['纸张', getMaterialCatalogMetadata, getMaterialSummaryMock],
    ['建单工艺目录', getCraftCatalogMetadata, getCraftSummaryMock],
    [
      '产品结构分类',
      getProductCategoryCatalogMetadata,
      getProductCategoryNodeSummaryMock,
    ],
  ] as const)(
    '未登录时 %s metadata 不读取业务实体',
    async (title, helper, lookup) => {
      getSessionMock.mockResolvedValue(null);

      await expect(
        helper({ params: Promise.resolve({ id: 'private-id' }) }),
      ).resolves.toEqual({ title });
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('已登录但无管理权限时同样不查名称', async () => {
    getSessionMock.mockResolvedValue(session(Role.SALES));

    await expect(
      getMaterialCatalogMetadata({
        params: Promise.resolve({ id: 'paper-private' }),
      }),
    ).resolves.toEqual({ title: '纸张' });
    await expect(
      getCraftCatalogMetadata({
        params: Promise.resolve({ id: 'craft-private' }),
      }),
    ).resolves.toEqual({ title: '建单工艺目录' });

    expect(getMaterialSummaryMock).not.toHaveBeenCalled();
    expect(getCraftSummaryMock).not.toHaveBeenCalled();
  });

  it('管理员权限通过后才读取名称', async () => {
    getSessionMock.mockResolvedValue(session(Role.ADMIN));
    getMaterialSummaryMock.mockResolvedValue({ name: '触感纸（烫金!B13）' });
    getCraftSummaryMock.mockResolvedValue({ name: '局部烫金' });

    await expect(
      getMaterialCatalogMetadata({
        params: Promise.resolve({ id: 'paper-1' }),
      }),
    ).resolves.toEqual({ title: '编辑 触感纸 · 纸张' });
    await expect(
      getCraftCatalogMetadata({
        params: Promise.resolve({ id: 'craft-1' }),
      }),
    ).resolves.toEqual({ title: '编辑 局部烫金 · 建单工艺目录' });

    expect(getMaterialSummaryMock).toHaveBeenCalledWith('paper-1');
    expect(getCraftSummaryMock).toHaveBeenCalledWith('craft-1');
  });

  it('旧物料详情命中纸张时在读库存前安全跳到规则中心', async () => {
    getMaterialSummaryMock.mockResolvedValue({
      id: 'paper-1',
      category: MaterialCategory.PAPER,
    });

    await expect(
      EditMaterialCatalogItem({
        params: Promise.resolve({ id: 'paper-1' }),
        routeBase: '/owner/materials',
        redirectCategory: MaterialCategory.PAPER,
        redirectBase: '/owner/rules/papers',
      }),
    ).rejects.toThrow('NEXT_REDIRECT:/owner/rules/papers/paper-1');

    expect(requirePermissionMock).toHaveBeenCalledWith('material:manage');
    expect(listActiveWarehouseLocationOptionsMock).not.toHaveBeenCalled();
    expect(listMaterialLocationStocksMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@/generated/prisma/enums';

const {
  getSessionMock,
  getProductSummaryMock,
  getBomDetailMock,
  getUserSummaryMock,
} = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    getProductSummaryMock: vi.fn(),
    getBomDetailMock: vi.fn(),
    getUserSummaryMock: vi.fn(),
  }),
);

vi.mock('@/lib/db', () => ({ db: {} }));

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
vi.mock('@/lib/account', () => ({
  getUserSummary: getUserSummaryMock,
}));
vi.mock('@/actions/owner-products', () => ({
  createQuoteProductAction: vi.fn(),
  setQuoteProductActiveAction: vi.fn(),
  updateQuoteProductAction: vi.fn(),
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
vi.mock('@/actions/owner-accounts', () => ({
  updateUserAction: vi.fn(),
}));
vi.mock('@/components/business/account/AccountForm', () => ({
  AccountForm: () => null,
}));
vi.mock('@/components/business/account/ResetPasswordForm', () => ({
  ResetPasswordForm: () => null,
}));
vi.mock('@/components/business/account/ToggleActiveButton', () => ({
  ToggleActiveButton: () => null,
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

import { generateMetadata as generateProductMetadata } from '@/app/(admin)/owner/rules/product-categories/items/[id]/page';
import { generateMetadata as generateBomMetadata } from '@/app/(admin)/owner/boms/[id]/page';
import { generateMetadata as generateAccountMetadata } from '@/app/(admin)/owner/accounts/[id]/page';

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
  getUserSummaryMock.mockReset();
});

describe('owner 详情页 metadata 权限边界', () => {
  it('未登录时只返回通用标题，不查管理实体', async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(
      generateProductMetadata({
        params: Promise.resolve({ id: 'product-private' }),
      }),
    ).resolves.toEqual({ title: '产品资料' });
    await expect(
      generateBomMetadata({ params: Promise.resolve({ id: 'bom-private' }) }),
    ).resolves.toEqual({ title: 'BOM/用料' });
    await expect(
      generateAccountMetadata({
        params: Promise.resolve({ id: 'account-private' }),
      }),
    ).resolves.toEqual({ title: '账号管理' });

    expect(getProductSummaryMock).not.toHaveBeenCalled();
    expect(getBomDetailMock).not.toHaveBeenCalled();
    expect(getUserSummaryMock).not.toHaveBeenCalled();
  });

  it('已登录但无管理权限时也不查实体', async () => {
    getSessionMock.mockResolvedValue(session(Role.SALES));

    await expect(
      generateProductMetadata({
        params: Promise.resolve({ id: 'product-private' }),
      }),
    ).resolves.toEqual({ title: '产品资料' });
    await expect(
      generateBomMetadata({ params: Promise.resolve({ id: 'bom-private' }) }),
    ).resolves.toEqual({ title: 'BOM/用料' });
    await expect(
      generateAccountMetadata({
        params: Promise.resolve({ id: 'account-private' }),
      }),
    ).resolves.toEqual({ title: '账号管理' });

    expect(getProductSummaryMock).not.toHaveBeenCalled();
    expect(getBomDetailMock).not.toHaveBeenCalled();
    expect(getUserSummaryMock).not.toHaveBeenCalled();
  });

  it('有权限时才读产品名生成标题', async () => {
    getSessionMock.mockResolvedValue(session(Role.ADMIN));
    getProductSummaryMock.mockResolvedValue({ name: '烫金红包' });

    await expect(
      generateProductMetadata({ params: Promise.resolve({ id: 'product-1' }) }),
    ).resolves.toEqual({ title: '编辑 烫金红包 · 产品资料' });
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

  it('有权限时才读用户姓名生成账号标题', async () => {
    getSessionMock.mockResolvedValue(session(Role.ADMIN));
    getUserSummaryMock.mockResolvedValue({ displayName: '王师傅' });

    await expect(
      generateAccountMetadata({ params: Promise.resolve({ id: 'account-1' }) }),
    ).resolves.toEqual({ title: '编辑 王师傅 · 账号管理' });
    expect(getUserSummaryMock).toHaveBeenCalledOnce();
    expect(getUserSummaryMock).toHaveBeenCalledWith('account-1');
  });
});

vi.mock('@/lib/order/external-sales-association', () => ({ listExternalSalesAccountOptions: listSalesAccountsMock }));
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCategory, Role } from '@/generated/prisma/enums';

const {
  externalBootstrapMock,
  listCraftsMock,
  listSalesAccountsMock,
  orderFormPropsMock,
  redirectMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  externalBootstrapMock: vi.fn(),
  listCraftsMock: vi.fn(),
  listSalesAccountsMock: vi.fn(),
  orderFormPropsMock: vi.fn(),
  redirectMock: vi.fn(),
  requireSessionMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/craft', () => ({
  listActiveCraftOrderOptions: listCraftsMock,
}));
vi.mock('@/lib/order/create-order-bootstrap', () => ({
  loadExternalCreateOrderBootstrap: externalBootstrapMock,
}));
vi.mock('@/components/business/order/OrderCreationWorkspace', () => ({
  OrderCreationWorkspace: (props: unknown) => {
    orderFormPropsMock(props);
    return <div data-order-form />;
  },
}));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import NewOrderPage from '@/app/(admin)/orders/new/page';

describe('new-order price catalog binding', () => {
  const currentPriceBookProducts = [
    {
      id: 'price-book-product',
      code: 'PRD-000042',
      name: '当前价目 SKU',
      category: ProductCategory.CUSTOM_FLAT_FOIL,
      specification: '大号封90×165',
      paperType: '160g珠光艳闪',
    },
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    listCraftsMock.mockResolvedValue([]);
    listSalesAccountsMock.mockResolvedValue([{ id: 'sales-2', displayName: '外部销售', username: 'sales-2' }]);
    externalBootstrapMock.mockResolvedValue({
      options: {
        products: currentPriceBookProducts,
        papers: [],
        specifications: [],
        foilColors: [],
      },
      priceSnapshot: {
        processing: { purpose: 'PROCESSING', id: 'p', code: 'P', name: '加工', version: 2, sourceSha256: 'a'.repeat(64) },
        logistics: { purpose: 'LOGISTICS', id: 'l', code: 'L', name: '物流', version: 3, sourceSha256: 'b'.repeat(64) },
      },
    });
  });

  it('外部销售建单使用同一快照下的全部合法配置选项与双价目版本', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.SALES },
    });

    renderToStaticMarkup(await NewOrderPage());

    expect(externalBootstrapMock).toHaveBeenCalledOnce();
    expect(orderFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: currentPriceBookProducts,
        externalCreateOrderOptions: expect.objectContaining({
          products: currentPriceBookProducts,
        }),
        initialExternalPriceSnapshot: expect.objectContaining({
          processing: expect.objectContaining({ version: 2 }),
          logistics: expect.objectContaining({ version: 3 }),
        }),
      }),
    );
  });

  it('管理员代建与外部销售使用同一已发布配置快照，并必须选择外部销售', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });

    renderToStaticMarkup(await NewOrderPage());

    expect(externalBootstrapMock).toHaveBeenCalledOnce();
    expect(orderFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: currentPriceBookProducts,
        externalSalesAccounts: [{ id: 'sales-2', displayName: '外部销售', username: 'sales-2' }],
        externalCreateOrderOptions: expect.objectContaining({
          products: currentPriceBookProducts,
        }),
        initialExternalPriceSnapshot: expect.objectContaining({
          processing: expect.objectContaining({ version: 2 }),
          logistics: expect.objectContaining({ version: 3 }),
        }),
      }),
    );
  });

  it('没有启用的外部销售账号时管理员看到明确提示，不渲染建单表单', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });
    listSalesAccountsMock.mockResolvedValue([]);

    const html = renderToStaticMarkup(await NewOrderPage());

    expect(html).toContain('暂无可关联的外部销售账号');
    expect(html).toContain('href="/owner/accounts"');
    expect(orderFormPropsMock).not.toHaveBeenCalled();
    expect(externalBootstrapMock).not.toHaveBeenCalled();
  });

  it('销售与管理员以外的角色回到工单列表', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'worker-1', role: Role.WORKER },
    });
    redirectMock.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });

    await expect(NewOrderPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/orders');
  });
});

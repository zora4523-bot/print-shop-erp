vi.mock('@/lib/order/external-sales-association', () => ({ listExternalSalesAccountOptions: vi.fn().mockResolvedValue([{ id: 'sales-2', displayName: '外部销售', username: 'sales-2' }]) }));
vi.mock('@/lib/order/sales-customer-scope', () => ({ listSalesCustomerOptions: vi.fn().mockResolvedValue([]) }));
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCategory, Role } from '@/generated/prisma/enums';

const {
  externalBootstrapMock,
  listCraftsMock,
  listCustomersMock,
  orderFormPropsMock,
  redirectMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  externalBootstrapMock: vi.fn(),
  listCraftsMock: vi.fn(),
  listCustomersMock: vi.fn(),
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
vi.mock('@/lib/party', () => ({
  listCustomerPartyOptions: listCustomersMock,
}));
vi.mock('@/components/business/order/OrderForm', () => ({
  OrderForm: (props: unknown) => {
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
    listCustomersMock.mockResolvedValue([]);
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
        settlementType: 'EXTERNAL_SALES',
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

  it('工厂直单与外部销售使用同一已发布配置快照', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });

    renderToStaticMarkup(await NewOrderPage());

    expect(externalBootstrapMock).toHaveBeenCalledOnce();
    expect(orderFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: currentPriceBookProducts,
        settlementType: 'FACTORY_DIRECT',
        customers: [],
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
});

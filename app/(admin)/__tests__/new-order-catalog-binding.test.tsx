import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCategory, Role } from '@/generated/prisma/enums';

const {
  activeProductsMock,
  externalBootstrapMock,
  listCraftsMock,
  listCustomersMock,
  orderFormPropsMock,
  redirectMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  activeProductsMock: vi.fn(),
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
vi.mock('@/lib/product', () => ({
  listActiveProductOrderOptions: activeProductsMock,
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
  const unreferencedProducts = [
    {
      ...currentPriceBookProducts[0],
      id: 'unreferenced-product',
      code: 'EXT-UNREFERENCED',
      name: '未被当前价目引用',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    listCraftsMock.mockResolvedValue([]);
    listCustomersMock.mockResolvedValue([]);
    activeProductsMock.mockResolvedValue(unreferencedProducts);
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
    expect(activeProductsMock).not.toHaveBeenCalled();
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

  it('工厂直单继续使用全部启用产品', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });

    renderToStaticMarkup(await NewOrderPage());

    expect(activeProductsMock).toHaveBeenCalledOnce();
    expect(externalBootstrapMock).not.toHaveBeenCalled();
    expect(orderFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: unreferencedProducts,
        settlementType: 'FACTORY_DIRECT',
      }),
    );
  });
});

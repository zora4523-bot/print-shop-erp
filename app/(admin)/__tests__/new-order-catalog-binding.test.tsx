import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCategory, Role } from '@/generated/prisma/enums';

const {
  activeProductsMock,
  currentExternalProductsMock,
  listCraftsMock,
  listCustomersMock,
  listPapersMock,
  orderFormPropsMock,
  redirectMock,
  requireSessionMock,
} = vi.hoisted(() => ({
  activeProductsMock: vi.fn(),
  currentExternalProductsMock: vi.fn(),
  listCraftsMock: vi.fn(),
  listCustomersMock: vi.fn(),
  listPapersMock: vi.fn(),
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
  listCurrentExternalSalesProductOrderOptions: currentExternalProductsMock,
}));
vi.mock('@/lib/material', () => ({
  listActivePaperOrderOptions: listPapersMock,
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
    listPapersMock.mockResolvedValue([]);
    listCustomersMock.mockResolvedValue([]);
    activeProductsMock.mockResolvedValue(unreferencedProducts);
    currentExternalProductsMock.mockResolvedValue(currentPriceBookProducts);
  });

  it('外部销售建单只传入当前加工费价目引用的 SKU', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'sales-1', role: Role.SALES },
    });

    renderToStaticMarkup(await NewOrderPage());

    expect(currentExternalProductsMock).toHaveBeenCalledOnce();
    expect(activeProductsMock).not.toHaveBeenCalled();
    expect(orderFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: currentPriceBookProducts,
        usesExternalSalesPricing: true,
      }),
    );
  });

  it('工厂直单继续使用全部启用产品', async () => {
    requireSessionMock.mockResolvedValue({
      user: { id: 'admin-1', role: Role.ADMIN },
    });

    renderToStaticMarkup(await NewOrderPage());

    expect(activeProductsMock).toHaveBeenCalledOnce();
    expect(currentExternalProductsMock).not.toHaveBeenCalled();
    expect(orderFormPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        products: unreferencedProducts,
        usesExternalSalesPricing: false,
      }),
    );
  });
});

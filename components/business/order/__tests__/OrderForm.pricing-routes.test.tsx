import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  OrderFoilTechnique,
  OrderItemPricingRoute,
  OrderLamination,
  OrderProductStructure,
  OrderSettlementType,
  ProductCategory,
} from '@/generated/prisma/enums';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({
  createOrderAction: vi.fn(),
  submitOrderAction: vi.fn(),
}));
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn(),
  quoteInternalCreateOrderAction: vi.fn(),
  quoteSampleOrderAction: vi.fn(),
}));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({ deleteOrderItemDesignAction: vi.fn() }));
vi.mock('../design-upload-client', () => ({
  uploadOrderItemDesignFile: vi.fn(),
}));

import {
  OrderForm,
  parsePastedReceiverAddress,
  resolveInternalOrderCraftIds,
  type CraftOption,
} from '../OrderForm';

const crafts: CraftOption[] = [
  {
    id: 'craft-local-foil',
    code: 'FLAT_FOIL_PARTIAL',
    name: '局部烫金',
    isOutsource: false,
    isLowFrequency: false,
  },
  {
    id: 'craft-stock-foil-old',
    code: 'STOCK_FOIL',
    name: '现货加烫',
    isOutsource: false,
    isLowFrequency: true,
  },
  {
    id: 'craft-packing',
    code: 'PACKING',
    name: '打包 / 入袋',
    isOutsource: false,
    isLowFrequency: false,
  },
  {
    id: 'craft-full-single',
    code: 'FLAT_FOIL_SINGLE',
    name: '专版单色平烫',
    isOutsource: false,
    isLowFrequency: false,
  },
  {
    id: 'craft-full-double',
    code: 'FLAT_FOIL_DOUBLE',
    name: '专版双色平烫',
    isOutsource: false,
    isLowFrequency: false,
  },
  {
    id: 'craft-print',
    code: 'COATED_COLOR_PRINT',
    name: '铜版纸纯彩印',
    isOutsource: true,
    isLowFrequency: false,
  },
  {
    id: 'craft-gluing',
    code: 'GLUING',
    name: '粘封',
    isOutsource: false,
    isLowFrequency: false,
  },
  {
    id: 'craft-uv',
    code: 'UV',
    name: 'UV',
    isOutsource: true,
    isLowFrequency: true,
  },
];

function internalItem(
  overrides: Partial<Parameters<typeof resolveInternalOrderCraftIds>[0]> = {},
): Parameters<typeof resolveInternalOrderCraftIds>[0] {
  return {
    fig: 1,
    name: '测试款式',
    productId: null,
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    productStructure: OrderProductStructure.UNSPECIFIED,
    artworkVersion: null,
    plateGroupId: null,
    pricingGroup: null,
    manualQuoteReason: null,
    specification: '大号封90×165',
    actualWidthMm: 90,
    actualHeightMm: 165,
    paperType: '160g珠光纸艳闪',
    paperWeightGsm: 160,
    quantity: 1000,
    pack: 10,
    crafts: ['craft-local-foil'],
    frontFoilColors: ['品牌金'],
    backFoilColors: [],
    foilColors: ['品牌金'],
    foilTechnique: OrderFoilTechnique.FLAT,
    hasLocalFoil: true,
    printColors: [],
    lamination: OrderLamination.NONE,
    isDoubleSided: false,
    isDoubleColor: false,
    unitPrice: null,
    fixedFee: null,
    suggestedSubtotal: null,
    priceOverrideReason: null,
    remark: null,
    ...overrides,
  };
}

const externalCreateOrderOptions = {
  products: [],
  papers: [],
  specifications: [],
  foilColors: [
    {
      id: 'foil-brand-gold',
      code: 'BRAND_GOLD',
      name: '品牌金',
      displayColor: '#b98f2c',
      displayImage: '/images/order/foil/brand-gold.png',
      sortOrder: 1,
    },
    {
      id: 'foil-clear',
      code: 'CLEAR',
      name: '透明色',
      displayColor: null,
      displayImage: null,
      sortOrder: 2,
    },
  ],
} as const;

describe('OrderForm pricing routes', () => {
  it('parses pasted receiver facts for shipping quotes', () => {
    expect(
      parsePastedReceiverAddress(
        '收货人：张三 13800138000 广东省佛山市南海区测试路 1 号',
      ),
    ).toEqual({
      receiverName: '张三',
      receiverPhone: '13800138000',
      province: '广东',
    });
  });

  it('finds the receiver before an address and returns null for unsupported provinces', () => {
    expect(
      parsePastedReceiverAddress(
        '李四 广东省佛山市南海区测试路1号 13800138000',
      ),
    ).toEqual({
      receiverName: '李四',
      receiverPhone: '13800138000',
      province: '广东',
    });
    expect(
      parsePastedReceiverAddress(
        '李四 13800138000 香港特别行政区九龙测试道1号',
      ),
    ).toEqual({
      receiverName: '李四',
      receiverPhone: '13800138000',
      province: null,
    });
  });

  it('renders only the three business routes and no manual-quote choice', () => {
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="pricing-route-test"
        crafts={crafts}
        products={[]}
        settlementLabel="外部销售"
        settlementType={OrderSettlementType.EXTERNAL_SALES}
        externalCreateOrderOptions={externalCreateOrderOptions}
      />,
    );

    expect(html).toContain('局部烫金');
    expect(html).toContain('专版烫金');
    expect(html).toContain('彩印');
    expect(html).not.toContain('空封现货');
    expect(html).not.toContain('专版单色平烫');
    expect(html).not.toContain('完全人工报价');
    expect(html).not.toContain('value="MANUAL_QUOTE"');
  });

  it('does not repeat route-owned production facts in the internal order form', () => {
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="internal-additional-crafts-test"
        crafts={crafts}
        products={[]}
        settlementLabel="工厂直接业务"
        settlementType={OrderSettlementType.FACTORY_DIRECT}
      />,
    );

    expect(html).toContain('工艺类型');
    expect(html).not.toContain('生产工艺');
    expect(html).not.toContain('计价必需');
    expect(html).toContain('附加工艺（选填）');
    expect(html).toContain('粘封');
    expect(html).toContain('UV · 外协 · 低频');
    expect(html).not.toContain('专版单色平烫');
    expect(html).not.toContain('打包 / 入袋');
  });

  it('replaces stale route crafts while preserving genuine additional steps', () => {
    expect(
      resolveInternalOrderCraftIds(
        internalItem({
          pricingRoute: OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
          frontFoilColors: ['品牌金', '透明色'],
          foilColors: ['品牌金', '透明色'],
          hasLocalFoil: false,
          crafts: [
            'craft-local-foil',
            'craft-full-single',
            'craft-gluing',
            'craft-packing',
          ],
        }),
        crafts,
      ),
    ).toEqual(['craft-full-double', 'craft-gluing']);

    expect(
      resolveInternalOrderCraftIds(
        internalItem({
          pricingRoute: OrderItemPricingRoute.COLOR_PRINT,
          frontFoilColors: [],
          foilColors: [],
          foilTechnique: OrderFoilTechnique.NONE,
          hasLocalFoil: false,
          printColors: ['彩印'],
          crafts: [
            'craft-full-double',
            'craft-gluing',
            'craft-packing',
            'unknown-stale-craft',
          ],
        }),
        crafts,
      ),
    ).toEqual(['craft-print', 'craft-gluing']);
  });

  it('renders the B address paste field and hides parsed facts until an address exists', () => {
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="receiver-fields-test"
        crafts={crafts}
        products={[]}
        settlementLabel="外部销售"
        settlementType={OrderSettlementType.EXTERNAL_SALES}
        externalCreateOrderOptions={externalCreateOrderOptions}
      />,
    );

    expect(html).toContain('receiver-address-paste');
    expect(html).toContain('粘贴电商后台地址串，自动拆分');
    expect(html).not.toContain('name="receiverName"');
    expect(html).not.toContain('name="receiverPhone"');
    expect(html).not.toContain('name="destinationProvince"');
    expect(html).not.toContain('<dt class="text-xs text-muted-foreground">收货人</dt>');
  });

  it('preselects canonical local foil and does not render the retired stock-foil craft', () => {
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="pricing-craft-test"
        crafts={crafts}
        products={[]}
        settlementLabel="外部销售"
        settlementType={OrderSettlementType.EXTERNAL_SALES}
        externalCreateOrderOptions={externalCreateOrderOptions}
      />,
    );

    expect(html).toContain('局部烫金');
    expect(html).not.toContain('现货加烫');
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?局部烫金/);
  });

  it('renders configured FOIL images and keeps a non-image fallback', () => {
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="configured-foil-catalog-test"
        crafts={crafts}
        products={[]}
        settlementLabel="外部销售"
        settlementType={OrderSettlementType.EXTERNAL_SALES}
        externalCreateOrderOptions={externalCreateOrderOptions}
      />,
    );

    expect(html).toContain('品牌金');
    const brandGoldButton = html.match(
      /<button[^>]*aria-label="品牌金(?:，第 \d+ 色)?"[\s\S]*?<\/button>/,
    )?.[0];
    const clearButton = html.match(
      /<button[^>]*aria-label="透明金"[\s\S]*?<\/button>/,
    )?.[0];

    expect(brandGoldButton).toMatch(
      /<img[^>]*\ssrc="\/_next\/image\?url=%2Fimages%2Forder%2Ffoil%2Fbrand-gold\.png(?:&amp;[^\"]*)?"/,
    );
    expect(clearButton).toContain('background-image:linear-gradient');
    expect(clearButton).not.toContain('<img');
    expect(html).not.toContain('亚金');
  });

  it('uses the B visual paper catalog without exposing import-source labels', () => {
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="paper-catalog-test"
        crafts={crafts}
        products={[
          {
            id: 'stock-touch',
            name: '触感纸大号现货',
            category: 'BLANK_STOCK',
            specification: '大号封90×165',
            paperType: '200g触感纸',
          },
          {
            id: 'stock-red',
            name: '红卡大号现货',
            category: 'BLANK_STOCK',
            specification: '大号封90×165',
            paperType: '180g红卡',
          },
          {
            id: 'stock-pearl',
            name: '珠光纸艳闪大号现货',
            category: 'BLANK_STOCK',
            specification: '大号封90×165',
            paperType: '160g珠光纸艳闪',
          },
        ]}
        settlementLabel="外部销售"
        settlementType={OrderSettlementType.EXTERNAL_SALES}
        externalCreateOrderOptions={externalCreateOrderOptions}
      />,
    );

    expect(html).toContain('触感纸');
    expect(html).toContain('红卡');
    expect(html).toContain('珠光纸艳闪');
    expect(html).not.toContain('纸张未标（烫金!B13）');
    expect(html).not.toContain('自定义纸张');
  });

  it('defaults to an available weight when an earlier sibling is out of stock', () => {
    const mixedProducts = [
      {
        id: 'stock-pearl-160',
        code: 'STOCK-PEARL-160',
        name: '珠光大号 160g',
        category: ProductCategory.BLANK_STOCK,
        specification: '大号封90×165',
        paperType: '160g珠光艳闪',
        paperMaterialId: 'paper-pearl-160',
        weight: 160,
      },
      {
        id: 'stock-pearl-180',
        code: 'STOCK-PEARL-180',
        name: '珠光大号 180g',
        category: ProductCategory.BLANK_STOCK,
        specification: '大号封90×165',
        paperType: '180g珠光艳闪',
        paperMaterialId: 'paper-pearl-180',
        weight: 180,
      },
    ] as const;
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="mixed-paper-availability-test"
        crafts={crafts}
        products={mixedProducts}
        settlementLabel="外部销售"
        settlementType={OrderSettlementType.EXTERNAL_SALES}
        externalCreateOrderOptions={{
          products: mixedProducts,
          papers: [
            {
              id: 'paper-pearl-160',
              code: 'PAPER-PEARL-160',
              name: '160g珠光艳闪',
              specification: '160g',
              unit: '张',
              weight: 160,
              outOfStock: true,
              sortOrder: 1,
            },
            {
              id: 'paper-pearl-180',
              code: 'PAPER-PEARL-180',
              name: '180g珠光艳闪',
              specification: '180g',
              unit: '张',
              weight: 180,
              outOfStock: false,
              sortOrder: 2,
            },
          ],
          specifications: [
            {
              specCode: '大号封90×165',
              label: '大号封90×165',
              widthMm: 90,
              heightMm: 165,
              productStructure: OrderProductStructure.STANDARD_ENVELOPE,
              productIds: mixedProducts.map((product) => product.id),
              productCategories: [ProductCategory.BLANK_STOCK],
            },
          ],
          foilColors: externalCreateOrderOptions.foilColors,
        }}
      />,
    );

    const unavailable = html.match(
      /<button[^>]*id="[^"]*-weight-160"[^>]*>/,
    )?.[0];
    const available = html.match(
      /<button[^>]*id="[^"]*-weight-180"[^>]*>/,
    )?.[0];
    expect(unavailable).toContain('disabled=""');
    expect(unavailable).toContain('aria-pressed="false"');
    expect(available).toContain('aria-pressed="true"');
  });

  it('does not expose quote SKU names in the B sales-entry UI', () => {
    const html = renderToStaticMarkup(
      <OrderForm
        draftScope="product-route-test"
        crafts={crafts}
        products={[
          {
            id: 'stock-product',
            name: '触感纸大号现货',
            category: 'BLANK_STOCK',
            specification: '大号封90×165',
            paperType: '200g触感纸',
          },
          {
            id: 'custom-product',
            name: '专版烫金大号',
            category: 'CUSTOM_FLAT_FOIL',
            specification: '大号封90×165',
            paperType: '200g触感纸',
          },
          {
            id: 'color-product',
            name: '彩印大号',
            category: 'COLOR_PRINT',
            specification: '大号封90×165',
            paperType: '250g铜版纸',
          },
          {
            id: 'legacy-stock-foil-product',
            name: '历史现货加烫 SKU',
            category: 'STOCK_FOIL_ADD',
            specification: '大号封90×165',
            paperType: '200g触感纸',
          },
        ]}
        settlementLabel="外部销售"
        settlementType={OrderSettlementType.EXTERNAL_SALES}
        externalCreateOrderOptions={externalCreateOrderOptions}
      />,
    );

    expect(html).not.toContain('触感纸大号现货');
    expect(html).not.toContain('专版烫金大号');
    expect(html).not.toContain('彩印大号');
    expect(html).not.toContain('历史现货加烫 SKU');
    expect(html).toContain('大号封');
  });
});

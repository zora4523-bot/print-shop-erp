import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OrderSettlementType } from '@/generated/prisma/enums';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({
  createOrderAction: vi.fn(),
  submitOrderAction: vi.fn(),
}));
vi.mock('@/actions/order-quote', () => ({ quoteOrderItemsAction: vi.fn() }));
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn(),
}));
vi.mock('@/actions/order-logistics-quote', () => ({
  quoteExternalOrderChargesAction: vi.fn(),
}));
vi.mock('@/actions/order-packaging-quote', () => ({
  quoteOrderPackagingGroupsAction: vi.fn(),
}));
vi.mock('../design-upload-client', () => ({
  uploadOrderItemDesignFile: vi.fn(),
}));

import {
  OrderForm,
  parsePastedReceiverAddress,
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
];

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
      /<button[^>]*aria-label="透明色"[\s\S]*?<\/button>/,
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

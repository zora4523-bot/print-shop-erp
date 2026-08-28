import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OrderItemPricingRoute,
  Role,
} from '../../../generated/prisma/enums';
import nextConfig from '../../../next.config';
import { ORDER_PRICING_STATUS } from '../../order/pricing-status';
import {
  NEW_ORDER_PRICING_ROUTES,
  ORDER_PRICING_ROUTE_LABELS,
} from '../../order/pricing-route';
import {
  calculateExternalSalesQuote,
  type ExternalSalesPriceRule,
  type ExternalSalesQuoteInput,
} from '../../price/external-sales-quote';
import {
  flattenAdminMenuItems,
  getAdminMenuItems,
} from '../admin-menu';
import {
  RULE_CENTER_HREFS,
  RULE_CENTER_SIDEBAR_ITEMS,
} from '../rule-center';

function adminMenuLabels(): string[] {
  return flattenAdminMenuItems(
    getAdminMenuItems({ role: Role.ADMIN }).flatMap(
      (group) => group.items,
    ),
  ).map((item) => item.label);
}

function legacyStockFoilInput(): ExternalSalesQuoteInput {
  return {
    quantity: 2_000,
    productId: 'stock-touch-large',
    productCode: 'EXT-STOCK-TOUCH-LARGE',
    craftIds: ['legacy-stock-foil-craft'],
    craftCodes: ['STOCK_FOIL'],
    specification: '大号',
    paperType: '触感纸',
    paperCatalogMatched: true,
    pricingRoute: OrderItemPricingRoute.STOCK_BLANK,
    productStructure: 'STANDARD_ENVELOPE',
    artworkVersion: 'V1',
    plateGroupId: null,
    pricingGroup: null,
    actualWidthMm: null,
    actualHeightMm: null,
    paperWeightGsm: null,
    foilColors: ['哑金'],
    foilTechnique: 'FLAT',
    hasLocalFoil: true,
    lamination: 'NONE',
    printColors: [],
    isDoubleSided: true,
    isDoubleColor: false,
    settlementType: 'EXTERNAL_SALES',
    orderItemCount: 1,
  };
}

function canonicalStockFoilRule(): ExternalSalesPriceRule {
  return {
    id: 'stock-touch-large-2000',
    code: 'STOCK_TOUCH_LARGE_2000',
    name: '触感纸大号通版现货局部烫金 2000 个',
    kind: 'BASE',
    calculationType: 'PER_PIECE',
    amount: '0.2000',
    minQty: 2_000,
    maxQty: 2_000,
    triggerCondition: {
      schemaVersion: 1,
      target: 'ITEM',
      pricingRoutes: [OrderItemPricingRoute.STOCK_BLANK],
      productCodes: ['EXT-STOCK-TOUCH-LARGE'],
      craftCodes: ['FLAT_FOIL_PARTIAL'],
      productStructures: ['STANDARD_ENVELOPE'],
      foilTechniques: ['FLAT'],
      hasLocalFoil: true,
    },
    exclusiveGroup: null,
    priority: 0,
    blocksAutomaticQuote: false,
    sourceSheet: '通版现货',
    sourceRange: 'A1',
    note: null,
    productId: 'stock-touch-large',
    category: { code: 'BASE_PRODUCT', name: '基础加工费' },
  };
}

const priceBook = {
  id: 'processing-v1',
  code: 'PROCESSING_EXTERNAL',
  name: '客户加工费',
  version: 1,
  sourceName: '当前规则版本',
  sourceSha256: null,
};

describe('工单核心重构验收契约', () => {
  it('新建工单严格只提供三条互斥的基础计价路线', () => {
    expect(NEW_ORDER_PRICING_ROUTES).toEqual([
      OrderItemPricingRoute.STOCK_BLANK,
      OrderItemPricingRoute.CUSTOM_SINGLE_FLAT_FOIL,
      OrderItemPricingRoute.COLOR_PRINT,
    ]);
    expect(new Set(NEW_ORDER_PRICING_ROUTES).size).toBe(3);
    expect(NEW_ORDER_PRICING_ROUTES).not.toContain(
      OrderItemPricingRoute.MANUAL_QUOTE,
    );
    expect(
      NEW_ORDER_PRICING_ROUTES.map(
        (route) => ORDER_PRICING_ROUTE_LABELS[route],
      ),
    ).toEqual(['局部烫金（通版现货）', '专版烫金', '彩印']);
    expect(
      ORDER_PRICING_ROUTE_LABELS[OrderItemPricingRoute.MANUAL_QUOTE],
    ).toContain('管理员终价');
  });

  it('管理后台主导航不再把产品分类和计价字典重复展示', () => {
    const labels = adminMenuLabels();

    expect(labels).toContain('规则配置中心');
    expect(labels).not.toEqual(
      expect.arrayContaining(['产品分类', '产品字典', '工艺字典']),
    );
  });

  it('规则中心在同一路由树下管理可维护的计价对象与师傅计件', () => {
    const requiredModules = [
      ['papers', '纸张', '/owner/rules/papers'],
      ['stockSkus', '报价产品', '/owner/rules/stock-skus'],
      [
        'productCategories',
        '产品结构',
        '/owner/rules/product-categories',
      ],
      ['crafts', '工艺参数', '/owner/rules/crafts'],
      ['workerPiecework', '师傅计件', '/owner/rules/worker-piecework'],
    ] as const;

    expect(
      new Set(RULE_CENTER_SIDEBAR_ITEMS.map((item) => item.href)).size,
    ).toBe(RULE_CENTER_SIDEBAR_ITEMS.length);

    const [rootItem, ...childItems] = RULE_CENTER_SIDEBAR_ITEMS;
    expect(rootItem).toMatchObject({
      id: 'overview',
      label: '规则配置中心',
      href: RULE_CENTER_HREFS.root,
      requiredPermission: 'dict:price:manage',
    });
    expect(childItems).toHaveLength(14);
    expect(
      childItems.every(
        (item) =>
          'menuParentId' in item && item.menuParentId === rootItem.id,
      ),
    ).toBe(true);

    const rulesGroup = getAdminMenuItems({ role: Role.ADMIN }).find(
      (group) => group.label === '规则',
    );
    expect(rulesGroup?.items).toHaveLength(1);
    expect(rulesGroup?.items[0]).toMatchObject({
      label: '规则配置中心',
      href: RULE_CENTER_HREFS.root,
    });
    expect(rulesGroup?.items[0]?.children).toHaveLength(14);

    for (const [key, label, href] of requiredModules) {
      expect(RULE_CENTER_HREFS[key]).toBe(href);
      expect(href.startsWith(`${RULE_CENTER_HREFS.root}/`)).toBe(true);
      expect(RULE_CENTER_SIDEBAR_ITEMS).toContainEqual(
        expect.objectContaining({ label, href }),
      );
      expect(
        existsSync(
          join(
            process.cwd(),
            'app',
            '(admin)',
            ...href.replace(/^\//, '').split('/'),
            'page.tsx',
          ),
        ),
        `${key} 应当是规则中心内的真实页面`,
      ).toBe(true);
    }

    expect(RULE_CENTER_HREFS).not.toHaveProperty('pricingRoutes');
  });

  it('旧字典地址仅作兼容入口，统一转到规则中心', async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];

    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/owner/rules/pricing-routes',
          destination: RULE_CENTER_HREFS.root,
          permanent: false,
        }),
        expect.objectContaining({
          source: '/owner/products',
          destination: RULE_CENTER_HREFS.stockSkus,
          permanent: false,
        }),
        expect.objectContaining({
          source: '/owner/crafts',
          destination: RULE_CENTER_HREFS.crafts,
          permanent: false,
        }),
        expect.objectContaining({
          source: '/owner/product-categories',
          destination: RULE_CENTER_HREFS.productCategories,
          permanent: false,
        }),
      ]),
    );
  });

  it('历史 STOCK_FOIL 工艺仍可匹配新的“局部烫金”规则', () => {
    const result = calculateExternalSalesQuote({
      input: legacyStockFoilInput(),
      priceBook,
      rules: [canonicalStockFoilRule()],
    });

    expect(result).toMatchObject({
      complete: true,
      suggestedUnitPrice: '0.2000',
      suggestedFixedFee: '0.00',
      suggestedSubtotal: '400.00',
      errors: [],
    });
  });

  it('自动价未覆盖时不伪造建议价，进入待管理员终价状态', () => {
    const result = calculateExternalSalesQuote({
      input: legacyStockFoilInput(),
      priceBook,
      rules: [],
    });

    expect(result.complete).toBe(false);
    expect(result.suggestedUnitPrice).toBeNull();
    expect(result.suggestedFixedFee).toBeNull();
    expect(result.suggestedSubtotal).toBeNull();
    expect(result.errors.some((message) => message.includes('管理员'))).toBe(
      true,
    );
    expect(ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION).toBe(
      'PENDING_ADMIN_CONFIRMATION',
    );
    expect(ORDER_PRICING_STATUS.ADMIN_CONFIRMED).toBe('ADMIN_CONFIRMED');
  });
});

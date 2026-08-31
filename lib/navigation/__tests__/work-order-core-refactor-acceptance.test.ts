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

  it('规则中心在同一路由树下管理可维护的计价对象', () => {
    const requiredModules = [
      ['papers', '纸张', '/owner/rules/papers'],
      ['stockSkus', '可建单产品组合', '/owner/rules/stock-skus'],
      [
        'productCategories',
        '产品结构',
        '/owner/rules/product-categories',
      ],
      ['crafts', '建单工艺目录', '/owner/rules/crafts'],
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
    expect(childItems).toHaveLength(12);
    expect(
      childItems.every(
        (item) =>
          'menuParentId' in item && item.menuParentId === rootItem.id,
      ),
    ).toBe(true);
    expect(
      new Set(
        childItems.map((item) =>
          'menuGroupLabel' in item ? item.menuGroupLabel : null,
        ),
      ),
    ).toEqual(
      new Set(['客户计价规则', '建单主数据', '员工薪酬规则']),
    );

    const rulesGroup = getAdminMenuItems({ role: Role.ADMIN }).find(
      (group) => group.label === '规则',
    );
    expect(rulesGroup?.items).toHaveLength(1);
    expect(rulesGroup?.items[0]).toMatchObject({
      label: '规则配置中心',
      href: RULE_CENTER_HREFS.root,
    });
    expect(rulesGroup?.items[0]?.children).toHaveLength(12);

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
    expect(RULE_CENTER_HREFS).not.toHaveProperty('internalPricing');
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

  it('仍保留新建工单的人工核价状态', () => {
    expect(ORDER_PRICING_STATUS.PENDING_ADMIN_CONFIRMATION).toBe(
      'PENDING_ADMIN_CONFIRMATION',
    );
    expect(ORDER_PRICING_STATUS.ADMIN_CONFIRMED).toBe('ADMIN_CONFIRMED');
  });
});

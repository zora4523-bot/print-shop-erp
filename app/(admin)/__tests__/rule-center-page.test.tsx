import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEW_ORDER_PRICING_ROUTES,
  ORDER_PRICING_ROUTE_LABELS,
} from '@/lib/order/pricing-route';

const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));

vi.mock('@/lib/auth/permissions', () => ({
  requirePermission: requirePermissionMock,
}));

import RuleCenterPage from '@/app/(admin)/owner/rules/page';
import PricingRoutesPage from '@/app/(admin)/owner/rules/pricing-routes/page';

beforeEach(() => {
  requirePermissionMock.mockReset().mockResolvedValue({ id: 'admin-1' });
});

describe('rule center overview', () => {
  it('requires price-management permission before rendering', async () => {
    renderToStaticMarkup(await RuleCenterPage());

    expect(requirePermissionMock).toHaveBeenCalledOnce();
    expect(requirePermissionMock).toHaveBeenCalledWith('dict:price:manage');
  });

  it('keeps the overview focused on three common operations', async () => {
    const html = renderToStaticMarkup(await RuleCenterPage());

    const entries = [
      ['客户计价', '/owner/rules/customer-pricing?purpose=processing'],
      ['价格版本', '/owner/rules/price-versions'],
      ['师傅计件', '/owner/rules/worker-piecework'],
    ] as const;

    expect(html).toContain('常用操作');
    expect(html.match(/data-slot="action-shortcut"/g)).toHaveLength(3);
    for (const [label, href] of entries) {
      expect(html).toContain(label);
      expect(html).toContain(`href="${href}"`);
    }
  });

  it('keeps the compatible pricing-method page concise and business-facing', async () => {
    const html = renderToStaticMarkup(await PricingRoutesPage());

    for (const route of NEW_ORDER_PRICING_ROUTES) {
      expect(html).toContain(ORDER_PRICING_ROUTE_LABELS[route]);
      expect(html).not.toContain(route);
    }
    expect(html).toContain('未自动计价时由管理员填写终价');
    expect(html).not.toContain('base_price');
    expect(html).not.toContain('key:');
  });

  it('does not repeat explanatory, dictionary or technical content', async () => {
    const html = renderToStaticMarkup(await RuleCenterPage());

    const removedCopy = [
      '计价方式',
      '局部烫金（通版现货）、专版烫金、彩印。每款只选一种，工艺参数继续参与计价。',
      '纸张、报价 SKU、产品结构分类和工艺是规则引用的结构化事实，不再作为侧边栏中的重复字典入口。',
      '客户应收与工厂内部应付分开计算，但统一从本中心进入。',
      '报价 SKU 和 BOM 共用的分类树；仅用于结构化归档，不是工艺或第四条计价路线。',
      '局部烫金（通版现货）',
      '专版烫金',
      '彩印',
      '纸张',
      '报价 SKU',
      '产品结构分类',
      '工艺与参数',
      '内部计价',
      '员工工资与提成',
      '新建工单固定选项',
      '兼容模式',
      'STOCK_BLANK',
      'CUSTOM_SINGLE_FLAT_FOIL',
      'COLOR_PRINT',
      'base_price',
    ];

    for (const copy of removedCopy) {
      expect(html).not.toContain(copy);
    }
  });

  it('keeps every overview action inside the rule center', async () => {
    const html = renderToStaticMarkup(await RuleCenterPage());
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(hrefs).toHaveLength(3);
    expect(hrefs.every((href) => href?.startsWith('/owner/rules'))).toBe(true);
  });
});

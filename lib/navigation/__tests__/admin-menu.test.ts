import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Role } from '../../../generated/prisma/enums';
import { PERMISSIONS } from '../../auth/permissions-dict';
import { ADMIN_MODULES } from '../admin-modules';
import {
  ADMIN_ROLE_BADGE,
  flattenAdminMenuItems,
  getActiveAdminMenuHref,
  getAdminQuickLinks,
  getAdminMenuItems,
  type AdminMenuItem,
} from '../admin-menu';

function flatten(items: ReturnType<typeof getAdminMenuItems>): AdminMenuItem[] {
  return flattenAdminMenuItems(items.flatMap((group) => group.items));
}

describe('getAdminMenuItems', () => {
  it('经营概览仅向管理员开放，并与工作台保持独立高亮', () => {
    const adminItems = flatten(getAdminMenuItems({ role: Role.ADMIN }));
    expect(getActiveAdminMenuHref('/owner/analytics', adminItems)).toBe('/owner/analytics');
    expect(getActiveAdminMenuHref('/owner', adminItems)).toBe('/owner');
    for (const role of [Role.SALES, Role.CUSTOMER_SERVICE, Role.WORKER]) {
      expect(flatten(getAdminMenuItems({ role })).map((item) => item.href)).not.toContain('/owner/analytics');
    }
    expect(getAdminQuickLinks({ role: Role.ADMIN }).map((item) => item.href)).not.toContain('/owner/analytics');
  });

  it('ADMIN 看到经营管理与生产管理的完整菜单', () => {
    const groups = getAdminMenuItems({ role: Role.ADMIN });
    const items = flatten(groups);
    expect(groups.map((g) => g.label)).toEqual([
      '业务',
      '规则',
      '财务',
      '字典',
      '账号',
      '运维',
    ]);
    expect(items).toHaveLength(35);
    expect(items.map((i) => i.label)).toEqual([
      '工作台',
      '经营概览',
      '工单',
      '采购单',
      '工单修改申请',
      '外协',
      '车间用料',
      '工时录入',
      '规则配置中心',
      '空白封单价',
      '局部烫金机烫费',
      '专版烫金单价',
      '专版烫金加价',
      '彩印阶梯价',
      '包装与快递',
      '价格版本',
      '纸张',
      '可建单产品组合',
      '产品结构',
      '建单工艺目录',
      '员工薪酬规则',
      '账单',
      '薪资总览',
      '工序计件结算',
      '历史日薪档案',
      '客服周期',
      '时薪工月结',
      '物料',
      '仓库/库位',
      '用户管理',
      '系统设置',
      '推送配置',
      '后台任务',
      'Pigsty 运维',
      'CDR 汇总',
    ]);
    // P1 #1 Slice A：/owner/page.tsx 已落地，Dashboard href 不再是 `#`
    // placeholder。锁住，防止未来回退时 sidebar 又指 404 路由。
    const dashboard = items.find((i) => i.label === '工作台');
    expect(dashboard?.href).toBe('/owner');
    const analytics = items.find((i) => i.label === '经营概览');
    expect(analytics?.href).toBe('/owner/analytics');
    expect(analytics?.requiredPermission).toBe('report:all');
    expect(analytics?.breadcrumbLabel).toBe('经营概览');
    const purchases = items.find((i) => i.label === '采购单');
    expect(purchases?.href).toBe('/owner/purchases');
    expect(purchases?.requiredPermission).toBe('purchase:manage');
    const orderChanges = items.find((i) => i.label === '工单修改申请');
    expect(orderChanges?.href).toBe('/owner/order-changes');
    expect(orderChanges?.requiredPermission).toBe('order:change:review');
    expect(items.map((item) => item.label)).not.toContain('客户/供应商');
    // P1 #2 Slice B：推送配置走 /owner/notifications，权限 notification:config
    const notif = items.find((i) => i.label === '推送配置');
    expect(notif?.href).toBe('/owner/notifications');
    expect(notif?.requiredPermission).toBe('notification:config');
    const pigsty = items.find((i) => i.label === 'Pigsty 运维');
    expect(pigsty?.href).toBe('/owner/pigsty');
    expect(pigsty?.requiredPermission).toBe('ops:pigsty:view');
    const backgroundJobs = items.find((i) => i.label === '后台任务');
    expect(backgroundJobs?.href).toBe('/owner/background-jobs');
    expect(backgroundJobs?.requiredPermission).toBe('ops:jobs:manage');
    const materials = items.find((i) => i.label === '物料');
    expect(materials?.href).toBe('/owner/materials');
    expect(materials?.requiredPermission).toBe('material:manage');
    const warehouses = items.find((i) => i.label === '仓库/库位');
    expect(warehouses?.href).toBe('/owner/warehouses');
    expect(warehouses?.requiredPermission).toBe('warehouse:manage');
    const rules = items.find((i) => i.label === '规则配置中心');
    expect(rules?.href).toBe('/owner/rules');
    expect(rules?.activeRouteBase).toBe('/owner/rules');
    expect(rules?.requiredPermission).toBe('dict:price:manage');
    expect(rules?.breadcrumbLabel).toBe('规则配置中心');
    const rulesGroup = groups.find((group) => group.label === '规则');
    expect(rulesGroup?.items).toHaveLength(1);
    expect(
      rulesGroup?.items.map(({ label, href, requiredPermission }) => ({
        label,
        href,
        requiredPermission,
      })),
    ).toEqual([
      {
        label: '规则配置中心',
        href: '/owner/rules',
        requiredPermission: 'dict:price:manage',
      },
    ]);
    expect(
      rulesGroup?.items[0]?.children?.map(
        ({ label, href, requiredPermission }) => ({
          label,
          href,
          requiredPermission,
        }),
      ),
    ).toEqual([
      {
        label: '空白封单价',
        href: '/owner/rules/customer-pricing?section=blank',
        requiredPermission: 'dict:price:manage',
      },
      {
        label: '局部烫金机烫费',
        href: '/owner/rules/customer-pricing?section=machine',
        requiredPermission: 'dict:price:manage',
      },
      {
        label: '专版烫金单价',
        href: '/owner/rules/customer-pricing?section=tiers',
        requiredPermission: 'dict:price:manage',
      },
      {
        label: '专版烫金加价',
        href: '/owner/rules/customer-pricing?section=adds',
        requiredPermission: 'dict:price:manage',
      },
      {
        label: '彩印阶梯价',
        href: '/owner/rules/customer-pricing?section=print',
        requiredPermission: 'dict:price:manage',
      },
      {
        label: '包装与快递',
        href:
          '/owner/rules/customer-pricing?purpose=logistics&section=ship',
        requiredPermission: 'dict:price:manage',
      },
      {
        label: '价格版本',
        href: '/owner/rules/price-versions',
        requiredPermission: 'dict:price:manage',
      },
      {
        label: '纸张',
        href: '/owner/rules/papers',
        requiredPermission: 'material:manage',
      },
      {
        label: '可建单产品组合',
        href: '/owner/rules/stock-skus',
        requiredPermission: 'dict:product:manage',
      },
      {
        label: '产品结构',
        href: '/owner/rules/product-categories',
        requiredPermission: 'dict:product:manage',
      },
      {
        label: '建单工艺目录',
        href: '/owner/rules/crafts',
        requiredPermission: 'dict:craft:manage',
      },
      {
        label: '员工薪酬规则',
        href: '/owner/rules/employee-pay',
        requiredPermission: 'salary:rule:manage',
      },
    ]);
    expect(
      rulesGroup?.items[0]?.children?.map(
        ({ label, menuGroupLabel }) => [label, menuGroupLabel],
      ),
    ).toEqual([
      ['空白封单价', '客户计价规则'],
      ['局部烫金机烫费', '客户计价规则'],
      ['专版烫金单价', '客户计价规则'],
      ['专版烫金加价', '客户计价规则'],
      ['彩印阶梯价', '客户计价规则'],
      ['包装与快递', '客户计价规则'],
      ['价格版本', '客户计价规则'],
      ['纸张', '建单主数据'],
      ['可建单产品组合', '建单主数据'],
      ['产品结构', '建单主数据'],
      ['建单工艺目录', '建单主数据'],
      ['员工薪酬规则', '员工薪酬规则'],
    ]);
    expect(items.map((item) => item.label)).not.toContain('BOM/用料');
    expect(items.map((item) => item.label)).not.toEqual(
      expect.arrayContaining([
        '外部销售收费',
        '内部报价（低频）',
        '开机师傅计件规则',
        '员工工资规则',
      ]),
    );
    expect(items.map((item) => item.href)).not.toEqual(
      expect.arrayContaining([
        '/owner/prices/external-sales/items',
        '/owner/prices',
        '/owner/salary/piecework-rules',
        '/owner/salary/rules',
      ]),
    );
  });

  it('ADMIN 字典不再重复暴露规则中心已收口的计价对象', () => {
    const labels = flatten(getAdminMenuItems({ role: Role.ADMIN })).map(
      (i) => i.label,
    );
    expect(labels).toContain('账单');
    expect(labels).toContain('用户管理');
    expect(labels).not.toContain('工艺字典');
    expect(labels).not.toContain('产品字典');
    expect(labels).not.toContain('产品分类');
    expect(labels).toContain('工作台');
    expect(labels).not.toContain('排产');
    expect(labels).toContain('外协');
    expect(labels).toContain('物料');
    expect(labels).toContain('车间用料');
    expect(labels).toContain('工时录入');
    const workshopMaterials = flatten(getAdminMenuItems({ role: Role.ADMIN })).find(
      (i) => i.label === '车间用料',
    );
    expect(workshopMaterials?.href).toBe('/foreman/materials');
    expect(workshopMaterials?.requiredPermission).toBe('material:manage');
    const attendance = flatten(getAdminMenuItems({ role: Role.ADMIN })).find(
      (i) => i.label === '工时录入',
    );
    expect(attendance?.requiredPermission).toBe('attendance:manage');
    const cdr = flatten(getAdminMenuItems({ role: Role.ADMIN })).find(
      (i) => i.label === 'CDR 汇总',
    );
    expect(cdr?.href).toBe('/foreman/cdr');
    expect(cdr?.requiredPermission).toBe('design:bundle:create');
    const hrefs = flatten(getAdminMenuItems({ role: Role.ADMIN })).map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('规则中心根页与各模块子路由分别唯一高亮', () => {
    const items = getAdminMenuItems({ role: Role.ADMIN }).flatMap(
      (group) => group.items,
    );

    const expectations = [
      ['/owner/rules', '', '/owner/rules'],
      ['/owner/rules/papers', '', '/owner/rules/papers'],
      ['/owner/rules/papers/new', '', '/owner/rules/papers'],
      ['/owner/rules/stock-skus', '', '/owner/rules/stock-skus'],
      ['/owner/rules/stock-skus/sku-1', '', '/owner/rules/stock-skus'],
      [
        '/owner/rules/product-categories',
        '',
        '/owner/rules/product-categories',
      ],
      [
        '/owner/rules/product-categories/new',
        '',
        '/owner/rules/product-categories',
      ],
      ['/owner/rules/crafts', '', '/owner/rules/crafts'],
      [
        '/owner/rules/customer-pricing',
        '',
        '/owner/rules/customer-pricing?section=blank',
      ],
      [
        '/owner/rules/price-versions',
        '',
        '/owner/rules/price-versions',
      ],
      [
        '/owner/rules/employee-pay',
        '',
        '/owner/rules/employee-pay',
      ],
    ] as const;

    for (const [pathname, query, expectedHref] of expectations) {
      expect(
        getActiveAdminMenuHref(pathname, items, new URLSearchParams(query)),
      ).toBe(expectedHref);
    }
  });

  it('客户计价的六个入口按稳定 query 唯一高亮', () => {
    const items = getAdminMenuItems({ role: Role.ADMIN }).flatMap(
      (group) => group.items,
    );
    const pathname = '/owner/rules/customer-pricing';
    const cases = [
      ['', '/owner/rules/customer-pricing?section=blank'],
      ['purpose=processing', '/owner/rules/customer-pricing?section=blank'],
      ['purpose=unknown', '/owner/rules/customer-pricing?section=blank'],
      [
        'section=blank&q=珠光纸&page=3',
        '/owner/rules/customer-pricing?section=blank',
      ],
      [
        'section=machine&item=rule-1',
        '/owner/rules/customer-pricing?section=machine',
      ],
      ['section=tiers', '/owner/rules/customer-pricing?section=tiers'],
      ['section=adds', '/owner/rules/customer-pricing?section=adds'],
      ['section=print', '/owner/rules/customer-pricing?section=print'],
      [
        'purpose=logistics',
        '/owner/rules/customer-pricing?purpose=logistics&section=ship',
      ],
      [
        'purpose=logistics&section=ship&page=2',
        '/owner/rules/customer-pricing?purpose=logistics&section=ship',
      ],
    ] as const;

    for (const [query, expectedHref] of cases) {
      expect(
        getActiveAdminMenuHref(pathname, items, new URLSearchParams(query)),
      ).toBe(expectedHref);
    }
  });

  it('SALES 菜单不含管理员/主管独占项', () => {
    const labels = flatten(getAdminMenuItems({ role: Role.SALES })).map(
      (i) => i.label,
    );
    expect(labels).not.toContain('账号管理');
    expect(labels).not.toContain('工艺字典');
    expect(labels).not.toContain('产品字典');
    expect(labels).not.toContain('外部销售收费');
    expect(labels).not.toContain('内部报价（低频）');
    expect(labels).not.toContain('规则配置中心');
    expect(labels).not.toContain('排产');
    expect(labels).not.toContain('外协');
    expect(labels).not.toContain('我的 Dashboard');
    expect(labels).toContain('创建工单');
    expect(labels).toContain('我的工单');
    expect(labels).toContain('我的账单');
    expect(labels).not.toContain('报价查询');
  });

  it('CUSTOMER_SERVICE 看到自己专属的"我的业绩 / 我的工资单"', () => {
    const labels = flatten(
      getAdminMenuItems({ role: Role.CUSTOMER_SERVICE }),
    ).map((i) => i.label);
    expect(labels).not.toContain('我的 Dashboard');
    expect(labels).toContain('创建工单');
    expect(labels).toContain('我的业绩');
    expect(labels).toContain('我的工资单');
    // CS 不出现"我的账单"（账单只属销售）
    expect(labels).not.toContain('我的账单');
    expect(labels).not.toContain('外部销售收费');
    expect(labels).not.toContain('内部报价（低频）');
    expect(labels).not.toContain('规则配置中心');
    expect(labels).not.toContain('报价查询');
  });

  it('WORKER 返回空（师傅走独立 (worker) 壳，不应进 (admin)）', () => {
    expect(getAdminMenuItems({ role: Role.WORKER })).toEqual([]);
  });

  it('每个角色的所有非占位项都有 PERMISSIONS / roles 之一', () => {
    for (const role of Object.values(Role)) {
      const items = flatten(getAdminMenuItems({ role }));
      for (const item of items) {
        const hasGate = Boolean(item.requiredPermission ?? item.roles);
        expect(hasGate, `${role} 菜单项 "${item.label}" 缺鉴权`).toBe(true);
      }
    }
  });

  it('所有 requiredPermission 都是 PERMISSIONS 字典里的合法 key', () => {
    for (const role of [Role.ADMIN, Role.SALES, Role.CUSTOMER_SERVICE]) {
      const items = flatten(getAdminMenuItems({ role }));
      for (const item of items) {
        if (item.requiredPermission) {
          expect(
            PERMISSIONS,
            `Permission ${item.requiredPermission} 未在 PERMISSIONS 字典定义`,
          ).toHaveProperty(item.requiredPermission);
        }
      }
    }
  });

  it('header quick links are real implemented routes', () => {
    for (const role of [Role.ADMIN, Role.SALES, Role.CUSTOMER_SERVICE]) {
      const links = getAdminQuickLinks({ role });
      expect(links.length, `${role} should have quick links`).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.href).not.toBe('#');
        expect(link.status).toBe('implemented');
      }
    }
  });
});

describe('ADMIN_MODULES registry', () => {
  it('module ids are unique and metadata is explicit', () => {
    const ids = new Set<string>();
    for (const adminModule of ADMIN_MODULES) {
      expect(ids.has(adminModule.id), `duplicate module id ${adminModule.id}`).toBe(false);
      ids.add(adminModule.id);
      expect(adminModule.label).toBeTruthy();
      expect(adminModule.breadcrumbLabel).toBeTruthy();
      expect(adminModule.menuSection).toBeTruthy();
      expect(adminModule.status).toMatch(/^(implemented|placeholder)$/);
    }

    for (const adminModule of ADMIN_MODULES) {
      if (!adminModule.menuParentId) continue;
      expect(
        ids.has(adminModule.menuParentId),
        `${adminModule.id} references missing parent ${adminModule.menuParentId}`,
      ).toBe(true);
      expect(adminModule.menuParentId).not.toBe(adminModule.id);
    }
  });

  it('all registry requiredPermission values are legal permission keys', () => {
    for (const adminModule of ADMIN_MODULES) {
      if (adminModule.requiredPermission) {
        expect(PERMISSIONS).toHaveProperty(adminModule.requiredPermission);
      }
    }
  });

  it('placeholder and implemented route states are explicit', () => {
    for (const adminModule of ADMIN_MODULES) {
      if (adminModule.status === 'placeholder') {
        expect(adminModule.routeBase, `${adminModule.id} placeholder should use #`).toBe('#');
      } else {
        expect(
          adminModule.routeBase,
          `${adminModule.id} implemented route should be real`,
        ).not.toBe('#');
      }
    }
  });

  it('implemented menu routes have an App Router page', () => {
    const root = process.cwd();
    for (const adminModule of ADMIN_MODULES) {
      if (adminModule.status !== 'implemented') continue;
      const routePathname = new URL(
        adminModule.routeBase,
        'https://print-shop.local',
      ).pathname;
      const relativeRoute = routePathname.replace(/^\//, '');
      const candidates = [
        join(root, 'app', '(admin)', relativeRoute, 'page.tsx'),
        join(root, 'app', relativeRoute, 'page.tsx'),
      ];
      expect(
        candidates.some((pagePath) => existsSync(pagePath)),
        `${adminModule.id} missing page at ${candidates.join(' or ')}`,
      ).toBe(
        true,
      );
    }
  });
});

describe('ADMIN_ROLE_BADGE', () => {
  it('每个 Role 都有对应的角色 badge 文案', () => {
    for (const role of Object.values(Role)) {
      expect(ADMIN_ROLE_BADGE[role]).toBeTruthy();
    }
  });
});

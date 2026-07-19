import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Role } from '../../../generated/prisma/enums';
import { PERMISSIONS } from '../../auth/permissions-dict';
import { ADMIN_MODULES } from '../admin-modules';
import {
  ADMIN_ROLE_BADGE,
  getAdminQuickLinks,
  getAdminMenuItems,
  type AdminMenuItem,
} from '../admin-menu';

function flatten(items: ReturnType<typeof getAdminMenuItems>): AdminMenuItem[] {
  return items.flatMap((g) => g.items);
}

describe('getAdminMenuItems', () => {
  it('OWNER 看到 20 项菜单（含 Dashboard / 业务字典 / 后台任务 / Pigsty 运维）', () => {
    const groups = getAdminMenuItems({ role: Role.OWNER });
    const items = flatten(groups);
    expect(groups.map((g) => g.label)).toEqual([
      '概览',
      '业务',
      '财务',
      '字典',
      '账号',
      '运维',
    ]);
    expect(items).toHaveLength(20);
    expect(items.map((i) => i.label)).toEqual([
      'Dashboard',
      '工单',
      '采购单',
      '账单',
      '薪资总览',
      '计件工资',
      '客服周期',
      '时薪工月结',
      '客户/供应商',
      '工艺字典',
      '产品字典',
      '产品分类',
      '价格字典',
      'BOM/用料',
      '物料',
      '仓库/库位',
      '用户管理',
      '推送配置',
      '后台任务',
      'Pigsty 运维',
    ]);
    // P1 #1 Slice A：/owner/page.tsx 已落地，Dashboard href 不再是 `#`
    // placeholder。锁住，防止未来回退时 sidebar 又指 404 路由。
    const dashboard = items.find((i) => i.label === 'Dashboard');
    expect(dashboard?.href).toBe('/owner');
    const purchases = items.find((i) => i.label === '采购单');
    expect(purchases?.href).toBe('/owner/purchases');
    expect(purchases?.requiredPermission).toBe('purchase:manage');
    const parties = items.find((i) => i.label === '客户/供应商');
    expect(parties?.href).toBe('/owner/parties');
    expect(parties?.requiredPermission).toBe('party:manage');
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
    const productCategories = items.find((i) => i.label === '产品分类');
    expect(productCategories?.href).toBe('/owner/product-categories');
    expect(productCategories?.requiredPermission).toBe('dict:product:manage');
    const prices = items.find((i) => i.label === '价格字典');
    expect(prices?.href).toBe('/owner/prices');
    expect(prices?.requiredPermission).toBe('dict:price:manage');
    const boms = items.find((i) => i.label === 'BOM/用料');
    expect(boms?.href).toBe('/owner/boms');
    expect(boms?.requiredPermission).toBe('bom:manage');
  });

  it('FOREMAN 看不到老板独占项（账单 / 用户管理 / 工艺字典 / 产品字典）', () => {
    const labels = flatten(getAdminMenuItems({ role: Role.FOREMAN })).map(
      (i) => i.label,
    );
    expect(labels).not.toContain('账单');
    expect(labels).not.toContain('用户管理');
    expect(labels).not.toContain('工艺字典');
    expect(labels).not.toContain('产品字典');
    // 但有自己的 Dashboard / 排产 / 外协 / 物料 / 工时录入 / CDR 汇总
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('排产');
    expect(labels).toContain('外协');
    expect(labels).toContain('物料');
    expect(labels).toContain('工时录入');
    const materials = flatten(getAdminMenuItems({ role: Role.FOREMAN })).find(
      (i) => i.label === '物料',
    );
    expect(materials?.href).toBe('/foreman/materials');
    expect(materials?.requiredPermission).toBe('material:manage');
    // P0 #7：CDR 汇总（design:bundle:create 权限）
    const cdr = flatten(getAdminMenuItems({ role: Role.FOREMAN })).find(
      (i) => i.label === 'CDR 汇总',
    );
    expect(cdr?.href).toBe('/foreman/cdr');
    expect(cdr?.requiredPermission).toBe('design:bundle:create');
  });

  it('SALES 菜单不含老板/主管独占项', () => {
    const labels = flatten(getAdminMenuItems({ role: Role.SALES })).map(
      (i) => i.label,
    );
    expect(labels).not.toContain('账号管理');
    expect(labels).not.toContain('工艺字典');
    expect(labels).not.toContain('产品字典');
    expect(labels).not.toContain('排产');
    expect(labels).not.toContain('外协');
    expect(labels).toContain('我的 Dashboard');
    expect(labels).toContain('创建工单');
    expect(labels).toContain('我的工单');
    expect(labels).toContain('我的账单');
  });

  it('CUSTOMER_SERVICE 看到自己专属的"我的业绩 / 我的工资单"', () => {
    const labels = flatten(
      getAdminMenuItems({ role: Role.CUSTOMER_SERVICE }),
    ).map((i) => i.label);
    expect(labels).toContain('我的 Dashboard');
    expect(labels).toContain('创建工单');
    expect(labels).toContain('我的业绩');
    expect(labels).toContain('我的工资单');
    // CS 不出现"我的账单"（账单只属销售）
    expect(labels).not.toContain('我的账单');
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
    for (const role of [
      Role.OWNER,
      Role.FOREMAN,
      Role.SALES,
      Role.CUSTOMER_SERVICE,
    ]) {
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
    for (const role of [
      Role.OWNER,
      Role.FOREMAN,
      Role.SALES,
      Role.CUSTOMER_SERVICE,
    ]) {
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
      const relativeRoute = adminModule.routeBase.replace(/^\//, '');
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

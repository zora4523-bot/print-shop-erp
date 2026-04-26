import { describe, it, expect } from 'vitest';
import { Role } from '../../../generated/prisma/enums';
import { PERMISSIONS } from '../../auth/permissions-dict';
import {
  ADMIN_ROLE_BADGE,
  getAdminMenuItems,
  type AdminMenuItem,
} from '../admin-menu';

function flatten(items: ReturnType<typeof getAdminMenuItems>): AdminMenuItem[] {
  return items.flatMap((g) => g.items);
}

describe('getAdminMenuItems', () => {
  it('OWNER 看到 10 项菜单（含 Dashboard / 工艺/产品字典 / 用户管理）', () => {
    const items = flatten(getAdminMenuItems({ role: Role.OWNER }));
    expect(items).toHaveLength(10);
    expect(items.map((i) => i.label)).toEqual([
      'Dashboard',
      '工单',
      '账单',
      '薪资总览',
      '师傅日薪',
      '客服周期',
      '时薪工月结',
      '工艺字典',
      '产品字典',
      '用户管理',
    ]);
    // P1 #1 Slice A：/owner/page.tsx 已落地，Dashboard href 不再是 `#`
    // placeholder。锁住，防止未来回退时 sidebar 又指 404 路由。
    const dashboard = items.find((i) => i.label === 'Dashboard');
    expect(dashboard?.href).toBe('/owner');
  });

  it('FOREMAN 看不到老板独占项（账单 / 用户管理 / 工艺字典 / 产品字典）', () => {
    const labels = flatten(getAdminMenuItems({ role: Role.FOREMAN })).map(
      (i) => i.label,
    );
    expect(labels).not.toContain('账单');
    expect(labels).not.toContain('用户管理');
    expect(labels).not.toContain('工艺字典');
    expect(labels).not.toContain('产品字典');
    // 但有自己的 Dashboard / 排产 / 外协 / 工时录入
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('排产');
    expect(labels).toContain('外协');
    expect(labels).toContain('工时录入');
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
});

describe('ADMIN_ROLE_BADGE', () => {
  it('每个 Role 都有对应的角色 badge 文案', () => {
    for (const role of Object.values(Role)) {
      expect(ADMIN_ROLE_BADGE[role]).toBeTruthy();
    }
  });
});

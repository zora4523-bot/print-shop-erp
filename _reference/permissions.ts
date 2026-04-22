/**
 * 权限统一入口（骨架参考）
 *
 * 位置：lib/auth/permissions.ts
 *
 * 设计原则：
 * 1. 所有权限常量集中定义，避免散落字符串
 * 2. 所有 Server Action 必须调用 requirePermission() 或 requireOwnership()
 * 3. 修改权限规则只改此文件，不动业务代码
 *
 * 规范见 CLAUDE.md 第 4.6 节。
 */

import { Role } from '../../generated/prisma/client';
import { getSession } from './session';

// ============================================================
// 权限字典：所有权限key在这里集中定义
// ============================================================

export const PERMISSIONS = {
  // 工单
  'order:create':               [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:update:pre-schedule':  [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:update:post-schedule': [Role.OWNER, Role.FOREMAN],  // 已排产后只有老板和主管能改
  'order:view:all':             [Role.OWNER, Role.FOREMAN],
  'order:view:self':            [Role.SALES, Role.CUSTOMER_SERVICE],
  'order:schedule':             [Role.OWNER, Role.FOREMAN],
  'order:ship':                 [Role.OWNER, Role.FOREMAN],
  'order:mark-urgent':          [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:cancel':               [Role.OWNER],

  // 生产任务
  'task:assign':                [Role.OWNER, Role.FOREMAN],
  'task:report':                [Role.WORKER],  // 只能报自己的（需额外 ownership 检查）

  // 外协
  'outsource:manage':           [Role.OWNER, Role.FOREMAN],

  // 设计文件
  'design:upload':              [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'design:bundle:create':       [Role.OWNER, Role.FOREMAN],  // CDR汇总下载

  // 物料
  'material:manage':            [Role.OWNER, Role.FOREMAN],
  'material:issue':             [Role.OWNER, Role.FOREMAN, Role.WORKER],  // 领料

  // 账单
  'bill:view:all':              [Role.OWNER],
  'bill:view:self':             [Role.SALES],
  'bill:mark-paid':             [Role.OWNER],

  // 薪资
  'salary:view:all':            [Role.OWNER],
  'salary:view:self':           [Role.CUSTOMER_SERVICE, Role.WORKER],
  'salary:view:team':           [Role.FOREMAN],  // 主管看师傅提成
  'salary:rule:manage':         [Role.OWNER],

  // 字典管理
  'dict:product:manage':        [Role.OWNER],
  'dict:craft:manage':          [Role.OWNER],
  'dict:price:manage':          [Role.OWNER],

  // 推送
  'notification:config':        [Role.OWNER],

  // 账号管理
  'account:manage':             [Role.OWNER],

  // 报表
  'report:all':                 [Role.OWNER],
  'report:production':          [Role.OWNER, Role.FOREMAN],
} as const;

export type Permission = keyof typeof PERMISSIONS;

// ============================================================
// 权限检查函数
// ============================================================

/**
 * 要求用户拥有某个权限。失败抛 UnauthorizedError。
 * 
 * 用法：
 *   export async function createOrder(data) {
 *     const user = await requirePermission('order:create');
 *     // ...
 *   }
 */
export async function requirePermission(permission: Permission) {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError('未登录');
  }

  const allowedRoles = PERMISSIONS[permission];
  if (!allowedRoles) {
    throw new Error(`未定义的权限: ${permission}`);
  }

  if (!allowedRoles.includes(session.user.role as Role)) {
    throw new UnauthorizedError(`当前角色 ${session.user.role} 无 ${permission} 权限`);
  }

  return session.user;
}

/**
 * 要求用户是资源的所有者（或有全局权限）。
 * 
 * 用法：
 *   const user = await requirePermission('order:update:pre-schedule');
 *   await requireOwnership(order, user, 'submitterId');
 */
export async function requireOwnership<T extends Record<string, any>>(
  resource: T,
  user: { id: string; role: string },
  ownerField: keyof T,
  globalPermission?: Permission,
) {
  // 老板/主管通常有全局权限
  if (globalPermission) {
    const allowedRoles = PERMISSIONS[globalPermission];
    if (allowedRoles.includes(user.role as Role)) {
      return;  // 有全局权限，跳过所有权检查
    }
  }

  if (resource[ownerField] !== user.id) {
    throw new UnauthorizedError('无权操作此资源（非所有者）');
  }
}

/**
 * 获取当前用户可见的工单范围条件（用于 Prisma where）。
 * 
 * 用法：
 *   const user = await getSession();
 *   const orders = await db.order.findMany({
 *     where: getOrderScopeFilter(user),
 *   });
 */
export function getOrderScopeFilter(user: { id: string; role: Role }) {
  if (user.role === Role.OWNER || user.role === Role.FOREMAN) {
    return {};  // 看全部
  }
  if (user.role === Role.SALES || user.role === Role.CUSTOMER_SERVICE) {
    return { submitterId: user.id };  // 只看自己的
  }
  if (user.role === Role.WORKER) {
    // 师傅只看有分配给自己任务的工单
    return {
      items: {
        some: {
          tasks: {
            some: { workerId: user.id },
          },
        },
      },
    };
  }
  return { id: 'never-match' };  // 未知角色：看不到任何
}

// ============================================================
// 错误类型
// ============================================================

export class UnauthorizedError extends Error {
  constructor(message: string = '未授权') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

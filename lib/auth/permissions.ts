import { Role } from '../../generated/prisma/client';
import { getSession } from './session';
import { UnauthorizedError } from './errors';

// ============================================================
// 权限字典：所有权限 key 集中在此定义（CLAUDE.md §4.6）
// 修改权限规则只改此文件，不要散落在业务代码里。
// ============================================================

export const PERMISSIONS = {
  // 工单
  'order:create':               [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:update:pre-schedule':  [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:update:post-schedule': [Role.OWNER, Role.FOREMAN],
  'order:view:all':             [Role.OWNER, Role.FOREMAN],
  'order:view:self':            [Role.SALES, Role.CUSTOMER_SERVICE],
  'order:schedule':             [Role.OWNER, Role.FOREMAN],
  'order:ship':                 [Role.OWNER, Role.FOREMAN],
  'order:mark-urgent':          [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'order:cancel':               [Role.OWNER],

  // 生产任务
  'task:assign':                [Role.OWNER, Role.FOREMAN],
  'task:report':                [Role.WORKER],

  // 外协
  'outsource:manage':           [Role.OWNER, Role.FOREMAN],

  // 设计文件
  'design:upload':              [Role.SALES, Role.CUSTOMER_SERVICE, Role.OWNER, Role.FOREMAN],
  'design:bundle:create':       [Role.OWNER, Role.FOREMAN],

  // 物料
  'material:manage':            [Role.OWNER, Role.FOREMAN],
  'material:issue':             [Role.OWNER, Role.FOREMAN, Role.WORKER],

  // 账单
  'bill:view:all':              [Role.OWNER],
  'bill:view:self':             [Role.SALES, Role.CUSTOMER_SERVICE],
  'bill:mark-paid':             [Role.OWNER],

  // 薪资
  'salary:view:all':            [Role.OWNER],
  'salary:view:self':           [Role.CUSTOMER_SERVICE, Role.WORKER],
  'salary:view:team':           [Role.FOREMAN],
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
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

// ============================================================
// 检查函数
// ============================================================

/**
 * 要求当前 session 拥有指定权限。成功返回 session.user；失败抛 UnauthorizedError。
 *
 * 使用：每个 Server Action 的第一行都应走这个入口（CLAUDE.md §4.6）。
 */
export async function requirePermission(permission: Permission) {
  const session = await getSession();
  if (!session) {
    throw new UnauthorizedError('未登录');
  }

  const allowed = PERMISSIONS[permission] as readonly Role[] | undefined;
  if (!allowed) {
    throw new Error(`未定义的权限：${permission}`);
  }

  if (!allowed.includes(session.user.role)) {
    throw new UnauthorizedError(`当前角色 ${session.user.role} 无 ${permission} 权限`);
  }

  return session.user;
}

/**
 * 要求用户是资源所有者；如提供 globalPermission 且用户角色在该全局权限的白名单内，
 * 视为通过（典型场景：OWNER/FOREMAN 天生能看所有工单）。
 */
export async function requireOwnership<T extends Record<string, unknown>>(
  resource: T,
  user: { id: string; role: Role },
  ownerField: keyof T,
  globalPermission?: Permission,
) {
  if (globalPermission) {
    const allowed = PERMISSIONS[globalPermission] as readonly Role[];
    if (allowed.includes(user.role)) {
      return;
    }
  }

  if (resource[ownerField] !== user.id) {
    throw new UnauthorizedError('无权操作此资源（非所有者）');
  }
}

// Re-export so existing callers (server-only) don't have to chase the move.
// New code — especially anything imported from test environments — should
// import directly from './order-scope' to avoid pulling session / next-auth.
export { getOrderScopeFilter } from './order-scope';

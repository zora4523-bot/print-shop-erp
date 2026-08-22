import { Role } from '../../generated/prisma/enums';
import type { Session } from 'next-auth';
import { requireSession, requireVerifiedSession } from './session';
import { UnauthorizedError } from './errors';
import { PERMISSIONS, type Permission } from './permissions-dict';

// PERMISSIONS 字典本体已抽到 ./permissions-dict（零副作用），这里只
// 负责检查函数。下面 re-export 让现有 `import ... from
// '@/lib/auth/permissions'` 的调用方不需要改动。
export { PERMISSIONS, type Permission };

// ============================================================
// 检查函数
// ============================================================

/**
 * 要求当前 session 拥有指定权限。成功返回 session.user；失败抛 UnauthorizedError。
 *
 * 使用：每个 Server Action 的第一行都应走这个入口（CLAUDE.md §4.6）。
 */
function assertPermission(permission: Permission, role: Role) {
  const allowed = PERMISSIONS[permission] as readonly Role[] | undefined;
  if (!allowed) {
    throw new Error(`未定义的权限：${permission}`);
  }

  if (!allowed.includes(role)) {
    throw new UnauthorizedError(`当前角色 ${role} 无 ${permission} 权限`);
  }
}

export async function requirePermission(permission: Permission) {
  const session = await requireSession();
  assertPermission(permission, session.user.role);

  return session.user;
}

// Route Handlers receive this session from NextAuth's `auth(handler)` wrapper,
// then verify the current database account without calling headers() again.
export async function requireSessionPermission(
  permission: Permission,
  authSession: Session | null,
) {
  const session = await requireVerifiedSession(authSession);
  assertPermission(permission, session.user.role);

  return session.user;
}

/**
 * 要求用户是资源所有者；如提供 globalPermission 且用户角色在该全局权限的白名单内，
 * 视为通过（典型场景：ADMIN 天生能看所有工单）。
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

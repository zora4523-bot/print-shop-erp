import { redirect } from 'next/navigation';
import { Role } from '../generated/prisma/enums';
import { getSession } from '@/lib/auth/session';

// `/` is a role dispatcher — `(admin)/(foreman)/(worker)/(sales)`
// 各自的 landing 页才是真正的&ldquo;首页&rdquo;。这里不再渲染 UI（早期 P0 阶段
// 写的&ldquo;最小登录壳&rdquo;已废弃），保持纯逻辑层让每个角色直达 sidebar
// 内的工作流。
//
// 未来要做&ldquo;统一 portal 主页&rdquo;（跨角色），可以新建 `/home` 路由并把
// 这里改成 `redirect('/home')` 不影响现有跳转链。

const ROLE_LANDING: Record<Role, string> = {
  ADMIN: '/owner',
  SALES: '/orders',
  WORKER: '/worker/tasks',
};

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');
  redirect(ROLE_LANDING[session.user.role]);
}

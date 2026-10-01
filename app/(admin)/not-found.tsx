import { EmptyState } from '@/components/ui-business';

// 管理外壳同时服务管理员与外部销售：返回入口统一走 `/` 角色分发，
// 不把销售引到 /owner（审查 #25）。必须走 kind="no-access"：它带 data-kind 与 h1，
// 越权访问的 E2E 与读屏标题都依赖这两点。
export default function AdminNotFound() {
  return <EmptyState kind="no-access" homeHref="/" />;
}

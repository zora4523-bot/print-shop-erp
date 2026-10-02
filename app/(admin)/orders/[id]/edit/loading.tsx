import { AdminRouteLoading } from '@/components/business/admin/AdminRouteLoading';

export default function Loading() {
  // 编辑页页头保留受离开保护的返回按钮（§8.3 例外），骨架同样画出返回占位。
  return <AdminRouteLoading variant="detail" label="正在加载编辑工单" withBack />;
}

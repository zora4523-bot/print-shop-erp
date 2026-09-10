import type { OrderStatus } from '@/generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import { salesOrderStatusPresentation } from '@/lib/order/sales-list-presentation';

// 销售端工单状态徽章——tone 走共享六档（StatusBadge + StatusTone），
// label 走销售词表：SCHEDULING / IN_PRODUCTION / COMPLETED 合并成
// 「生产中」，与管理端 OrderStatusBadge 有意不同（见
// lib/order/sales-list-presentation.ts 的注释）。
//
// 销售列表卡片、明细抽屉、详情页头共用这一个，替代原先
// SalesOrdersList / SalesOrderDetailView 里两份逐字重复的 tone 类名表。
export function SalesOrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const definition = salesOrderStatusPresentation(status);
  return (
    <StatusBadge
      tone={definition.tone}
      dot={definition.dot}
      className={className}
    >
      {definition.label}
    </StatusBadge>
  );
}

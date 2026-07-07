import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '../../../generated/prisma/enums';
import { promisedDateAlert } from '@/lib/order/promised-date';

// 承诺交期预警徽标：逾期红、3 天内到期黄；已发货/已完结/已取消或
// 未填交期不显示。口径全部来自 lib/order/promised-date。
export function PromisedDateBadge({
  promisedDate,
  status,
}: {
  promisedDate: Date | null;
  status: OrderStatus;
}) {
  const alert = promisedDateAlert(promisedDate, status);
  if (!alert) return null;
  if (alert.kind === 'overdue') {
    return <Badge variant="destructive">逾期 {alert.days} 天</Badge>;
  }
  return (
    <Badge
      variant="outline"
      className="border-warning/50 bg-warning/10 text-warning-foreground"
    >
      {alert.days === 0 ? '今天到期' : `剩 ${alert.days} 天`}
    </Badge>
  );
}

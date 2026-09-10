import type { OrderStatus } from '../../../generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import { promisedDateAlert } from '@/lib/order/promised-date';
import { promisedDateAlertDefinition } from '@/lib/ui/status-registry';

// 承诺交期预警徽标：逾期红、3 天内到期黄；已发货/已完结/已取消或
// 未填交期不显示。口径来自 lib/order/promised-date，文案与色调来自
// lib/ui/status-registry（§6：业务组件不写本地 tone 类名）。
export function PromisedDateBadge({
  promisedDate,
  status,
}: {
  promisedDate: Date | null;
  status: OrderStatus;
}) {
  const alert = promisedDateAlert(promisedDate, status);
  if (!alert) return null;
  const definition = promisedDateAlertDefinition(alert.kind, alert.days);
  return <StatusBadge tone={definition.tone}>{definition.label}</StatusBadge>;
}

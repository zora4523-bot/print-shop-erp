import { OrderStatus } from '@/generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import {
  ORDER_STATUS_REGISTRY,
  type StatusDefinition,
} from '@/lib/ui/status-registry';

const UNKNOWN_STATUS: StatusDefinition = { label: '未识别配置', tone: 'neutral' };

/**
 * 月账单成员行的工单状态快照（`orderStatusSnapshot` 是 VarChar，不受枚举约束）。
 * 薄封装：只把快照值转发给 ORDER_STATUS_REGISTRY（ui-规范 §6），未识别值显示
 * 「未识别配置」，不回显原始枚举。取消单进账单时收的是取消费，文字补注以免与
 * 正常结算金额混读。
 */
export function OrderStatusSnapshotBadge({ snapshot }: { snapshot: string }) {
  const definition = Object.hasOwn(ORDER_STATUS_REGISTRY, snapshot)
    ? ORDER_STATUS_REGISTRY[snapshot as OrderStatus]
    : UNKNOWN_STATUS;
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
      {snapshot === OrderStatus.CANCELLED ? '（取消费）' : ''}
    </StatusBadge>
  );
}

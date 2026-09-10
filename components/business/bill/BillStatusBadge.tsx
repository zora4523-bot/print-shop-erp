import type { BillStatus } from '@/generated/prisma/enums';
import { StatusBadge } from '@/components/ui-business';
import { BILL_STATUS_REGISTRY } from '@/lib/ui/status-registry';

// 账单状态徽章——列表页与详情页共用同一份 label / tone / dot，
// 映射集中在 lib/ui/status-registry.ts（UI 规范 §6）。
// 归并前 sales/bills/page.tsx 与 sales/bills/[id]/page.tsx 各自
// 定义了一份逐字相同的私有实现。
export function BillStatusBadge({ status }: { status: BillStatus }) {
  const definition = BILL_STATUS_REGISTRY[status];
  return (
    <StatusBadge tone={definition.tone} dot={definition.dot}>
      {definition.label}
    </StatusBadge>
  );
}

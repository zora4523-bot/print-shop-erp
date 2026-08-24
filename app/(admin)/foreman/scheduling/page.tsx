import { CalendarCheck } from 'lucide-react';
import { getPendingSchedulingBoard } from '@/lib/production';
import { ActionNotice, EmptyState, PageHeader } from '@/components/ui-business';
import { requirePermission } from '@/lib/auth/permissions';
import { PendingSchedulingBoard } from '@/components/business/production/PendingSchedulingBoard';

export const metadata = { title: '待排产工单' };

const MAX_SCHEDULING_HANDOFF_ORDERS = 30;
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type SchedulingHandoffParseResult = {
  provided: boolean;
  orderIds: string[];
  invalidCount: number;
  overflowCount: number;
};

export function parseSchedulingHandoffOrderIds(
  raw: string | string[] | undefined,
): SchedulingHandoffParseResult {
  if (raw === undefined) {
    return {
      provided: false,
      orderIds: [],
      invalidCount: 0,
      overflowCount: 0,
    };
  }

  const values = Array.isArray(raw) ? raw : [raw];
  const orderIds: string[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;
  let overflowCount = 0;

  for (const value of values) {
    if (!ORDER_ID_PATTERN.test(value)) {
      invalidCount += 1;
      continue;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    if (orderIds.length >= MAX_SCHEDULING_HANDOFF_ORDERS) {
      overflowCount += 1;
      continue;
    }
    orderIds.push(value);
  }

  return { provided: true, orderIds, invalidCount, overflowCount };
}

type SchedulingListPageProps = {
  searchParams: Promise<{
    orderIds?: string | string[];
  }>;
};

export default async function SchedulingListPage({
  searchParams,
}: SchedulingListPageProps) {
  // Page-level server-side authz (defense-in-depth: layout gate
  // doesn't re-run on soft navigation; lib read is unscoped global data).
  await requirePermission('order:schedule');
  const query = await searchParams;
  const parsedHandoff = parseSchedulingHandoffOrderIds(query.orderIds);
  const board = await getPendingSchedulingBoard();
  const pendingOrderIds = new Set(board.orders.map((order) => order.id));
  const matchedOrderIds = parsedHandoff.orderIds.filter((orderId) =>
    pendingOrderIds.has(orderId),
  );
  const handoff = parsedHandoff.provided
    ? {
        requestedOrderIds: parsedHandoff.orderIds,
        matchedOrderIds,
        invalidCount: parsedHandoff.invalidCount,
        overflowCount: parsedHandoff.overflowCount,
      }
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="待排产"
        subtitle="已提交工单按急单、承诺交期和提交时间排列。先选师傅，再跨工单批量分配其兼容工艺；其他工艺继续等待对应师傅。"
      />

      {board.orders.length === 0 ? (
        <div className="space-y-4">
          {handoff ? (
            <ActionNotice
              tone="warning"
              title="交接工单未命中当前待排产"
              description={`有效交接 ${handoff.requestedOrderIds.length} 项，当前命中 0 项${handoff.invalidCount > 0 ? `；${handoff.invalidCount} 个参数格式非法已忽略` : ''}${handoff.overflowCount > 0 ? `；${handoff.overflowCount} 项超出单次 ${MAX_SCHEDULING_HANDOFF_ORDERS} 项限制已忽略` : ''}。这些工单可能已排产、状态已变更或不在当前权限范围；系统未执行任何写入。`}
            />
          ) : null}
          <EmptyState
            icon={CalendarCheck}
            title="没有待排产的工单"
            description="销售 / 客服提交的工单会出现在这里等待排产。"
          />
        </div>
      ) : (
        <PendingSchedulingBoard
          orders={board.orders}
          workers={board.workers}
          handoff={handoff}
        />
      )}
    </div>
  );
}

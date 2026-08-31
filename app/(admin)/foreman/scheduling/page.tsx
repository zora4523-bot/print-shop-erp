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
        subtitle="工单按急单和交期排序；先选师傅，再批量分配其可承接的工艺。"
      />

      {board.orders.length === 0 ? (
        <div className="space-y-4">
          {handoff ? (
            <ActionNotice
              tone="warning"
              title="交接工单未命中当前待排产"
              description={`所选工单当前均不可排产，可能已排产、状态变化或无权查看${handoff.invalidCount > 0 ? `；${handoff.invalidCount} 项无效记录已忽略` : ''}${handoff.overflowCount > 0 ? `；${handoff.overflowCount} 项超出单次 ${MAX_SCHEDULING_HANDOFF_ORDERS} 项限制已忽略` : ''}。没有分配任何任务。`}
            />
          ) : null}
          <EmptyState
            icon={CalendarCheck}
            title="没有待排产的工单"
            description="已提交、待排产的工单会显示在这里。"
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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  MachineType,
  OrderKind,
  Role,
  WorkerType,
} from '@/generated/prisma/enums';
import type {
  PendingSchedulingOrderView,
  SchedulingViewCandidate,
} from '@/lib/production';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/actions/production', () => ({
  batchScheduleOrdersAction: vi.fn(),
}));

import {
  batchScheduleImpactItems,
  failedOrderIdsForRetry,
  PendingSchedulingBoard,
  resolveSchedulingHandoff,
  schedulingHandoffNotice,
} from '../PendingSchedulingBoard';

const worker: SchedulingViewCandidate = {
  id: 'worker-1',
  displayName: '王师傅',
  workerType: WorkerType.MACHINE,
  machineType: MachineType.HAND_PRESS,
  machineCapabilities: [MachineType.HAND_PRESS],
  craftCapabilityIds: ['craft-1'],
  pendingTaskCount: 3,
  inProgressTaskCount: 2,
};

function order(
  overrides: Partial<PendingSchedulingOrderView> = {},
): PendingSchedulingOrderView {
  return {
    id: 'order-1',
    orderNo: 'PS-20260824-001',
    customName: '测试工单',
    kind: OrderKind.NORMAL,
    sourceOrder: null,
    isUrgent: false,
    customerRef: null,
    promisedDate: new Date('2026-08-27T04:00:00.000Z'),
    submittedAt: new Date('2026-08-24T04:00:00.000Z'),
    createdAt: new Date('2026-08-24T03:00:00.000Z'),
    submitter: { displayName: '销售 A', role: Role.SALES },
    itemCount: 1,
    totalQuantity: 5000,
    internalTaskCount: 3,
    assignedTaskCount: 0,
    remainingTaskCount: 3,
    craftSummaries: [],
    compatibleWorkerIds: [worker.id],
    compatibleTaskCounts: { [worker.id]: 2 },
    recommendedTaskCounts: { [worker.id]: 1 },
    overrideTaskCounts: { [worker.id]: 1 },
    batchBlockReason: null,
    ...overrides,
  };
}

describe('PendingSchedulingBoard batch confirmation', () => {
  it('lists the worker, per-order task count and promised date before scheduling', () => {
    const impact = batchScheduleImpactItems({
      worker,
      orders: [
        order(),
        order({
          id: 'order-2',
          orderNo: 'PS-20260824-002',
          promisedDate: null,
          remainingTaskCount: 1,
          compatibleTaskCounts: { [worker.id]: 1 },
          recommendedTaskCounts: { [worker.id]: 1 },
          overrideTaskCounts: { [worker.id]: 0 },
        }),
      ],
    }).join('\n');

    expect(impact).toContain('接单师傅：王师傅');
    expect(impact).toContain('当前在制 5 个任务');
    expect(impact).toContain('批量范围：2 张工单，共 3 个匹配任务');
    expect(impact).toContain(
      '工单 PS-20260824-001：分配 2 个匹配任务；承诺交期 2026/08/27；仍有 1 个内部任务待排',
    );
    expect(impact).toContain(
      '工单 PS-20260824-002：分配 1 个匹配任务；承诺交期 未设置；预计完成全部排产',
    );
  });

  it('keeps the existing per-order transaction and partial-result contract visible', () => {
    const impact = batchScheduleImpactItems({
      worker,
      orders: [order()],
    }).join('\n');

    expect(impact).toContain('1 个任务不在该师傅的熟练工艺推荐内');
    expect(impact).toContain('每张工单使用独立事务');
    expect(impact).toContain('逐项重新校验并返回成功或失败');
    expect(impact).toContain('单张失败不会回滚其他已成功工单');
  });

  it('retains only distinct failed orders for a bounded retry', () => {
    const failures = Array.from({ length: 32 }, (_, index) => ({
      orderId: `order-${index + 1}`,
    }));

    expect(
      failedOrderIdsForRetry([
        failures[0],
        failures[0],
        ...failures.slice(1),
      ]),
    ).toEqual(failures.slice(0, 30).map((failure) => failure.orderId));
  });

  it('keeps failed eligible selections available after a partial result', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'PendingSchedulingBoard.tsx',
      ),
      'utf8',
    );

    expect(source).toContain(
      'setSelected(new Set(failedOrderIdsForRetry(result.failed)))',
    );
    expect(source).toContain('失败工单会保留勾选');
    expect(source).toContain('selectableIds.has(orderId)');
  });

  it('routes the mutation through the shared L2 confirmation dialog', () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'PendingSchedulingBoard.tsx',
      ),
      'utf8',
    );

    expect(source).toContain('<ConfirmActionDialog');
    expect(source).toContain('level="L2"');
    expect(source).toContain('onConfirm={submitBatch}');
    expect(source).not.toContain('onClick={submitBatch}');
  });

  it('keeps the sticky batch controls below the admin header while scrolling', () => {
    const html = renderToStaticMarkup(
      <PendingSchedulingBoard orders={[order()]} workers={[worker]} />,
    );
    const source = readFileSync(
      path.join(
        process.cwd(),
        'components',
        'business',
        'production',
        'PendingSchedulingBoard.tsx',
      ),
      'utf8',
    );
    const globalStyles = readFileSync(
      path.join(process.cwd(), 'app', 'globals.css'),
      'utf8',
    );

    expect(html).toMatch(
      /<section class="[^"]*admin-sticky-below-header[^"]*lg:sticky[^"]*" aria-label="跨工单批量排产"/,
    );
    expect(source).not.toContain('lg:top-0');
    expect(globalStyles).toMatch(
      /\.admin-sticky-below-header\s*\{\s*top:\s*var\(--admin-header-offset\);\s*\}/,
    );
  });

  it('preselects only compatible handoff orders and explains every exclusion', () => {
    const compatible = order();
    const incompatible = order({
      id: 'order-2',
      orderNo: 'PS-20260824-002',
      compatibleTaskCounts: { [worker.id]: 0 },
      recommendedTaskCounts: { [worker.id]: 0 },
      overrideTaskCounts: { [worker.id]: 0 },
    });
    const blocked = order({
      id: 'order-3',
      orderNo: 'PS-20260824-003',
      batchBlockReason: '工单仍有缺失的工艺配置',
    });
    const unrelated = order({
      id: 'order-4',
      orderNo: 'PS-20260824-004',
    });
    const resolution = resolveSchedulingHandoff({
      orders: [compatible, incompatible, blocked, unrelated],
      workerId: worker.id,
      handoff: {
        requestedOrderIds: [
          compatible.id,
          incompatible.id,
          blocked.id,
          'order-not-pending',
        ],
        matchedOrderIds: [compatible.id, incompatible.id, blocked.id],
        invalidCount: 1,
        overflowCount: 2,
      },
    });

    expect(resolution.compatibleOrderIds).toEqual([compatible.id]);
    expect(resolution.incompatibleOrders.map((item) => item.id)).toEqual([
      incompatible.id,
      blocked.id,
    ]);
    expect(resolution.matchedOrders.map((item) => item.id)).not.toContain(
      unrelated.id,
    );
    expect(resolution.unmatchedCount).toBe(1);

    const notice = schedulingHandoffNotice(resolution, worker.displayName);
    expect(notice.tone).toBe('warning');
    expect(notice.title).toContain('自动预选 1 张兼容工单');
    expect(notice.description).toContain('PS-20260824-002');
    expect(notice.description).toContain('与当前师傅无兼容工艺');
    expect(notice.description).toContain('PS-20260824-003');
    expect(notice.description).toContain('工单仍有缺失的工艺配置');
    expect(notice.description).toContain('1 张未命中当前待排产');
    expect(notice.description).toContain('1 个非法 ID 已忽略');
    expect(notice.description).toContain('2 张超出单次 30 张限制已忽略');
    expect(notice.description).toContain('服务端重新校验权限');
  });

  it('announces handoff scope before a worker is selected', () => {
    const html = renderToStaticMarkup(
      <PendingSchedulingBoard
        orders={[order()]}
        workers={[worker]}
        handoff={{
          requestedOrderIds: ['order-1', 'order-not-pending'],
          matchedOrderIds: ['order-1'],
          invalidCount: 0,
          overflowCount: 0,
        }}
      />,
    );

    expect(html).toContain('已接收工单列表交接');
    expect(html).toContain('当前待排产命中 1 张');
    expect(html).toContain('选择师傅后，只会自动预选');
    expect(html).toContain('1 张未命中当前待排产');
  });
});

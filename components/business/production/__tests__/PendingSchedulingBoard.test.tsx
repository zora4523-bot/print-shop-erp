import { readFileSync } from 'node:fs';
import path from 'node:path';
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

import { batchScheduleImpactItems } from '../PendingSchedulingBoard';

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
});

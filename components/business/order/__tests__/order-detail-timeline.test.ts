import { describe, expect, it } from 'vitest';
import {
  OrderStatus,
  TaskStatus,
} from '../../../../generated/prisma/enums';
import {
  buildOrderDetailTimeline,
  orderCancelImpact,
} from '../order-detail-timeline';

describe('buildOrderDetailTimeline', () => {
  it('renders the new pending-factory state at the submission step', () => {
    const submittedAt = new Date('2026-08-07T01:40:00.000Z');
    const steps = buildOrderDetailTimeline({
      status: OrderStatus.PENDING_FACTORY,
      createdAt: new Date('2026-08-07T01:12:00.000Z'),
      submittedAt,
      promisedDate: null,
      submitterName: 'E2E 销售',
      logs: [],
      tasks: [],
      assignedWorkerCount: 0,
      uncoveredOutsourceNames: [],
      hasLiveOutsource: false,
      pendingChangeRequest: false,
    });

    expect(steps[0]?.state).toBe('done');
    expect(steps[1]).toMatchObject({
      label: '待工厂确认',
      state: 'current',
    });
    expect(steps[1]?.meta).toContain('E2E 销售');
  });

  it('marks the current production step and surfaces uncovered outsource as a blocker', () => {
    const steps = buildOrderDetailTimeline({
      status: OrderStatus.IN_PRODUCTION,
      createdAt: new Date('2026-08-07T01:12:00.000Z'),
      submittedAt: new Date('2026-08-07T01:40:00.000Z'),
      promisedDate: new Date('2026-09-12T00:00:00.000Z'),
      submitterName: 'E2E 销售',
      logs: [],
      tasks: [
        { status: TaskStatus.COMPLETED },
        { status: TaskStatus.COMPLETED },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.PENDING },
      ],
      assignedWorkerCount: 3,
      uncoveredOutsourceNames: ['#1 外盒'],
      hasLiveOutsource: true,
      pendingChangeRequest: false,
    });

    expect(steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'done',
      'blocked',
      'pending',
      'pending',
      'pending',
    ]);
    expect(steps[3]?.block).toContain('#1 外盒');
    expect(steps[3]?.label).toBe('生产中');
    expect(steps[2]?.meta).toContain('已分派 3 名师傅');
  });

  it('renders cancelled as the current terminal step without inventing later stamps', () => {
    const steps = buildOrderDetailTimeline({
      status: OrderStatus.CANCELLED,
      createdAt: new Date('2026-08-07T01:12:00.000Z'),
      submittedAt: null,
      promisedDate: null,
      submitterName: 'E2E 销售',
      logs: [],
      tasks: [],
      assignedWorkerCount: 0,
      uncoveredOutsourceNames: [],
      hasLiveOutsource: false,
      pendingChangeRequest: false,
    });

    expect(steps[0]?.label).toBe('已取消');
    expect(steps[0]?.state).toBe('current');
    expect(steps[0]?.meta).toBe('已取消');
  });
});

describe('orderCancelImpact', () => {
  it('lists already-loaded task and outsource counts', () => {
    expect(
      orderCancelImpact({
        pendingTaskCount: 2,
        inProgressTaskCount: 1,
        completedTaskCount: 3,
        liveOutsourceCount: 1,
      }),
    ).toEqual([
      { label: '取消未开工的生产任务', value: '2 个' },
      { label: '进行中任务需人工收尾', value: '1 个' },
      { label: '已完工任务保留计件工资', value: '3 个' },
      { label: '外协单需人工处理', value: '1 单已发出或进行中' },
    ]);
  });
});

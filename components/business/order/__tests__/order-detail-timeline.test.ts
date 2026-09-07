import { describe, expect, it } from 'vitest';
import { OrderStatus } from '../../../../generated/prisma/enums';
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
      completedAt: null,
      promisedDate: null,
      submitterName: 'E2E 销售',
      logs: [],
      productionUnits: [],
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
      completedAt: null,
      promisedDate: new Date('2026-09-12T00:00:00.000Z'),
      submitterName: 'E2E 销售',
      logs: [],
      productionUnits: [
        { status: 'COMPLETED' },
        { status: 'COMPLETED' },
        { status: 'IN_PROGRESS' },
        { status: 'PENDING' },
      ],
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
    expect(steps[2]?.meta).toContain('已生成 4 个生产工序');
  });

  it('uses completedAt as the canonical PACKING completion fact', () => {
    const steps = buildOrderDetailTimeline({
      status: OrderStatus.PACKING,
      createdAt: new Date('2026-09-02T01:00:00.000Z'),
      submittedAt: new Date('2026-09-02T01:10:00.000Z'),
      completedAt: new Date('2026-09-02T02:03:00.000Z'),
      promisedDate: null,
      submitterName: 'E2E 销售',
      logs: [
        {
          action: 'PRODUCTION_COMPLETED',
          createdAt: new Date('2026-09-02T02:04:00.000Z'),
          operatorName: '师傅甲',
        },
      ],
      productionUnits: [{ status: 'COMPLETED' }],
      uncoveredOutsourceNames: [],
      hasLiveOutsource: false,
      pendingChangeRequest: false,
    });

    expect(steps[4]).toMatchObject({
      label: '生产已完成',
      state: 'current',
      meta: '2026/09/02 10:03 · 师傅甲',
      block: null,
    });
  });

  it('keeps the legacy COMPLETED status log as a completion fallback', () => {
    const steps = buildOrderDetailTimeline({
      status: OrderStatus.COMPLETED,
      createdAt: new Date('2026-08-07T01:12:00.000Z'),
      submittedAt: new Date('2026-08-07T01:40:00.000Z'),
      completedAt: null,
      promisedDate: null,
      submitterName: 'E2E 销售',
      logs: [
        {
          action: 'STATUS_CHANGE',
          createdAt: new Date('2026-08-07T03:20:00.000Z'),
          operatorName: '老系统',
          changedFields: {
            status: { before: 'IN_PRODUCTION', after: 'COMPLETED' },
          },
        },
      ],
      productionUnits: [{ status: 'COMPLETED' }],
      uncoveredOutsourceNames: [],
      hasLiveOutsource: false,
      pendingChangeRequest: false,
    });

    expect(steps[4]).toMatchObject({
      label: '已完工',
      state: 'current',
      meta: '2026/08/07 11:20 · 老系统',
    });
  });

  it('does not let a superseded completion log complete a reopened generation', () => {
    const steps = buildOrderDetailTimeline({
      status: OrderStatus.PACKING,
      createdAt: new Date('2026-09-02T01:00:00.000Z'),
      submittedAt: new Date('2026-09-02T01:10:00.000Z'),
      completedAt: null,
      promisedDate: null,
      submitterName: 'E2E 销售',
      logs: [
        {
          action: 'PRODUCTION_COMPLETED',
          createdAt: new Date('2026-09-01T02:04:00.000Z'),
          operatorName: '旧版操作人',
        },
      ],
      productionUnits: [{ status: 'IN_PROGRESS' }],
      uncoveredOutsourceNames: [],
      hasLiveOutsource: false,
      pendingChangeRequest: false,
    });

    expect(steps[4]).toMatchObject({
      label: '等待完工',
      state: 'current',
      meta: '内部工序完工后转入',
    });
  });

  it('renders cancelled as the current terminal step without inventing later stamps', () => {
    const steps = buildOrderDetailTimeline({
      status: OrderStatus.CANCELLED,
      createdAt: new Date('2026-08-07T01:12:00.000Z'),
      submittedAt: null,
      completedAt: null,
      promisedDate: null,
      submitterName: 'E2E 销售',
      logs: [],
      productionUnits: [],
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
        pendingProductionCount: 2,
        inProgressProductionCount: 1,
        completedProductionCount: 3,
        liveOutsourceCount: 1,
      }),
    ).toEqual([
      { label: '取消未开工的生产工序', value: '2 个' },
      { label: '进行中工序需人工收尾', value: '1 个' },
      { label: '已报工记录保留金额快照', value: '3 个' },
      { label: '外协单需人工处理', value: '1 单已发出或进行中' },
    ]);
  });
});

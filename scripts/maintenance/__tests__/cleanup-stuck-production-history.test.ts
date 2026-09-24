import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderStatus, ProductionOperationStatus, Role } from '../../../generated/prisma/enums';

// lib/audit-log 加载时会创建 Prisma 连接；本测试只用事务 mock。
vi.mock('../../../lib/db', () => ({ db: {} }));

import {
  classifyPrematureSchedule,
  parseCleanupArgs,
  PREMATURE_SCHEDULE_LOG_ACTION,
  runStuckProductionCleanup,
  STALE_GENERATION_LOG_ACTION,
  type PrematureScheduleRow,
} from '../cleanup-stuck-production-history';

const UNFINISHED = [ProductionOperationStatus.PENDING, ProductionOperationStatus.IN_PROGRESS];
const tieredBook = { rules: [{ operationType: 'PARTIAL', unit: 'PER_PASS', smallOrderAmount: '12.0000' }] };
const scheduledAt = new Date('2026-09-10T02:00:00.000Z');

function scheduleRow(overrides: Partial<PrematureScheduleRow> = {}): PrematureScheduleRow {
  return {
    id: 'order-confirmed',
    orderNo: 'GD-260910-001',
    status: OrderStatus.CONFIRMED,
    scheduledAt,
    _count: { productionOperations: 0, productionProgressSteps: 0 },
    items: [{ _count: { tasks: 0 } }],
    workflowDecisions: [],
    logs: [],
    ...overrides,
  };
}

type State = {
  database: string;
  stale: { id: string; orderNo: string; status: OrderStatus; workOrderVersion: number }[];
  operations: unknown[];
  steps: { id: string }[];
  schedules: PrematureScheduleRow[];
  clearedCount: number;
};

function harness(overrides: Partial<State> = {}) {
  const state: State = {
    database: 'erp_cleanup_test',
    stale: [{ id: 'order-stale', orderNo: 'GD-260901-009', status: OrderStatus.PACKING, workOrderVersion: 3 }],
    operations: [
      { id: 'op-tiered', operationType: 'PARTIAL', reports: [{ unit: 'PER_PASS', priceBook: tieredBook }] },
      { id: 'op-pending', operationType: 'FULL', reports: [] },
    ],
    steps: [{ id: 'step-old' }],
    schedules: [
      scheduleRow(),
      scheduleRow({ id: 'order-held', orderNo: 'GD-260910-002', status: OrderStatus.ON_HOLD, workflowDecisions: [{ fromStatus: OrderStatus.CONFIRMED }] }),
      scheduleRow({ id: 'order-evidence', orderNo: 'GD-260910-003', logs: [{ id: 'log-release' }] }),
    ],
    clearedCount: 1,
    ...overrides,
  };
  const executed: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executed.push(strings.join('?') + (values.length ? ` :: ${values.join(',')}` : ''));
      return 0;
    }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('current_database()')) return [{ name: state.database }];
      const orderId = values[0] as string | null;
      return state.stale.filter((row) => orderId === null || row.id === orderId);
    }),
    user: {
      findUnique: vi.fn(async (): Promise<{ id: string; role: Role; username: string; displayName: string; isActive: boolean }> =>
        ({ id: 'admin-1', role: Role.ADMIN, username: 'owner', displayName: '老板', isActive: true })),
    },
    order: {
      findMany: vi.fn(async ({ where }: { where: { id?: string } }) =>
        state.schedules.filter((row) => !where.id || row.id === where.id)),
      updateMany: vi.fn(async () => ({ count: state.clearedCount })),
    },
    orderLog: { create: vi.fn(async () => ({})) },
    businessAuditLog: { create: vi.fn(async () => ({})) },
    productionOperation: {
      findMany: vi.fn(async () => state.operations),
      updateMany: vi.fn(async () => ({ count: state.operations.length })),
    },
    productionProgressStep: {
      findMany: vi.fn(async () => state.steps),
      updateMany: vi.fn(async () => ({ count: state.steps.length })),
    },
  };
  const client = {
    $transaction: vi.fn(async (fn: (value: typeof tx) => Promise<unknown>, options?: unknown) => {
      void options;
      return fn(tx);
    }),
  };
  return { state, tx, client: client as never, transaction: client.$transaction, executed };
}

const writes = (tx: ReturnType<typeof harness>['tx']) => [
  tx.order.updateMany, tx.orderLog.create, tx.businessAuditLog.create,
  tx.productionOperation.updateMany, tx.productionProgressStep.updateMany,
];

describe('parseCleanupArgs', () => {
  it('默认 dry-run，且必须显式确认数据库', () => {
    expect(parseCleanupArgs(['--database=erp'])).toEqual({ apply: false, database: 'erp', actorUsername: null });
    expect(() => parseCleanupArgs([])).toThrow('--database');
    expect(() => parseCleanupArgs(['--database='])).toThrow('--database');
  });

  it('--apply 必须带管理员；未知或重复参数直接拒绝', () => {
    expect(() => parseCleanupArgs(['--database=erp', '--apply'])).toThrow('--actor');
    expect(parseCleanupArgs(['--database=erp', '--apply', '--actor=owner'])).toEqual({ apply: true, database: 'erp', actorUsername: 'owner' });
    expect(() => parseCleanupArgs(['--database=erp', '--database=other'])).toThrow('参数无效');
    expect(() => parseCleanupArgs(['--database=erp', '--force'])).toThrow('参数无效');
  });
});

describe('classifyPrematureSchedule（L-14 选择口径）', () => {
  it('从未下发的 CONFIRMED 带 scheduledAt 才清理', () => {
    expect(classifyPrematureSchedule(scheduleRow())).toEqual({ kind: 'CLEAR' });
    expect(classifyPrematureSchedule(scheduleRow({ scheduledAt: null }))).toEqual({ kind: 'NOT_APPLICABLE' });
  });

  it('暂停工单只处理暂停前为 CONFIRMED 的；已下发后暂停的 scheduledAt 是真实下发时间', () => {
    expect(classifyPrematureSchedule(scheduleRow({ status: OrderStatus.ON_HOLD, workflowDecisions: [{ fromStatus: OrderStatus.CONFIRMED }] })))
      .toEqual({ kind: 'CLEAR' });
    expect(classifyPrematureSchedule(scheduleRow({ status: OrderStatus.ON_HOLD, workflowDecisions: [{ fromStatus: OrderStatus.RELEASED }] })))
      .toEqual({ kind: 'NOT_APPLICABLE' });
    expect(classifyPrematureSchedule(scheduleRow({ status: OrderStatus.ON_HOLD }))).toEqual({ kind: 'NOT_APPLICABLE' });
    expect(classifyPrematureSchedule(scheduleRow({ status: OrderStatus.RELEASED }))).toEqual({ kind: 'NOT_APPLICABLE' });
  });

  it.each([
    ['生产工序', { _count: { productionOperations: 1, productionProgressSteps: 0 } }],
    ['进度步骤', { _count: { productionOperations: 0, productionProgressSteps: 2 } }],
    ['旧版任务', { items: [{ _count: { tasks: 1 } }] }],
    ['下发日志', { logs: [{ id: 'log-1' }] }],
  ] as const)('有%s等下发证据时转人工核对，不自动清理', (_label, overrides) => {
    expect(classifyPrematureSchedule(scheduleRow(overrides as Partial<PrematureScheduleRow>))).toMatchObject({ kind: 'SKIP' });
  });
});

describe('runStuckProductionCleanup', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('dry-run 在只读事务里列出数量与 id，不写任何数据', async () => {
    const report = await runStuckProductionCleanup(h.client, { apply: false, database: 'erp_cleanup_test', actorUsername: null });
    expect(h.executed[0]).toBe('SET TRANSACTION READ ONLY');
    expect(h.transaction.mock.calls[0]?.[1]).toMatchObject({ isolationLevel: 'RepeatableRead' });
    expect(report).toMatchObject({
      mode: 'DRY_RUN',
      staleGenerations: {
        orderCount: 1, operationCount: 2, payrollReviewOperationCount: 1, progressStepCount: 1,
        orders: [{ orderId: 'order-stale', workOrderVersion: 3, operationIds: ['op-tiered', 'op-pending'], payrollReviewOperationIds: ['op-tiered'], progressStepIds: ['step-old'] }],
      },
      prematureSchedules: {
        orderCount: 2,
        orders: [{ orderId: 'order-confirmed', scheduledAt: scheduledAt.toISOString() }, { orderId: 'order-held', status: OrderStatus.ON_HOLD }],
        skipped: [{ orderId: 'order-evidence', reason: '日志中有下发记录，请人工核对' }],
      },
    });
    expect(h.tx.productionOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: 'order-stale', workOrderVersion: { lt: 3 }, status: { in: UNFINISHED } },
    }));
    for (const write of writes(h.tx)) expect(write).not.toHaveBeenCalled();
    expect(h.tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('连接的数据库与确认名不一致时什么都不做', async () => {
    await expect(runStuckProductionCleanup(h.client, { apply: true, database: 'print_shop_erp', actorUsername: 'owner' }))
      .rejects.toThrow('数据库确认不匹配');
    for (const write of writes(h.tx)) expect(write).not.toHaveBeenCalled();
  });

  it('非活跃管理员不能执行 --apply', async () => {
    h.tx.user.findUnique.mockResolvedValueOnce({ id: 'sales-1', role: Role.SALES, username: 's', displayName: '销售', isActive: true });
    await expect(runStuckProductionCleanup(h.client, { apply: true, database: 'erp_cleanup_test', actorUsername: 's' }))
      .rejects.toThrow('活跃管理员');
    for (const write of writes(h.tx)) expect(write).not.toHaveBeenCalled();
  });

  it('--apply 逐单持级联锁，按升版口径终止旧代次并转人工核定，写 OrderLog 与审计', async () => {
    const report = await runStuckProductionCleanup(h.client, { apply: true, database: 'erp_cleanup_test', actorUsername: 'owner' });
    expect(h.executed).toContain("SET LOCAL lock_timeout = '5s'");
    expect(h.executed).toContain('SELECT pg_advisory_xact_lock(hashtext(?)) :: print-shop-erp:order-cascade:order-stale');
    expect(h.tx.productionOperation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['op-tiered'] } }, data: { payrollReviewRequired: true } });
    expect(h.tx.productionOperation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['op-tiered', 'op-pending'] }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    expect(h.tx.productionProgressStep.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['step-old'] }, status: { in: UNFINISHED } },
      data: { status: ProductionOperationStatus.CANCELLED },
    });
    expect(h.tx.orderLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      orderId: 'order-stale', operatorId: 'admin-1', action: STALE_GENERATION_LOG_ACTION,
      changedFields: expect.objectContaining({ supersededProduction: expect.objectContaining({ payrollReviewOperationIds: ['op-tiered'] }) }),
    }) });
    expect(report.staleGenerations).toMatchObject({ orderCount: 1, operationCount: 2, payrollReviewOperationCount: 1 });
  });

  it('--apply 只清空从未下发工单的 scheduledAt，以原值作并发前置条件并留痕', async () => {
    const report = await runStuckProductionCleanup(h.client, { apply: true, database: 'erp_cleanup_test', actorUsername: 'owner' });
    expect(h.tx.order.updateMany).toHaveBeenCalledTimes(2);
    expect(h.tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-confirmed', status: OrderStatus.CONFIRMED, scheduledAt },
      data: { scheduledAt: null },
    });
    expect(h.tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-held', status: OrderStatus.ON_HOLD, scheduledAt },
      data: { scheduledAt: null },
    });
    expect(h.tx.order.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'order-evidence' }) }));
    expect(h.tx.orderLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      orderId: 'order-confirmed', action: PREMATURE_SCHEDULE_LOG_ACTION,
      changedFields: expect.objectContaining({ scheduledAt: { before: scheduledAt.toISOString(), after: null } }),
    }) });
    expect(h.tx.businessAuditLog.create).toHaveBeenCalledTimes(3);
    expect(h.executed).toContain('SELECT pg_advisory_xact_lock(hashtext(?)) :: print-shop-erp:order-cascade:order-held');
    expect(report.prematureSchedules).toMatchObject({ orderCount: 2, skipped: [{ orderId: 'order-evidence' }] });
  });

  it('并发改变 scheduledAt 时整体失败（事务回滚），不留半截清理', async () => {
    h.state.clearedCount = 0;
    await expect(runStuckProductionCleanup(h.client, { apply: true, database: 'erp_cleanup_test', actorUsername: 'owner' }))
      .rejects.toThrow('并发变化');
  });

  it('重复执行：已清理的数据不再命中，不写任何日志', async () => {
    const clean = harness({ stale: [], schedules: [scheduleRow({ scheduledAt: null })] });
    const report = await runStuckProductionCleanup(clean.client, { apply: true, database: 'erp_cleanup_test', actorUsername: 'owner' });
    expect(report.staleGenerations.orderCount).toBe(0);
    expect(report.prematureSchedules.orderCount).toBe(0);
    for (const write of writes(clean.tx)) expect(write).not.toHaveBeenCalled();
  });

  it('锁内重新判定：候选在拿锁前已被处理则跳过', async () => {
    h.tx.$queryRaw
      .mockImplementationOnce(async () => [{ name: 'erp_cleanup_test' }])
      .mockImplementationOnce(async () => h.state.stale)
      .mockImplementationOnce(async () => []);
    h.state.schedules = [];
    const report = await runStuckProductionCleanup(h.client, { apply: true, database: 'erp_cleanup_test', actorUsername: 'owner' });
    expect(report.staleGenerations.orderCount).toBe(0);
    for (const write of writes(h.tx)) expect(write).not.toHaveBeenCalled();
  });
});

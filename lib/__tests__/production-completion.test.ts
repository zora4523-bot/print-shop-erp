import { describe, it, expect, vi } from 'vitest';
import {
  OrderStatus,
  OutsourceStatus,
  ProductionOperationStatus,
  TaskStatus,
} from '../../generated/prisma/enums';
import {
  maybeCompleteProductionOrder,
  type ProductionCompletionTx,
} from '../production-completion';

// 闸口是依赖注入的（tx 是入参），所以这里直接构造 fake tx，
// 不需要 vi.mock('@/lib/db')。fake tx 刻意实现 where 过滤——
// 「CANCELLED 外协单不算覆盖」这条语义在真实代码里由 SQL 表达，
// 只有 fake 也照做，用例才真的在测它。

type FakeOrderRow = {
  id: string;
  status: OrderStatus;
  requiresOutsource?: boolean;
  orderNo?: string;
  customerRef?: string | null;
};

type FakeOutsourceRow = {
  id: string;
  status: OutsourceStatus;
  orderItemIds: string[];
  itemSnapshots?: Array<{ orderItemId: string; quantity: number }>;
};

type FakeItemRow = {
  id: string;
  sequence: number;
  name: string;
  crafts: string[];
  quantity?: number;
};

function makeTx(opts: {
  order?: FakeOrderRow | null;
  tasks?: Array<{ id: string; status: TaskStatus }>;
  operations?: Array<{ id: string; status: ProductionOperationStatus }>;
  progressSteps?: Array<{ id: string; status: ProductionOperationStatus }>;
  outsourceOrders?: FakeOutsourceRow[];
  items?: FakeItemRow[];
  crafts?: Array<{ id: string; isOutsource: boolean }>;
}) {
  const orderFindUnique = vi.fn(async () => {
    if (opts.order === null) return null;
    return {
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
      orderNo: 'O-1',
      customerRef: null,
      ...(opts.order ?? {}),
    };
  });
  const orderUpdate = vi.fn(async () => ({ id: 'order-1' }));
  const taskFindMany = vi.fn(async () => opts.tasks ?? []);
  const operationFindMany = vi.fn(async () => opts.operations ?? []);
  const progressStepFindMany = vi.fn(async () => opts.progressSteps ?? []);
  const outsourceFindMany = vi.fn(
    async (args: { where: unknown; select?: unknown }) => {
      const where = args.where as {
        orderId: string;
        status?: { not?: OutsourceStatus };
      };
      const excluded = where.status?.not;
      return (opts.outsourceOrders ?? [])
        .filter((row) => excluded === undefined || row.status !== excluded)
        .map((row) => ({
          ...row,
          itemSnapshots:
            row.itemSnapshots ??
            row.orderItemIds.map((orderItemId) => ({
              orderItemId,
              quantity: 100,
            })),
        }));
    },
  );
  const itemFindMany = vi.fn(async () =>
    (opts.items ?? []).map((row) => ({ quantity: 100, ...row })),
  );
  const craftFindMany = vi.fn(
    async (args: { where: unknown; select?: unknown }) => {
      const where = args.where as { id: { in: string[] } };
      const wanted = new Set(where.id.in);
      return (opts.crafts ?? []).filter((row) => wanted.has(row.id));
    },
  );
  const logCreate = vi.fn(async () => ({ id: 'log-1' }));

  const tx = {
    order: { findUnique: orderFindUnique, update: orderUpdate },
    orderItem: { findMany: itemFindMany },
    craft: { findMany: craftFindMany },
    productionTask: { findMany: taskFindMany },
    productionOperation: { findMany: operationFindMany },
    productionProgressStep: { findMany: progressStepFindMany },
    outsourceOrder: { findMany: outsourceFindMany },
    orderLog: { create: logCreate },
  } as unknown as ProductionCompletionTx;

  return {
    tx,
    orderFindUnique,
    orderUpdate,
    taskFindMany,
    operationFindMany,
    progressStepFindMany,
    outsourceFindMany,
    itemFindMany,
    craftFindMany,
    logCreate,
  };
}

const NOW = new Date('2026-08-21T02:00:00.000Z');

describe('maybeCompleteProductionOrder — 早退顺序', () => {
  it('工单查不到 → 不适用，且不查任务', async () => {
    const h = makeTx({ order: null });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out).toEqual({ completed: false, blockedBy: null, uncoveredItems: [] });
    expect(h.taskFindMany).not.toHaveBeenCalled();
  });

  it('工单已 COMPLETED → 不适用', async () => {
    const h = makeTx({
      order: { id: 'order-1', status: OrderStatus.COMPLETED },
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.completed).toBe(false);
    expect(out.blockedBy).toBeNull();
    expect(h.taskFindMany).not.toHaveBeenCalled();
  });

  it('工单不在生产态（SUBMITTED）→ 不适用', async () => {
    const h = makeTx({
      order: { id: 'order-1', status: OrderStatus.SUBMITTED },
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.blockedBy).toBeNull();
    expect(h.taskFindMany).not.toHaveBeenCalled();
  });

  it('内部任务未全部完工且非外协单 → INTERNAL_TASKS', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PRODUCTION,
        requiresOutsource: false,
      },
      tasks: [
        { id: 'task-1', status: TaskStatus.COMPLETED },
        { id: 'task-2', status: TaskStatus.IN_PROGRESS },
      ],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.blockedBy).toBe('INTERNAL_TASKS');
    expect(h.outsourceFindMany).not.toHaveBeenCalled();
    expect(h.itemFindMany).not.toHaveBeenCalled();
    expect(h.craftFindMany).not.toHaveBeenCalled();
    expect(h.orderUpdate).not.toHaveBeenCalled();
  });

  it('新代工序存在时只读新 ledger，旧任务为空也不得提前完工', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PRODUCTION,
        requiresOutsource: false,
      },
      tasks: [],
      operations: [
        { id: 'operation-1', status: ProductionOperationStatus.COMPLETED },
        { id: 'operation-2', status: ProductionOperationStatus.IN_PROGRESS },
      ],
    });

    const out = await maybeCompleteProductionOrder(
      h.tx,
      'order-1',
      'user-1',
      NOW,
    );

    expect(out.blockedBy).toBe('INTERNAL_TASKS');
    expect(h.taskFindMany).not.toHaveBeenCalled();
    expect(h.progressStepFindMany).toHaveBeenCalledOnce();
    expect(h.orderUpdate).not.toHaveBeenCalled();
  });

  it('计件工序全完成但无计件进度未完成时仍阻止完工', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PRODUCTION,
        requiresOutsource: false,
      },
      operations: [
        { id: 'operation-1', status: ProductionOperationStatus.COMPLETED },
      ],
      progressSteps: [
        { id: 'progress-1', status: ProductionOperationStatus.PENDING },
      ],
    });

    const out = await maybeCompleteProductionOrder(
      h.tx,
      'order-1',
      'user-1',
      NOW,
    );

    expect(out.blockedBy).toBe('INTERNAL_TASKS');
    expect(h.orderUpdate).not.toHaveBeenCalled();
  });

  it('新代计件与无计件步骤全完成后放行，不受旧任务影响', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PRODUCTION,
        requiresOutsource: false,
      },
      tasks: [{ id: 'legacy-pending', status: TaskStatus.PENDING }],
      operations: [
        { id: 'operation-1', status: ProductionOperationStatus.COMPLETED },
      ],
      progressSteps: [
        { id: 'progress-1', status: ProductionOperationStatus.COMPLETED },
      ],
    });

    const out = await maybeCompleteProductionOrder(
      h.tx,
      'order-1',
      'user-1',
      NOW,
    );

    expect(out.completed).toBe(true);
    expect(h.taskFindMany).not.toHaveBeenCalled();
  });

  it('requiresOutsource=false 且内部任务全完 → 完工，且外协/款式/工艺三条查询全不跑', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PRODUCTION,
        requiresOutsource: false,
      },
      tasks: [{ id: 'task-1', status: TaskStatus.COMPLETED }],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out).toEqual({ completed: true, blockedBy: null, uncoveredItems: [] });
    expect(h.outsourceFindMany).not.toHaveBeenCalled();
    expect(h.itemFindMany).not.toHaveBeenCalled();
    expect(h.craftFindMany).not.toHaveBeenCalled();
  });

  it('requiresOutsource 缺失（undefined）走与 false 相同的路径 —— 与横幅共用谓词', async () => {
    const h = makeTx({
      order: { id: 'order-1', status: OrderStatus.IN_PRODUCTION },
      tasks: [{ id: 'task-1', status: TaskStatus.COMPLETED }],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.completed).toBe(true);
    expect(h.outsourceFindMany).not.toHaveBeenCalled();
  });

  it('requiresOutsource=true 但一张未取消外协单都没有 → OUTSOURCE_MISSING，不查款式/工艺', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PRODUCTION,
        requiresOutsource: true,
      },
      tasks: [{ id: 'task-1', status: TaskStatus.COMPLETED }],
      outsourceOrders: [],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.blockedBy).toBe('OUTSOURCE_MISSING');
    expect(h.itemFindMany).not.toHaveBeenCalled();
    expect(h.craftFindMany).not.toHaveBeenCalled();
  });

  it('还有外协单没收货 → OUTSOURCE_NOT_RECEIVED，不查款式/工艺', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.IN_PRODUCTION,
        requiresOutsource: true,
      },
      tasks: [{ id: 'task-1', status: TaskStatus.COMPLETED }],
      outsourceOrders: [
        { id: 'os-1', status: OutsourceStatus.SENT, orderItemIds: ['item-1'] },
      ],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.blockedBy).toBe('OUTSOURCE_NOT_RECEIVED');
    expect(h.itemFindMany).not.toHaveBeenCalled();
    expect(h.craftFindMany).not.toHaveBeenCalled();
  });
});

describe('maybeCompleteProductionOrder — 款式级覆盖闸口', () => {
  const baseOpts = {
    order: {
      id: 'order-1',
      status: OrderStatus.IN_PRODUCTION,
      requiresOutsource: true,
    },
    tasks: [{ id: 'task-1', status: TaskStatus.COMPLETED }],
    crafts: [
      { id: 'craft-uv', isOutsource: true },
      { id: 'craft-foil', isOutsource: false },
    ],
  };

  it('每个含外协工艺的款式都被覆盖 → 完工，order.update 收到 COMPLETED + completedAt', async () => {
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
        { id: 'item-2', sequence: 2, name: '款式二', crafts: ['craft-foil'] },
      ],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out).toEqual({ completed: true, blockedBy: null, uncoveredItems: [] });
    expect(h.orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-1' },
        data: { status: OrderStatus.COMPLETED, completedAt: NOW },
      }),
    );
  });

  it('款式 A 被覆盖、款式 B 含外协工艺但无外协单 → OUTSOURCE_COVERAGE，不写库', async () => {
    // 本次改动的核心用例：旧闸口（有外协单且全部 RECEIVED）会放行这张单。
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
        { id: 'item-2', sequence: 2, name: '款式二', crafts: ['craft-uv'] },
      ],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.completed).toBe(false);
    expect(out.blockedBy).toBe('OUTSOURCE_COVERAGE');
    expect(out.uncoveredItems).toEqual([
      { id: 'item-2', sequence: 2, name: '款式二' },
    ]);
    expect(h.orderUpdate).not.toHaveBeenCalled();
    expect(h.logCreate).not.toHaveBeenCalled();
  });

  it('一张外协单同时覆盖款式 A 与 B → 完工', async () => {
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1', 'item-2'],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
        { id: 'item-2', sequence: 2, name: '款式二', crafts: ['craft-uv'] },
      ],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.completed).toBe(true);
  });

  it('CANCELLED 外协单即使写着款式 B 也不算覆盖', async () => {
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
        },
        {
          id: 'os-cancelled',
          status: OutsourceStatus.CANCELLED,
          orderItemIds: ['item-2'],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
        { id: 'item-2', sequence: 2, name: '款式二', crafts: ['craft-uv'] },
      ],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.blockedBy).toBe('OUTSOURCE_COVERAGE');
    expect(out.uncoveredItems.map((row) => row.id)).toEqual(['item-2']);
  });

  it('外协单查询锁死「本工单 + 未取消」，select 带 orderItemIds', async () => {
    // OutsourceOrder.orderId 可空：别的工单的、以及没挂工单的外协单
    // 不能算覆盖。这条语义完全由 where 表达，所以直接断言入参。
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
      ],
    });
    await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(h.outsourceFindMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: { not: OutsourceStatus.CANCELLED } },
      select: {
        id: true,
        status: true,
        orderItemIds: true,
        itemSnapshots: {
          select: { orderItemId: true, quantity: true },
        },
      },
    });
  });

  it('已回货快照只冻结 100，工单后续增到 200 时仍判定数量未覆盖', async () => {
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
          itemSnapshots: [{ orderItemId: 'item-1', quantity: 100 }],
        },
      ],
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '款式一',
          quantity: 200,
          crafts: ['craft-uv'],
        },
      ],
    });

    const out = await maybeCompleteProductionOrder(
      h.tx,
      'order-1',
      'user-1',
      NOW,
    );

    expect(out.blockedBy).toBe('OUTSOURCE_COVERAGE');
    expect(out.uncoveredItems.map((row) => row.id)).toEqual(['item-1']);
    expect(h.orderUpdate).not.toHaveBeenCalled();
  });

  it('内部任务尚未完工时也优先回传已收货外协的覆盖缺口', async () => {
    const h = makeTx({
      ...baseOpts,
      tasks: [{ id: 'task-1', status: TaskStatus.IN_PROGRESS }],
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
        { id: 'item-2', sequence: 2, name: '款式二', crafts: ['craft-uv'] },
      ],
    });

    const out = await maybeCompleteProductionOrder(
      h.tx,
      'order-1',
      'user-1',
      NOW,
    );

    expect(out.blockedBy).toBe('OUTSOURCE_COVERAGE');
    expect(out.uncoveredItems.map((row) => row.id)).toEqual(['item-2']);
    expect(h.orderUpdate).not.toHaveBeenCalled();
  });

  it('工艺字典按 id 取、且不加 isActive —— 已停用的外协工艺仍要参与判定', async () => {
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
        },
      ],
      items: [
        {
          id: 'item-1',
          sequence: 1,
          name: '款式一',
          crafts: ['craft-uv', 'craft-foil'],
        },
        { id: 'item-2', sequence: 2, name: '款式二', crafts: ['craft-foil'] },
      ],
    });
    await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(h.craftFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['craft-uv', 'craft-foil'] } },
      select: { id: true, isOutsource: true },
    });
  });

  it('所有任务都是 CANCELLED 且外协覆盖完整 → 完工，日志写「外协全部收货，工单完工」', async () => {
    const h = makeTx({
      order: {
        id: 'order-1',
        status: OrderStatus.SCHEDULING,
        requiresOutsource: true,
      },
      tasks: [{ id: 'task-1', status: TaskStatus.CANCELLED }],
      crafts: [{ id: 'craft-uv', isOutsource: true }],
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: ['item-1'],
        },
      ],
      items: [
        { id: 'item-1', sequence: 1, name: '款式一', crafts: ['craft-uv'] },
      ],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.completed).toBe(true);
    expect(h.logCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        operatorId: 'user-1',
        action: 'STATUS_CHANGE',
        remark: '外协全部收货，工单完工',
      }),
    });
  });

  it('款式一个工艺都没有 → 不发 craft 查询，覆盖判定天然通过', async () => {
    const h = makeTx({
      ...baseOpts,
      outsourceOrders: [
        {
          id: 'os-1',
          status: OutsourceStatus.RECEIVED,
          orderItemIds: [],
        },
      ],
      items: [{ id: 'item-1', sequence: 1, name: '款式一', crafts: [] }],
    });
    const out = await maybeCompleteProductionOrder(h.tx, 'order-1', 'user-1', NOW);
    expect(out.completed).toBe(true);
    expect(h.craftFindMany).not.toHaveBeenCalled();
  });
});

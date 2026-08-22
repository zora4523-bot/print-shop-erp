import {
  OrderStatus,
  OutsourceStatus,
  TaskStatus,
} from '../generated/prisma/enums';
import { transitionOrder } from './order/status-machine';
import {
  collectOutsourceCraftIds,
  findUncoveredOutsourceItems,
  outsourceCoverageApplies,
} from './outsource/coverage';

// Shared completion gate for internal production and outsource receiving.
// Callers must already hold orderCascadeLockKey(orderId) in the same
// transaction. Keeping the decision here prevents the two flows from
// independently declaring the order complete.
//
// 这是一个**结构化类型**，不是 Prisma 的 TransactionClient：五个调用点
// 全部用 `as unknown as` 双重断言传入真实 tx，所以这里只声明本函数实际
// 用到的窄接口。新增 orderItem / craft 不会让任何调用点编译失败（双重
// 断言绕过了结构检查），真实 tx 运行时也确有这两个 delegate；**会炸的
// 是单测里的 dbMock**——那正是我们要的：mock 缺哪个 model，测试当场报错，
// 而不是静默放行。不要为了「让测试过」给 dbMock 加万能 Proxy。
export type ProductionCompletionTx = {
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      status: OrderStatus;
      requiresOutsource?: boolean;
    } | null>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<unknown>;
  };
  orderItem: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      Array<{
        id: string;
        sequence: number;
        name: string;
        crafts: string[];
      }>
    >;
  };
  craft: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; isOutsource: boolean }>>;
  };
  productionTask: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: TaskStatus }>>;
  };
  outsourceOrder: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      Array<{ id: string; status: OutsourceStatus; orderItemIds: string[] }>
    >;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

export type ProductionCompletionBlocker =
  | 'INTERNAL_TASKS'
  | 'OUTSOURCE_MISSING'
  | 'OUTSOURCE_NOT_RECEIVED'
  | 'OUTSOURCE_COVERAGE';

export type ProductionCompletionOutcome = {
  completed: boolean;
  // null 表示「不适用」（工单不存在 / 已完工 / 不在生产态），不等于
  // 「可以完工」。completed === true 时同样为 null。
  blockedBy: ProductionCompletionBlocker | null;
  // 仅 blockedBy === 'OUTSOURCE_COVERAGE' 时非空。给 UI 用，让主管知道
  // 缺的是哪几个款式，而不是面对一个静默不动的工单。
  uncoveredItems: Array<{ id: string; sequence: number; name: string }>;
};

function notApplicable(): ProductionCompletionOutcome {
  return { completed: false, blockedBy: null, uncoveredItems: [] };
}

function blocked(
  reason: ProductionCompletionBlocker,
  uncoveredItems: ProductionCompletionOutcome['uncoveredItems'] = [],
): ProductionCompletionOutcome {
  return { completed: false, blockedBy: reason, uncoveredItems };
}

export async function maybeCompleteProductionOrder(
  tx: ProductionCompletionTx,
  orderId: string,
  actorId: string,
  now: Date,
): Promise<ProductionCompletionOutcome> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, requiresOutsource: true },
  });
  if (!order) return notApplicable();
  if (order.status === OrderStatus.COMPLETED) return notApplicable();
  if (
    order.status !== OrderStatus.SCHEDULING &&
    order.status !== OrderStatus.IN_PRODUCTION
  ) {
    return notApplicable();
  }

  const tasks = await tx.productionTask.findMany({
    where: { orderItem: { orderId } },
    select: { id: true, status: true },
  });
  const activeTasks = tasks.filter((task) => task.status !== TaskStatus.CANCELLED);
  const internalReady = activeTasks.every(
    (task) => task.status === TaskStatus.COMPLETED,
  );
  if (!internalReady) return blocked('INTERNAL_TASKS');

  // 与 getOrderDetail 的「暂不能完工」横幅共用同一个前置谓词。不共用会
  // 出现「页面说不能完工、闸口其实照样完工」的反向漂移。
  const coverageApplies = outsourceCoverageApplies(order);
  if (coverageApplies) {
    // where 里的 orderId 同时解决了 OutsourceOrder.orderId 可空的问题：
    // 别的工单的、以及没挂工单的外协单都不会进这个集合，所以下面的覆盖集
    // 只由「本工单的未取消外协单」构成。覆盖判定必须复用这一份结果，不要
    // 另开一次查询。
    const outsourceOrders = await tx.outsourceOrder.findMany({
      where: { orderId, status: { not: OutsourceStatus.CANCELLED } },
      select: { id: true, status: true, orderItemIds: true },
    });
    if (outsourceOrders.length === 0) return blocked('OUTSOURCE_MISSING');
    if (
      !outsourceOrders.every((row) => row.status === OutsourceStatus.RECEIVED)
    ) {
      return blocked('OUTSOURCE_NOT_RECEIVED');
    }

    // 款式级覆盖校验（业主 2026-08-21 拍板）。放在「全部收货」之后是性能
    // 考量：这段只有在「内部任务全部完工 + 外协单全部收货」这一刻才可达，
    // 一张工单全程命中个位数次，不是每次报工都跑；非外协工单连上面那条
    // outsourceOrder 查询都不会跑。
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { id: true, sequence: true, name: true, crafts: true },
    });
    const craftIds = [...new Set(items.flatMap((item) => item.crafts))];
    // 按 id 取字典再在 JS 里筛 isOutsource（而不是 where isOutsource:
    // true 扫全表），与 lib/production.ts scheduleOrder 的取法一致：in
    // 列表被本工单的工艺数收敛住。**不加 isActive 过滤**——历史工单引用的
    // 已停用工艺仍然要参与判定，同 getOrderDetail 解析工艺名的理由。
    const crafts =
      craftIds.length === 0
        ? []
        : await tx.craft.findMany({
            where: { id: { in: craftIds } },
            select: { id: true, isOutsource: true },
          });
    const uncovered = findUncoveredOutsourceItems(
      items,
      collectOutsourceCraftIds(crafts),
      outsourceOrders,
    );
    if (uncovered.length > 0) {
      return blocked(
        'OUTSOURCE_COVERAGE',
        uncovered.map((item) => ({
          id: item.id,
          sequence: item.sequence,
          name: item.name,
        })),
      );
    }
  }

  transitionOrder(order.status, OrderStatus.COMPLETED);
  await tx.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.COMPLETED, completedAt: now },
    select: { id: true, status: true },
  });
  await tx.orderLog.create({
    data: {
      orderId,
      operatorId: actorId,
      action: 'STATUS_CHANGE',
      changedFields: {
        status: { before: order.status, after: OrderStatus.COMPLETED },
      },
      remark:
        activeTasks.length === 0
          ? '外协全部收货，工单完工'
          : coverageApplies
            ? '内部任务与外协全部完成'
            : '全部任务完工',
    },
  });
  return { completed: true, blockedBy: null, uncoveredItems: [] };
}

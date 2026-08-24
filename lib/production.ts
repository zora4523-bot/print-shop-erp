import {
  OrderStatus,
  OrderKind,
  Role,
  TaskStatus,
  MachineType,
  OutsourceStatus,
  WorkerType,
  DesignFileType,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { db } from './db';
import { transitionOrder } from './order/status-machine';
import {
  transitionProductionTask,
  InvalidTaskTransitionError,
} from './production/status-machine';
import { OrderInvariantError } from './order';
import type {
  ReportTaskInput,
  ScheduleOrderInput,
} from './auth/schemas';
import { orderCascadeLockKey } from './order/locks';
import { getWorkerTaskScopeFilter } from './auth/task-scope';
import { calcMachinePieceworkBreakdown } from './salary/machine-piecework';
import {
  getActiveMachineRule,
  machineRuleLockKey,
} from './salary/rules';
import { dispatchNotification } from './notification/dispatch';
import {
  maybeCompleteProductionOrder,
  type ProductionCompletionTx,
} from './production-completion';
import { getSetting } from './settings';
import { todayShanghai } from './dashboard/shanghai-clock';
import { backgroundJobsMode } from './background-jobs/mode';
import { enqueueNotificationInTransaction } from './notification/transactional-outbox';
import type { EnqueueClient } from './background-jobs/repository';

// Thrown when a scheduling request violates the allowlist contract
// (duplicate / missing / unknown craft-item pairs, bad worker, etc.).
// Action layer maps to { status: 'error', message }.
export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulingError';
  }
}

// Minimal tx surface we need — kept narrow so a typed Prisma client
// upgrade doesn't explode the function signature (same pattern as
// lib/order.ts's OrderTxClient).
type ScheduleTxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  order: {
    findFirst: (args: {
      where: unknown;
      select?: unknown;
      include?: unknown;
    }) => Promise<{
      id: string;
      orderNo: string;
      status: OrderStatus;
      submitterId: string;
      items: Array<{
        id: string;
        sequence: number;
        quantity: number;
        crafts: string[];
      }>;
    } | null>;
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
    }) => Promise<{ id: string; status: OrderStatus }>;
  };
  craft: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      Array<{
        id: string;
        isActive: boolean;
        isOutsource: boolean;
        defaultWorkerType: WorkerType | null;
        defaultMachineType: MachineType | null;
        inHouseMachineTypes: MachineType[];
      }>
    >;
  };
  user: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      Array<{
        id: string;
        role: Role;
        isActive: boolean;
        workerType: WorkerType | null;
        machineType: MachineType | null;
        machineCapabilities?: MachineType[];
        craftCapabilities?: Array<{ craftId: string }>;
      }>
    >;
  };
  productionTask: {
    createMany: (args: {
      data: unknown[];
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string }>;
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      Array<{
        id: string;
        orderItemId: string;
        craftId: string;
        workerId: string | null;
        status: TaskStatus;
      }>
    >;
  };
  outsourceOrder: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: OutsourceStatus }>>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

export type ScheduleOrderResult = {
  orderId: string;
  status: OrderStatus;
  tasksCreated: number;
  skippedOutsourceCrafts: number;
  orderCompleted: boolean;
};

// Core flow (SPEC §3.2):
//   1. Verify the order is in SUBMITTED (only state that can be scheduled).
//   2. Derive the expected set of (orderItem × non-outsource craft) pairs
//      from the order's items + crafts.
//   3. Match the input assignments against that set exactly — no
//      missing, no duplicates, no unknowns, no outsource crafts.
//   4. Verify every assigned worker is an active Role.WORKER.
//   5. Snapshot `machineType` from the craft's defaultMachineType at
//      schedule time. This is the quantity the salary calc uses.
//   6. createMany ProductionTask rows + transition Order → SCHEDULING
//      + write OrderLog, all in one tx.
//
export async function scheduleOrder(
  input: ScheduleOrderInput,
  actor: { id: string; role: Role },
): Promise<ScheduleOrderResult> {
  let scheduledNotificationQueued = false;
  const result = await db.$transaction(async (tx) => {
    const txClient = tx as unknown as ScheduleTxClient;

    // Serialize concurrent scheduling attempts on the same order.
    // Without this, two foremen clicking 排产 at the same moment can
    // both observe SUBMITTED, both pass the status-machine check, and
    // both createMany — producing duplicate ProductionTask rows and
    // two STATUS_CHANGE log entries. Lock is per-tx so the second
    // transaction blocks here and then sees SCHEDULING on its own
    // read, tripping transitionOrder's guard .
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      input.orderId,
    )}))`;

    const order = await txClient.order.findFirst({
      where: { id: input.orderId },
      select: {
        id: true,
        orderNo: true,
        status: true,
        submitterId: true,
        items: {
          select: {
            id: true,
            sequence: true,
            quantity: true,
            crafts: true,
          },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!order) throw new OrderInvariantError('工单不存在');

    // Status-machine check up front. We throw the same error type as
    // the order action layer maps to a readable message.
    transitionOrder(order.status, OrderStatus.SCHEDULING);

    // Collect every craft mentioned by any item — we need isOutsource
    // + defaultMachineType for both the expected-set derivation and
    // the machine-type snapshot.
    const allCraftIds = new Set<string>();
    for (const item of order.items) {
      for (const cid of item.crafts) allCraftIds.add(cid);
    }
    const crafts = await txClient.craft.findMany({
      where: { id: { in: [...allCraftIds] } },
      select: {
        id: true,
        isActive: true,
        isOutsource: true,
        defaultWorkerType: true,
        defaultMachineType: true,
        inHouseMachineTypes: true,
      },
    });
    const craftById = new Map(crafts.map((c) => [c.id, c]));

    // Any craft the order references but we can't find in the dict is
    // a data-integrity problem — refuse to schedule rather than
    // silently drop the task. (Can happen if a craft was hard-deleted
    // between order submit and scheduling.)
    for (const cid of allCraftIds) {
      const c = craftById.get(cid);
      if (!c) throw new SchedulingError(`工艺不存在：${cid}`);
      // createOrder already verifies every craft is active, but the
      // dictionary can be stopped between submit and schedule. Block
      // rather than silently schedule on a retired craft — the
      // foreman has to either change the craft on the order (edit
      // flow) or the owner has to re-enable the craft.
      if (!c.isActive) throw new SchedulingError(`工艺已停用：${cid}`);
      if (!c.isOutsource || (c.inHouseMachineTypes?.length ?? 0) > 0) {
        assertCraftAssignmentConfigured(c);
      }
    }

    // Expected set: for each item, for each non-outsource craft on
    // that item, we need exactly one assignment. Store as
    // "<itemId>:<craftId>" for fast membership checks.
    const expectedKeys = new Set<string>();
    const itemQuantityById = new Map<string, number>();
    let skippedOutsourceCrafts = 0;
    for (const item of order.items) {
      itemQuantityById.set(item.id, item.quantity);
      for (const cid of item.crafts) {
        const c = craftById.get(cid)!;
        if (c.isOutsource) {
          skippedOutsourceCrafts += 1;
        }
        if (!c.isOutsource || (c.inHouseMachineTypes?.length ?? 0) > 0) {
          expectedKeys.add(`${item.id}:${cid}`);
        }
      }
    }

    if (skippedOutsourceCrafts > 0) {
      const linkedOutsource = await txClient.outsourceOrder.findMany({
        where: {
          orderId: order.id,
          status: { not: OutsourceStatus.CANCELLED },
        },
        select: { id: true, status: true },
      });
      if (linkedOutsource.length === 0) {
        throw new SchedulingError(
          '工单包含外协工艺，请先在工单详情创建外协单再确认排产',
        );
      }
    }

    const existingTasks = await txClient.productionTask.findMany({
      where: { orderItemId: { in: order.items.map((item) => item.id) } },
      select: {
        id: true,
        orderItemId: true,
        craftId: true,
        workerId: true,
        status: true,
      },
    });
    const existingTaskByKey = new Map(
      existingTasks.map((task) => [
        `${task.orderItemId}:${task.craftId}`,
        task,
      ]),
    );
    for (const task of existingTasks) {
      const key = `${task.orderItemId}:${task.craftId}`;
      if (!expectedKeys.has(key) || task.status !== TaskStatus.PENDING) {
        throw new SchedulingError(
          '工单包含异常或已经开始的生产任务，请刷新后单独检查',
        );
      }
    }

    // Walk the input assignments:
    //   - Each must be a non-outsource pair the order actually needs.
    //   - No duplicates (same orderItemId+craftId twice).
    //   - Every craft allowed is seen.
    const seenKeys = new Set<string>();
    const workerIds = new Set<string>();
    for (const a of input.assignments) {
      const key = `${a.orderItemId}:${a.craftId}`;
      if (!expectedKeys.has(key)) {
        // Either a pair the order doesn't need OR an outsource craft
        // the caller shouldn't have assigned.
        throw new SchedulingError(
          `款式 ${a.orderItemId} 没有需要内部排产的工艺 ${a.craftId}（纯外协工艺不派师傅）`,
        );
      }
      if (seenKeys.has(key)) {
        throw new SchedulingError(
          `同一工艺在同一款式上重复派工：${a.orderItemId} × ${a.craftId}`,
        );
      }
      seenKeys.add(key);
      workerIds.add(a.workerId);
    }
    // Every expected pair must have an assignment — partial scheduling
    // isn't in scope for Slice A (SPEC "确认所有任务派师傅完毕").
    for (const key of expectedKeys) {
      if (!seenKeys.has(key)) {
        throw new SchedulingError(`还有工艺未派师傅：${key}`);
      }
    }

    // Verify workers exist + are active + are WORKERs.
    const workers = await txClient.user.findMany({
      where: { id: { in: [...workerIds] } },
      select: {
        id: true,
        role: true,
        isActive: true,
        workerType: true,
        machineType: true,
        machineCapabilities: true,
        craftCapabilities: { select: { craftId: true } },
      },
    });
    const workerById = new Map(workers.map((w) => [w.id, w]));
    for (const wid of workerIds) {
      const w = workerById.get(wid);
      if (!w) throw new SchedulingError(`师傅不存在：${wid}`);
      if (w.role !== Role.WORKER) {
        throw new SchedulingError(`用户不是师傅：${wid}`);
      }
      if (!w.isActive) throw new SchedulingError(`师傅已停用：${wid}`);
    }
    for (const assignment of input.assignments) {
      assertWorkerAssignable(
        craftById.get(assignment.craftId)!,
        workerById.get(assignment.workerId)!,
        assignment.overrideReason ?? '',
      );
    }

    // createMany is a single round trip — we assemble the full list
    // here rather than looping create() so a 50-item order doesn't
    // fan out to 50 round trips.
    const assignmentByKey = new Map(
      input.assignments.map((assignment) => [
        `${assignment.orderItemId}:${assignment.craftId}`,
        assignment,
      ]),
    );
    const taskRows = input.assignments
      .filter(
        (assignment) =>
          !existingTaskByKey.has(
            `${assignment.orderItemId}:${assignment.craftId}`,
          ),
      )
      .map((a) => {
      const craft = craftById.get(a.craftId)!;
      return {
        orderItemId: a.orderItemId,
        craftId: a.craftId,
        workerId: a.workerId,
        workerType: craft.defaultWorkerType,
        // Snapshot the machine type at assign time. If we change
        // craft.defaultMachineType later, in-flight tasks keep their
        // original type — same principle as salaryRuleSnapshot.
        machineType: getWorkerAssignmentEligibility(
          craft,
          workerById.get(a.workerId)!,
        ).machineType,
        status: TaskStatus.PENDING,
        plannedQty: itemQuantityById.get(a.orderItemId)!,
      };
      });
    const inserted =
      taskRows.length > 0
        ? await txClient.productionTask.createMany({ data: taskRows })
        : { count: 0 };
    for (const [key, task] of existingTaskByKey) {
      const assignment = assignmentByKey.get(key)!;
      const craft = craftById.get(assignment.craftId)!;
      await txClient.productionTask.update({
        where: { id: task.id },
        data: {
          workerId: assignment.workerId,
          workerType: craft.defaultWorkerType,
          machineType: getWorkerAssignmentEligibility(
            craft,
            workerById.get(assignment.workerId)!,
          ).machineType,
          plannedQty: itemQuantityById.get(assignment.orderItemId)!,
        },
        select: { id: true },
      });
    }

    // Transition + log. Order goes to SCHEDULING now; the first worker
    // to start a task will be responsible for pushing it to
    // IN_PRODUCTION (handled in Slice B via beginTask).
    const updated = await txClient.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.SCHEDULING,
        scheduledAt: new Date(),
        requiresOutsource: skippedOutsourceCrafts > 0,
      },
      select: { id: true, status: true },
    });
    const assignmentOverrides = input.assignments.flatMap((assignment) => {
      const eligibility = getWorkerAssignmentEligibility(
        craftById.get(assignment.craftId)!,
        workerById.get(assignment.workerId)!,
      );
      return eligibility.recommended
        ? []
        : [
            {
              orderItemId: assignment.orderItemId,
              craftId: assignment.craftId,
              workerId: assignment.workerId,
              machineType: eligibility.machineType,
              reason: assignment.overrideReason?.trim() ?? '',
            },
          ];
    });
    await txClient.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'STATUS_CHANGE',
        changedFields: {
          status: { before: order.status, after: OrderStatus.SCHEDULING },
          ...(assignmentOverrides.length > 0
            ? { assignmentOverrides }
            : {}),
        },
        remark: `排产：确认 ${expectedKeys.size} 个任务${
          skippedOutsourceCrafts > 0 ? `（外协工艺 ${skippedOutsourceCrafts} 项另行处理）` : ''
        }${
          assignmentOverrides.length > 0
            ? `；非推荐派工 ${assignmentOverrides.length} 项（原因已记录）`
            : ''
        }`,
      },
    });

    const orderCompleted =
      inserted.count === 0 && skippedOutsourceCrafts > 0
        ? (
            await maybeCompleteProductionOrder(
              txClient as unknown as ProductionCompletionTx,
              order.id,
              actor.id,
              new Date(),
            )
          ).completed
        : false;

    scheduledNotificationQueued = await enqueueNotificationInTransaction(
      tx as unknown as EnqueueClient,
      'ORDER_SCHEDULED',
      {
        orderId: order.id,
        orderNo: order.orderNo,
        taskCount: expectedKeys.size,
      },
      { dedupeKey: `notification:ORDER_SCHEDULED:${order.id}` },
    );

    return {
      orderId: updated.id,
      status: orderCompleted ? OrderStatus.COMPLETED : updated.status,
      tasksCreated: expectedKeys.size,
      skippedOutsourceCrafts,
      orderCompleted,
    };
  });

  // Slice C wire ─ ORDER_SCHEDULED（tx 已 commit；生产入持久化队列）。
  if (!scheduledNotificationQueued) {
    const payload = await db.order.findUnique({
      where: { id: result.orderId },
      select: { orderNo: true, customerRef: true },
    });
    if (payload) await dispatchNotification(
      'ORDER_SCHEDULED',
      {
        orderId: result.orderId,
        orderNo: payload.orderNo,
        taskCount: result.tasksCreated,
      },
      { dedupeKey: `notification:ORDER_SCHEDULED:${result.orderId}` },
    );
    if (payload && result.orderCompleted) {
      await dispatchNotification(
        'ORDER_COMPLETED',
        {
          orderId: result.orderId,
          orderNo: payload.orderNo,
          customerRef: payload.customerRef,
        },
        { dedupeKey: `notification:ORDER_COMPLETED:${result.orderId}` },
      );
    }
  }

  return result;
}

type AssignmentCraft = {
  id: string;
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
  inHouseMachineTypes?: MachineType[];
};

type AssignmentWorker = {
  id: string;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  machineCapabilities?: MachineType[];
  craftCapabilities?: Array<{ craftId: string }>;
  craftCapabilityIds?: string[];
};

function workerCanOperateMachine(
  worker: Pick<AssignmentWorker, 'machineType' | 'machineCapabilities'>,
  machineType: MachineType | null,
): boolean {
  if (!machineType) return false;
  const capabilities =
    (worker.machineCapabilities?.length ?? 0) > 0
      ? worker.machineCapabilities!
      : worker.machineType
        ? [worker.machineType]
        : [];
  return capabilities.includes(machineType);
}

export type WorkerAssignmentEligibility = {
  eligible: boolean;
  recommended: boolean;
  machineType: MachineType | null;
  reason: string | null;
};

function assertCraftAssignmentConfigured(craft: AssignmentCraft): void {
  if (!craft.defaultWorkerType) {
    throw new SchedulingError(
      `工艺 ${craft.id} 未配置接单岗位，请先到工艺字典完善配置`,
    );
  }
  if (craft.defaultWorkerType === WorkerType.COOK) {
    throw new SchedulingError(`工艺 ${craft.id} 不能分配给厨师`);
  }
  if (
    craft.defaultWorkerType === WorkerType.MACHINE &&
    !craft.defaultMachineType &&
    (craft.inHouseMachineTypes?.length ?? 0) === 0
  ) {
    throw new SchedulingError(
      `工艺 ${craft.id} 是开机工艺但未配置机型`,
    );
  }
}

function assertWorkerAssignable(
  craft: AssignmentCraft,
  worker: AssignmentWorker,
  overrideReason = '',
): void {
  assertCraftAssignmentConfigured(craft);
  const eligibility = getWorkerAssignmentEligibility(craft, worker);
  if (!eligibility.eligible) {
    throw new SchedulingError(
      eligibility.reason ??
        `师傅 ${worker.id} 不能承接工艺 ${craft.id}`,
    );
  }
  if (!eligibility.recommended && overrideReason.trim().length === 0) {
    throw new SchedulingError(
      `师傅 ${worker.id} 未登记工艺 ${craft.id} 的熟练能力；如仍需分配，请填写非推荐派工原因`,
    );
  }
}

export function isWorkerCompatible(
  craft: AssignmentCraft,
  worker: AssignmentWorker,
): boolean {
  return getWorkerAssignmentEligibility(craft, worker).eligible;
}

export function getWorkerAssignmentEligibility(
  craft: AssignmentCraft,
  worker: AssignmentWorker,
): WorkerAssignmentEligibility {
  if (
    !craft.defaultWorkerType ||
    craft.defaultWorkerType === WorkerType.COOK
  ) {
    return {
      eligible: false,
      recommended: false,
      machineType: null,
      reason: `工艺 ${craft.id} 未配置可接单岗位`,
    };
  }
  if (worker.workerType !== craft.defaultWorkerType) {
    return {
      eligible: false,
      recommended: false,
      machineType: null,
      reason: `师傅 ${worker.id} 的岗位与工艺 ${craft.id} 不匹配`,
    };
  }
  let resolvedMachineType: MachineType | null = null;
  if (craft.defaultWorkerType === WorkerType.MACHINE) {
    const allowedMachines =
      (craft.inHouseMachineTypes?.length ?? 0) > 0
        ? craft.inHouseMachineTypes!
        : craft.defaultMachineType
          ? [craft.defaultMachineType]
          : [];
    const workerMachines =
      (worker.machineCapabilities?.length ?? 0) > 0
        ? worker.machineCapabilities!
        : worker.machineType
          ? [worker.machineType]
          : [];
    resolvedMachineType =
      worker.machineType && allowedMachines.includes(worker.machineType)
        ? worker.machineType
        : (allowedMachines.find((machine) =>
            workerMachines.includes(machine),
          ) ?? null);
    if (!resolvedMachineType) {
      return {
        eligible: false,
        recommended: false,
        machineType: null,
        reason: `师傅 ${worker.id} 的机器能力与工艺 ${craft.id} 不匹配`,
      };
    }
  }
  const capabilityIds =
    worker.craftCapabilityIds ??
    worker.craftCapabilities?.map((capability) => capability.craftId);
  return {
    eligible: true,
    // Optional means a legacy/test shape that predates capability records.
    // Real scheduling queries always provide the relation, including [].
    recommended: capabilityIds
      ? capabilityIds.includes(craft.id)
      : true,
    machineType: resolvedMachineType,
    reason: null,
  };
}

export { SchedulingError as ProductionSchedulingError };

// ─────────────────────────────────────────────────────────────────────
// Worker flow: begin + report (SPEC §3.3)
// ─────────────────────────────────────────────────────────────────────

// Thrown when a worker tries to touch a task they can't (wrong
// assignee, wrong status, missing rule, etc.). Mapped to
// { status: 'error' } by the action layer.
export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportError';
  }
}

// 单条报工的数量守卫（业主 2026-08-21 拍板）。继承 ReportError 是刻意的：
// actions 层的 mapTaskError 已经有 `instanceof ReportError` 分支，硬拒那条
// 不用改就会变成 { status: 'error' }；action 只需要在它**之前**多拦一次
// confirmable 那条，把它变成挂在复选框上的字段错误。
export class OverReportError extends ReportError {
  /** true = 勾选「确认超出计划数」后重提即可通过；false = 已达倍数上限，勾了也不给过。 */
  readonly confirmable: boolean;
  readonly plannedQty: number;
  readonly totalReported: number;
  readonly limitQty: number;

  constructor(args: {
    message: string;
    confirmable: boolean;
    plannedQty: number;
    totalReported: number;
    limitQty: number;
  }) {
    super(args.message);
    this.name = 'OverReportError';
    this.confirmable = args.confirmable;
    this.plannedQty = args.plannedQty;
    this.totalReported = args.totalReported;
    this.limitQty = args.limitQty;
  }
}

const DECIMAL_10_2_MAX = '99999999.99';

function assertValidPlannedQuantity(
  plannedQty: number,
  taskLabel = '该任务',
): void {
  if (!Number.isSafeInteger(plannedQty) || plannedQty <= 0) {
    throw new ReportError(
      `${taskLabel}的计划数量异常（${plannedQty}），不能报工；请联系管理员先修复任务计划数`,
    );
  }
}

type PieceworkTaskInput = Parameters<
  typeof calcMachinePieceworkBreakdown
>[0];
type PieceworkRuleInput = Parameters<
  typeof calcMachinePieceworkBreakdown
>[1];

function calculateStorablePiecework(
  task: PieceworkTaskInput,
  rule: PieceworkRuleInput,
): ReturnType<typeof calcMachinePieceworkBreakdown> {
  let breakdown: ReturnType<typeof calcMachinePieceworkBreakdown>;
  try {
    breakdown = calcMachinePieceworkBreakdown(task, rule);
  } catch {
    throw new ReportError('计件规则格式非法，请联系管理员修正规则');
  }
  if (
    !breakdown.amount.isFinite() ||
    breakdown.amount.isNegative() ||
    breakdown.amount.toDecimalPlaces(2).gt(DECIMAL_10_2_MAX)
  ) {
    throw new ReportError(
      '计件金额超过系统可保存上限 99,999,999.99 元，请核对报工数量或调整计件规则',
    );
  }
  return breakdown;
}

type ReassignTxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  productionTask: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      status: TaskStatus;
      workerId: string | null;
      orderItem: { orderId: string; name: string; sequence: number };
      craft: AssignmentCraft;
    } | null>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string; status: TaskStatus; workerId: string | null }>;
  };
  user: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<
      | (AssignmentWorker & { role: Role; isActive: boolean; displayName: string })
      | null
    >;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

export type ReassignProductionTaskResult = {
  taskId: string;
  workerId: string;
  status: TaskStatus;
};

// Started/completed work is immutable: changing its worker after pickup would
// move salary ownership. Administrators may safely correct PENDING tasks.
export async function reassignProductionTask(
  taskId: string,
  workerId: string,
  actor: { id: string; role: Role },
  overrideReason = '',
): Promise<ReassignProductionTaskResult> {
  if (actor.role !== Role.ADMIN) {
    throw new ReportError('只有管理员可以改派生产任务');
  }
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as ReassignTxClient;
    const pre = await txClient.productionTask.findUnique({
      where: { id: taskId },
      select: { id: true, orderItem: { select: { orderId: true } } },
    });
    if (!pre) throw new ReportError('任务不存在');

    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      pre.orderItem.orderId,
    )}))`;
    const task = await txClient.productionTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workerId: true,
        orderItem: { select: { orderId: true, name: true, sequence: true } },
        craft: {
          select: {
            id: true,
            isOutsource: true,
            defaultWorkerType: true,
            defaultMachineType: true,
            inHouseMachineTypes: true,
          },
        },
      },
    });
    if (!task) throw new ReportError('任务不存在');
    if (task.status !== TaskStatus.PENDING) {
      throw new ReportError('只有未开工任务可以改派');
    }

    const worker = await txClient.user.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        displayName: true,
        role: true,
        isActive: true,
        workerType: true,
        machineType: true,
        machineCapabilities: true,
        craftCapabilities: { select: { craftId: true } },
      },
    });
    if (!worker || worker.role !== Role.WORKER) {
      throw new ReportError('目标师傅不存在');
    }
    if (!worker.isActive) throw new ReportError('目标师傅已停用');
    try {
      assertWorkerAssignable(task.craft, worker, overrideReason);
    } catch (error) {
      if (error instanceof SchedulingError) throw new ReportError(error.message);
      throw error;
    }

    if (task.workerId === workerId) {
      return { taskId: task.id, workerId, status: task.status };
    }
    const updated = await txClient.productionTask.update({
      where: { id: task.id },
      data: {
        workerId,
        workerType: task.craft.defaultWorkerType,
        machineType: getWorkerAssignmentEligibility(task.craft, worker)
          .machineType,
      },
      select: { id: true, workerId: true, status: true },
    });
    await txClient.orderLog.create({
      data: {
        orderId: task.orderItem.orderId,
        operatorId: actor.id,
        action: 'TASK_REASSIGN',
        changedFields: {
          workerId: { before: task.workerId, after: workerId },
          taskId: { before: task.id, after: task.id },
          ...(!getWorkerAssignmentEligibility(task.craft, worker).recommended
            ? {
                assignmentOverride: {
                  craftId: task.craft.id,
                  workerId,
                  reason: overrideReason.trim(),
                },
              }
            : {}),
        },
        remark: `改派：${task.orderItem.name} (#${task.orderItem.sequence}) → ${worker.displayName}${
          getWorkerAssignmentEligibility(task.craft, worker).recommended
            ? ''
            : `；非推荐派工原因：${overrideReason.trim()}`
        }`,
      },
    });
    return {
      taskId: updated.id,
      workerId: updated.workerId ?? workerId,
      status: updated.status,
    };
  });
}

// Tx surface for begin/report. Same narrow-on-purpose style as the
// scheduling helper.
type TaskTxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  productionTask: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<
      | {
          id: string;
          status: TaskStatus;
          workerId: string | null;
          workerType?: WorkerType | null;
          machineType: MachineType | null;
          plannedQty: number;
          remark?: string | null;
          orderItem: {
            id: string;
            orderId: string;
            isDoubleSided: boolean;
            isDoubleColor: boolean;
            name: string;
            sequence: number;
            order: { id: string; status: OrderStatus };
          };
        }
      | null
    >;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<{
      id: string;
      status: TaskStatus;
    }>;
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: TaskStatus }>>;
  };
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      status: OrderStatus;
      requiresOutsource?: boolean;
    } | null>;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<{
      id: string;
      status: OrderStatus;
    }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
  user: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{
      id: string;
      role: Role;
      isActive: boolean;
      workerType: WorkerType | null;
      machineType: MachineType | null;
    } | null>;
  };
  outsourceOrder: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: OutsourceStatus }>>;
  };
};

// Per-task advisory lock — serializes concurrent reports on the SAME
// task (double-submit guard). Note beginTask and cancelOrder both write
// ProductionTask.status under orderCascadeLockKey (lib/order/locks.ts),
// NOT this key: any task-status write that a cancel must serialize
// against goes through the per-order lock. reportTask only ever acts on
// an already-IN_PROGRESS task, and cancelOrder refuses to cancel an
// order that has an IN_PROGRESS task — so a report can never race a
// cancel, and this per-task lock is enough for the double-submit case.
function taskLockKey(taskId: string): string {
  return `print-shop-erp:task:${taskId}`;
}

export type BeginTaskResult = {
  taskId: string;
  status: TaskStatus;
  orderStatusChanged: boolean;
};

// Worker picks up a PENDING task. Cascade: if this is the first task
// on the order to leave PENDING, transition Order SCHEDULING →
// IN_PRODUCTION (SPEC §3.2 / §4.3). Idempotent on a second begin by
// the same worker — returns without writing.
export async function beginTask(
  taskId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<BeginTaskResult> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TaskTxClient;

    // Pre-read (unlocked) just to learn the orderId. EVERY
    // ProductionTask.status write for an order must serialize on the
    // per-ORDER cascade lock — the SAME key cancelOrder holds (A1).
    // beginTask used to write the task under a per-TASK lock only, which
    // shared no lock with cancelOrder's cascade: a concurrent 开工/取消
    // could resurrect a just-voided PENDING task to IN_PROGRESS and
    // leave it on a CANCELLED order (→ reported → paid). Taking the
    // order lock BEFORE any task write closes that race (and avoids the
    // lock-ordering deadlock the per-task-lock-then-order-lock sequence
    // created against cancelOrder).
    const pre = await txClient.productionTask.findUnique({
      where: { id: taskId },
      select: { id: true, orderItem: { select: { orderId: true } } },
    });
    if (!pre) throw new ReportError('任务不存在');

    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      pre.orderItem.orderId,
    )}))`;

    // Fresh read INSIDE the lock — the pre-read can be stale: a
    // concurrent cancelOrder holding this same lock may have just voided
    // the task, and it committed before we acquired the lock.
    const task = await txClient.productionTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workerId: true,
        workerType: true,
        machineType: true,
        plannedQty: true,
        orderItem: {
          select: {
            id: true,
            orderId: true,
            isDoubleSided: true,
            isDoubleColor: true,
            name: true,
            sequence: true,
            order: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!task) throw new ReportError('任务不存在');

    const globalOverride = actor.role === Role.ADMIN;
    if (!globalOverride && task.workerId !== actor.id) {
      throw new ReportError('只能开始分配给自己的任务');
    }

    // Re-check the assigned account at pickup time. It may have been
    // deactivated or changed after scheduling, and legacy rows may predate the
    // strict assignment gate. Refuse to start with the wrong payroll/machine
    // identity; the administrator can safely reassign while still PENDING.
    const assignedWorker = task.workerId
      ? await txClient.user.findUnique({
          where: { id: task.workerId },
          select: {
            id: true,
            role: true,
            isActive: true,
            workerType: true,
            machineType: true,
            machineCapabilities: true,
          },
        })
      : null;
    const taskWorkerType =
      task.workerType ?? (task.machineType ? WorkerType.MACHINE : null);
    if (
      !assignedWorker ||
      assignedWorker.role !== Role.WORKER ||
      !assignedWorker.isActive ||
      assignedWorker.workerType !== taskWorkerType ||
      (taskWorkerType === WorkerType.MACHINE &&
        !workerCanOperateMachine(assignedWorker, task.machineType))
    ) {
      throw new ReportError(
        '任务与当前师傅的岗位或机型不匹配，请联系管理员改派',
      );
    }

    // Cancelled with its order (A1). Checked on the FRESH (in-lock) read,
    // so a cancel that committed just before we got the lock is seen. The
    // status machine below would also reject CANCELLED → IN_PROGRESS
    // (terminal); this surfaces a clear business message instead.
    if (task.status === TaskStatus.CANCELLED) {
      throw new ReportError('该任务已随工单取消，不能开工');
    }
    if (task.orderItem.order.status === OrderStatus.SUBMITTED) {
      throw new ReportError(
        '工单还有工艺未完成排产，全部派工后才能开始生产',
      );
    }

    // Idempotent: same worker restarting their own already-started
    // task is a no-op. We intentionally don't advance startedAt here
    // since the first-begin timestamp is the audit-useful one.
    if (task.status === TaskStatus.IN_PROGRESS) {
      return {
        taskId: task.id,
        status: task.status,
        orderStatusChanged: false,
      };
    }

    transitionProductionTask(task.status, TaskStatus.IN_PROGRESS);

    await txClient.productionTask.update({
      where: { id: taskId },
      data: { status: TaskStatus.IN_PROGRESS, startedAt: now },
      select: { id: true, status: true },
    });

    // Cascade Order SCHEDULING → IN_PRODUCTION on first task pickup
    // (SPEC §3.2). We already hold orderCascadeLock from the top, so a
    // sibling beginTask can't interleave; re-read the order fresh for the
    // status-machine guard.
    let orderStatusChanged = false;
    const { order } = task.orderItem;
    if (order.status === OrderStatus.SCHEDULING) {
      const fresh = await txClient.order.findUnique({
        where: { id: order.id },
        select: { id: true, status: true },
      });
      if (!fresh) throw new ReportError('工单不存在');
      if (fresh.status !== OrderStatus.SCHEDULING) {
        // A sibling beginTask already moved the order. Nothing to do.
        return {
          taskId: task.id,
          status: TaskStatus.IN_PROGRESS,
          orderStatusChanged: false,
        };
      }
      transitionOrder(fresh.status, OrderStatus.IN_PRODUCTION);
      await txClient.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.IN_PRODUCTION },
        select: { id: true, status: true },
      });
      await txClient.orderLog.create({
        data: {
          orderId: order.id,
          operatorId: actor.id,
          action: 'STATUS_CHANGE',
          changedFields: {
            status: {
              before: OrderStatus.SCHEDULING,
              after: OrderStatus.IN_PRODUCTION,
            },
          },
          remark: `开始生产：${task.orderItem.name} (#${task.orderItem.sequence})`,
        },
      });
      orderStatusChanged = true;
    }

    return {
      taskId: task.id,
      status: TaskStatus.IN_PROGRESS,
      orderStatusChanged,
    };
  });
}

export type ReportTaskResult = {
  taskId: string;
  status: TaskStatus;
  pieceworkAmount: string;
  boardCount: number;
  pressCount: number;
  orderCompleted: boolean;
};

// Worker completes a task. Fetches the active WORKER_MACHINE rule for
// the task's snapshotted machineType, runs the piecework math on the
// *actual pressed* count (completedQty + defectQty + reworkQty), and
// snapshots the rule onto ProductionTask.salaryRuleSnapshot per
// CLAUDE.md §4.4. Cascade: if this is the last task COMPLETED on the
// order, transition Order IN_PRODUCTION → COMPLETED.
export async function reportTask(
  taskId: string,
  input: ReportTaskInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<ReportTaskResult> {
  // 数量守卫的倍数上限（Setting，业主可后台改，默认 3 倍）。**必须在开事务
  // 之前读**：getSetting 走全局 db，放进 tx 回调里就是在持有 taskLockKey
  // advisory lock 的同时再向连接池要一条连接——池打满时这是经典自锁。
  const { multiple: maxReportMultiple } = await getSetting(
    'report_qty_max_multiple',
  );

  // Slice C wire ─ 需要 cascade 后的 orderId 来 fire ORDER_COMPLETED。
  // tx 内拿不到 orderId 单独传出（要保留接口稳定），下面在 tx 关闭后
  // 单查一次 task → orderItem.orderId。
  const result = await db.$transaction(async (tx) => {
    const txClient = tx as unknown as TaskTxClient;

    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${taskLockKey(taskId)}))`;

    const task = await txClient.productionTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workerId: true,
        workerType: true,
        machineType: true,
        plannedQty: true,
        remark: true,
        orderItem: {
          select: {
            id: true,
            orderId: true,
            isDoubleSided: true,
            isDoubleColor: true,
            name: true,
            sequence: true,
            order: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (!task) throw new ReportError('任务不存在');

    const globalOverride = actor.role === Role.ADMIN;
    if (!globalOverride && task.workerId !== actor.id) {
      throw new ReportError('只能报工分配给自己的任务');
    }

    // Cancelled with its order (A1). The status machine below would also
    // reject CANCELLED → COMPLETED (terminal); clearer message here means
    // no piecework is ever computed or written for a voided task.
    if (task.status === TaskStatus.CANCELLED) {
      throw new ReportError('该任务已随工单取消，不能报工');
    }

    transitionProductionTask(task.status, TaskStatus.COMPLETED);
    // 表单校验只能保护新数据；历史脚本/直连 SQL 留下的非法计划数
    // 必须在任何金额计算或状态写入前 fail-closed。批量报工走同一守卫。
    assertValidPlannedQuantity(task.plannedQty);

    // ── 数量守卫（业主 2026-08-21 拍板）────────────────────────────────
    // 少报是合法的（材料不足、中途换机、半成品转外协…），直接放行；
    // 超过计划数要勾确认并留痕；合计**达到**「计划数 × N」一律拒绝，挡的
    // 是多打一个零。N 在 Setting 里（report_qty_max_multiple），业主可后台调。
    //
    // 判据是 >= 而不是 >：多打一个零把 P 变成 10P，严格大于时 N=10 恰好
    // 放行——那正是这道守卫唯一要挡的场景。默认 N=3、可配上限 10。
    //
    // 位置：状态机之后、order 锁和规则查询之前 —— 被拒的报工不该拿走任何
    // 锁，也不该产生任何计件计算。plannedQty 在这里读是关键：它和下面的
    // update 在同一事务、同一把 taskLockKey 锁内，两者拿到的是同一个一致性
    // 快照（plannedQty 本身在任务开工后已不可变，见 assertQuantityChangeAllowed）。
    //
    // 批量路径 reportTasks() 强制按 plannedQty 报（SPEC §3.3「一键完工：
    // 合格数=计划数」），合计恒等于计划数，本守卫对它是恒真的，所以不动它。
    const totalReported =
      input.completedQty + input.defectQty + input.reworkQty;
    let overReportRemark: string | null = null;

    if (totalReported > task.plannedQty) {
      const limitQty = task.plannedQty * maxReportMultiple;

      if (totalReported >= limitQty) {
        throw new OverReportError({
          confirmable: false,
          plannedQty: task.plannedQty,
          totalReported,
          limitQty,
          message:
            `合计报工 ${totalReported} 已达到计划数 ${task.plannedQty} 的 ` +
            `${maxReportMultiple} 倍上限（${limitQty}），请核对数量后重新填写。` +
            `确实需要超出请联系管理员调整「单条报工数量上限倍数」。`,
        });
      }

      if (input.overReportConfirmed !== true) {
        throw new OverReportError({
          confirmable: true,
          plannedQty: task.plannedQty,
          totalReported,
          limitQty,
          message:
            `合计报工 ${totalReported} 超过计划数 ${task.plannedQty}，` +
            `请勾选「确认超出计划数」后再提交。`,
        });
      }

      overReportRemark =
        `[超计划报工] ${todayShanghai(now)} 计划 ${task.plannedQty} / ` +
        `合计 ${totalReported}（合格 ${input.completedQty} / ` +
        `不良 ${input.defectQty} / 返工 ${input.reworkQty}），` +
        `报工人 ${actor.id}，已勾选确认`;
    }

    // Keep the same task → order → salary-rule lock order as the batch
    // report path. Besides avoiding a lock-order cycle, holding the order lock
    // through the task write makes the later completion cascade a single
    // serialized operation.
    const { order } = task.orderItem;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      order.id,
    )}))`;

    const taskWorkerType =
      task.workerType ?? (task.machineType ? WorkerType.MACHINE : null);
    let boardCount = 0;
    let pressCount = 0;
    let pieceworkAmount = '0.00';
    let salaryRuleSnapshot: Record<string, unknown>;

    if (taskWorkerType === WorkerType.MACHINE) {
      if (!task.machineType) {
        throw new ReportError('开机任务缺少机型快照，请联系管理员改派');
      }
      if (task.workerId) {
        await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${machineRuleLockKey(
          task.workerId,
          task.machineType,
        )}))`;
      }
      const rule = await getActiveMachineRule(
        task.machineType,
        now,
        task.workerId ?? undefined,
        tx,
      );
      if (!rule) {
        throw new ReportError(
          `无当前生效的 ${task.machineType} 薪资规则，请联系管理员补规则后再报工`,
        );
      }
      const totalPressed =
        input.completedQty + input.defectQty + input.reworkQty;
      const breakdown = calculateStorablePiecework(
        {
          quantity: totalPressed,
          itemCount: 1,
          isDoubleSided: task.orderItem.isDoubleSided,
          isDoubleColor: task.orderItem.isDoubleColor,
        },
        rule,
      );
      boardCount = breakdown.boardCount;
      pressCount = breakdown.pressCount;
      pieceworkAmount = breakdown.amount.toFixed(2);
      salaryRuleSnapshot = rule as unknown as Record<string, unknown>;
    } else if (
      taskWorkerType === WorkerType.PACKER ||
      taskWorkerType === WorkerType.CLEANER
    ) {
      // These tasks still drive production progress, but compensation comes
      // from attendance/hourly payroll rather than the machine-piecework ledger.
      salaryRuleSnapshot = {
        payrollMode: 'HOURLY',
        workerType: taskWorkerType,
      };
    } else {
      throw new ReportError('任务缺少有效的生产岗位快照，请联系管理员改派');
    }

    await txClient.productionTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.COMPLETED,
        completedQty: input.completedQty,
        defectQty: input.defectQty,
        reworkQty: input.reworkQty,
        boardCount,
        pressCount,
        pieceworkAmount,
        salaryRuleSnapshot,
        completedAt: now,
        // 只在真的超报时才带上这个 key —— 没超报时 data 里根本不出现
        // remark，既方便断言，也不会让别的写入方误以为这里会清空备注。
        // 追加而不是覆盖：ProductionTask.remark 在此之前全仓没有写入方，
        // 这是它第一个写入方，追加是零成本的向前兼容。
        ...(overReportRemark
          ? {
              remark: [task.remark, overReportRemark]
                .filter(
                  (line): line is string =>
                    typeof line === 'string' && line.trim() !== '',
                )
                .join('\n'),
            }
          : {}),
      },
      select: { id: true, status: true },
    });

    if (overReportRemark) {
      // 任务备注是数据层留痕；OrderLog 才是老板真会翻的那条时间线，也是
      // 看板「超计划报工」那张表的唯一数据源（lib/dashboard/owner-watchlist.ts
      // 的 getRecentOverReports 按 action='TASK_OVER_REPORT' 查它）。
      // before 全填 0 是诚实的：这三个计数在本次报工前确实都是 0
      // （schema 默认值），plannedQty 和合计放在 remark 里给人读。
      await txClient.orderLog.create({
        data: {
          orderId: order.id,
          operatorId: actor.id,
          action: 'TASK_OVER_REPORT',
          changedFields: {
            completedQty: { before: 0, after: input.completedQty },
            defectQty: { before: 0, after: input.defectQty },
            reworkQty: { before: 0, after: input.reworkQty },
          },
          remark: `${task.orderItem.name} (#${task.orderItem.sequence})：${overReportRemark}`,
        },
      });
    }

    // Cascade-to-COMPLETED gate: all non-CANCELLED tasks for this order must
    // be COMPLETED, and every item carrying an outsource craft must be
    // covered by a live outsource order. The order lock has been held since
    // before the task write.
    //
    // 这里只取 .completed：覆盖缺口是主管要处理的事，师傅端报工界面显示
    // 「款式 B 尚未外协」没有任何可执行动作。缺口的呈现走工单详情页横幅 +
    // 外协收货返回值，见 app/(admin)/orders/[id]/page.tsx。
    const completion = await maybeCompleteProductionOrder(
      txClient as unknown as ProductionCompletionTx,
      order.id,
      actor.id,
      now,
    );
    const orderCompleted = completion.completed;

    return {
      taskId: task.id,
      status: TaskStatus.COMPLETED,
      pieceworkAmount,
      boardCount,
      pressCount,
      orderCompleted,
    };
  });

  // Slice C wire ─ ORDER_COMPLETED（仅 cascade 路径；tx 已 commit；
  // 生产入持久化队列）。
  if (result.orderCompleted && backgroundJobsMode() !== 'durable') {
    const taskWithOrder = await db.productionTask.findUnique({
      where: { id: result.taskId },
      select: {
        orderItem: {
          select: {
            order: {
              select: { id: true, orderNo: true, customerRef: true },
            },
          },
        },
      },
    });
    const order = taskWithOrder?.orderItem.order;
    if (order) {
      await dispatchNotification(
        'ORDER_COMPLETED',
        {
          orderId: order.id,
          orderNo: order.orderNo,
          customerRef: order.customerRef,
        },
        { dedupeKey: `notification:ORDER_COMPLETED:${order.id}` },
      );
    }
  }

  return result;
}

function normalizedBatchTaskIds(taskIds: string[]): string[] {
  const normalized = [...new Set(taskIds)];
  if (normalized.length === 0) throw new ReportError('请至少选择一个任务');
  if (normalized.length > 50) throw new ReportError('单次最多处理 50 个任务');
  return normalized.sort();
}

/**
 * Starts several tasks in one transaction. Order advisory locks are acquired in
 * stable order before any task write, so cancel/individual pickup cannot leave
 * a partially-started selection.
 */
export async function beginTasks(
  taskIds: string[],
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ taskIds: string[] }> {
  const ids = normalizedBatchTaskIds(taskIds);
  return db.$transaction(async (tx) => {
    const tasks = await tx.productionTask.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        workerId: true,
        workerType: true,
        machineType: true,
        orderItem: {
          select: {
            name: true,
            sequence: true,
            orderId: true,
            order: { select: { id: true, status: true } },
          },
        },
      },
    });
    if (tasks.length !== ids.length) throw new ReportError('选择中包含不存在的任务');
    const orderIds = [
      ...new Set(tasks.map((task) => task.orderItem.orderId)),
    ].sort();
    for (const orderId of orderIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        orderId,
      )}))`;
    }

    const freshTasks = await tx.productionTask.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        workerId: true,
        workerType: true,
        machineType: true,
        orderItem: {
          select: {
            name: true,
            sequence: true,
            orderId: true,
            order: { select: { id: true, status: true } },
          },
        },
      },
    });
    const worker = await tx.user.findUnique({
      where: { id: actor.id },
      select: {
        id: true,
        role: true,
        isActive: true,
        workerType: true,
        machineType: true,
        machineCapabilities: true,
      },
    });
    if (!worker || worker.role !== Role.WORKER || !worker.isActive) {
      throw new ReportError('当前师傅账号不可用');
    }

    for (const task of freshTasks) {
      if (actor.role !== Role.ADMIN && task.workerId !== actor.id) {
        throw new ReportError('只能开始分配给自己的任务');
      }
      if (task.status === TaskStatus.CANCELLED) {
        throw new ReportError('选择中包含已取消任务');
      }
      if (
        task.status !== TaskStatus.PENDING &&
        task.status !== TaskStatus.IN_PROGRESS
      ) {
        throw new ReportError('选择中包含不能开始的任务');
      }
      if (task.orderItem.order.status === OrderStatus.SUBMITTED) {
        throw new ReportError(
          '选择中有工单尚未完成全部排产，暂时不能开始生产',
        );
      }
      const taskWorkerType =
        task.workerType ?? (task.machineType ? WorkerType.MACHINE : null);
      if (
        worker.workerType !== taskWorkerType ||
        (taskWorkerType === WorkerType.MACHINE &&
          !workerCanOperateMachine(worker, task.machineType))
      ) {
        throw new ReportError('选择中有任务与当前岗位或机型不匹配');
      }
    }

    await tx.productionTask.updateMany({
      where: { id: { in: ids }, status: TaskStatus.PENDING },
      data: { status: TaskStatus.IN_PROGRESS, startedAt: now },
    });
    for (const orderId of orderIds) {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (order?.status !== OrderStatus.SCHEDULING) continue;
      transitionOrder(order.status, OrderStatus.IN_PRODUCTION);
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.IN_PRODUCTION },
      });
      const firstTask = freshTasks.find(
        (task) => task.orderItem.orderId === orderId,
      );
      await tx.orderLog.create({
        data: {
          orderId,
          operatorId: actor.id,
          action: 'STATUS_CHANGE',
          changedFields: {
            status: {
              before: OrderStatus.SCHEDULING,
              after: OrderStatus.IN_PRODUCTION,
            },
          },
          remark: firstTask
            ? `批量开始生产：${firstTask.orderItem.name} 等`
            : '批量开始生产',
        },
      });
    }
    return { taskIds: ids };
  });
}

/**
 * Reports selected in-progress tasks at their planned quantity. Salary
 * snapshots and all task/order cascades commit together; one invalid task rolls
 * the whole selection back.
 */
export async function reportTasks(
  taskIds: string[],
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ taskIds: string[]; completedOrderIds: string[] }> {
  const ids = normalizedBatchTaskIds(taskIds);
  const result = await db.$transaction(async (tx) => {
    const locatorRows = await tx.productionTask.findMany({
      where: { id: { in: ids } },
      select: { id: true, orderItem: { select: { orderId: true } } },
    });
    if (locatorRows.length !== ids.length) {
      throw new ReportError('选择中包含不存在的任务');
    }
    for (const taskId of ids) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${taskLockKey(
        taskId,
      )}))`;
    }
    const orderIds = [
      ...new Set(locatorRows.map((row) => row.orderItem.orderId)),
    ].sort();
    for (const orderId of orderIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        orderId,
      )}))`;
    }

    const tasks = await tx.productionTask.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        workerId: true,
        workerType: true,
        machineType: true,
        plannedQty: true,
        orderItem: {
          select: {
            orderId: true,
            name: true,
            isDoubleSided: true,
            isDoubleColor: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    for (const task of tasks) {
      if (actor.role !== Role.ADMIN && task.workerId !== actor.id) {
        throw new ReportError('只能报工分配给自己的任务');
      }
      if (task.status !== TaskStatus.IN_PROGRESS) {
        throw new ReportError(`任务“${task.orderItem.name}”尚未开始或已报工`);
      }
      assertValidPlannedQuantity(
        task.plannedQty,
        `任务“${task.orderItem.name}”`,
      );
    }

    const machineRuleLocks = [
      ...new Set(
        tasks.flatMap((task) =>
          task.workerId && task.machineType
            ? [machineRuleLockKey(task.workerId, task.machineType)]
            : [],
        ),
      ),
    ].sort();
    for (const lockKey of machineRuleLocks) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    }

    for (const task of tasks) {
      const taskWorkerType =
        task.workerType ?? (task.machineType ? WorkerType.MACHINE : null);
      let boardCount = 0;
      let pressCount = 0;
      let pieceworkAmount = '0.00';
      let salaryRuleSnapshot: Prisma.InputJsonValue;
      if (taskWorkerType === WorkerType.MACHINE) {
        if (!task.machineType) {
          throw new ReportError('开机任务缺少机型快照，请联系管理员改派');
        }
        const rule = await getActiveMachineRule(
          task.machineType,
          now,
          task.workerId ?? undefined,
          tx,
        );
        if (!rule) {
          throw new ReportError(
            `无当前生效的 ${task.machineType} 薪资规则，请联系管理员补规则`,
          );
        }
        const breakdown = calculateStorablePiecework(
          {
            quantity: task.plannedQty,
            itemCount: 1,
            isDoubleSided: task.orderItem.isDoubleSided,
            isDoubleColor: task.orderItem.isDoubleColor,
          },
          rule,
        );
        boardCount = breakdown.boardCount;
        pressCount = breakdown.pressCount;
        pieceworkAmount = breakdown.amount.toFixed(2);
        salaryRuleSnapshot = rule as unknown as Prisma.InputJsonValue;
      } else if (
        taskWorkerType === WorkerType.PACKER ||
        taskWorkerType === WorkerType.CLEANER
      ) {
        salaryRuleSnapshot = {
          payrollMode: 'HOURLY',
          workerType: taskWorkerType,
        };
      } else {
        throw new ReportError('任务缺少有效的生产岗位快照，请联系管理员改派');
      }
      await tx.productionTask.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.COMPLETED,
          completedQty: task.plannedQty,
          defectQty: 0,
          reworkQty: 0,
          boardCount,
          pressCount,
          pieceworkAmount,
          salaryRuleSnapshot,
          completedAt: now,
        },
      });
    }

    const completedOrderIds: string[] = [];
    for (const orderId of orderIds) {
      // ⚠️ maybeCompleteProductionOrder 返回的是对象，不是 boolean。写成
      // `if (await maybeCompleteProductionOrder(...))` 会恒为 truthy 而
      // tsc 一个字都不报——工单会被无条件判为完工。必须显式取 .completed。
      const completion = await maybeCompleteProductionOrder(
        tx as unknown as ProductionCompletionTx,
        orderId,
        actor.id,
        now,
      );
      if (completion.completed) {
        completedOrderIds.push(orderId);
      }
    }
    return { taskIds: ids, completedOrderIds };
  });

  if (
    result.completedOrderIds.length > 0 &&
    backgroundJobsMode() !== 'durable'
  ) {
    const orders = await db.order.findMany({
      where: { id: { in: result.completedOrderIds } },
      select: { id: true, orderNo: true, customerRef: true },
    });
    for (const order of orders) {
      await dispatchNotification(
        'ORDER_COMPLETED',
        {
          orderId: order.id,
          orderNo: order.orderNo,
          customerRef: order.customerRef,
        },
        { dedupeKey: `notification:ORDER_COMPLETED:${order.id}` },
      );
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Worker-side read helpers
// ─────────────────────────────────────────────────────────────────────

export type WorkerTaskListRow = {
  id: string;
  status: TaskStatus;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  plannedQty: number;
  item: {
    id: string;
    name: string;
    sequence: number;
    isDoubleSided: boolean;
    isDoubleColor: boolean;
    quantity: number;
  };
  craft: { name: string };
  order: {
    id: string;
    orderNo: string;
    customName: string | null;
    isUrgent: boolean;
    submitterName: string;
  };
};

// A worker's open tasks — PENDING + IN_PROGRESS. Sorted: urgent
// orders first, then oldest scheduled first (FIFO within the queue).
export async function listWorkerTasks(
  workerId: string,
): Promise<WorkerTaskListRow[]> {
  const rows = await db.productionTask.findMany({
    where: {
      workerId,
      status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
      orderItem: {
        order: { status: { not: OrderStatus.SUBMITTED } },
      },
    },
    select: {
      id: true,
      status: true,
      workerType: true,
      machineType: true,
      plannedQty: true,
      orderItem: {
        select: {
          id: true,
          name: true,
          sequence: true,
          isDoubleSided: true,
          isDoubleColor: true,
          quantity: true,
          order: {
            select: {
              id: true,
              orderNo: true,
              customName: true,
              status: true,
              isUrgent: true,
              createdAt: true,
              submitter: { select: { displayName: true } },
            },
          },
        },
      },
      craft: { select: { name: true } },
    },
    orderBy: [
      { orderItem: { order: { isUrgent: 'desc' } } },
      { orderItem: { order: { createdAt: 'asc' } } },
      { createdAt: 'asc' },
    ],
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    workerType: r.workerType,
    machineType: r.machineType,
    plannedQty: r.plannedQty,
    item: {
      id: r.orderItem.id,
      name: r.orderItem.name,
      sequence: r.orderItem.sequence,
      isDoubleSided: r.orderItem.isDoubleSided,
      isDoubleColor: r.orderItem.isDoubleColor,
      quantity: r.orderItem.quantity,
    },
    craft: { name: r.craft.name },
    order: {
      id: r.orderItem.order.id,
      orderNo: r.orderItem.order.orderNo,
      customName: r.orderItem.order.customName,
      isUrgent: r.orderItem.order.isUrgent,
      submitterName: r.orderItem.order.submitter.displayName,
    },
  }));
}

// Single task detail for the worker report page. Scope guard: only
// the assigned worker (or ADMIN) can read the record.
export async function getWorkerTaskDetail(
  taskId: string,
  actor: { id: string; role: Role },
) {
  // scope 表达在 where 里（与 getOrderScopeFilter 同构），不再整行读出来
  // 再判断 —— 标题查询（lib/page-title/refs.ts）复用同一片段，两处不会漂移。
  const row = await db.productionTask.findFirst({
    where: { id: taskId, ...getWorkerTaskScopeFilter(actor) },
    select: {
      id: true,
      status: true,
      workerId: true,
      workerType: true,
      machineType: true,
      plannedQty: true,
      boardCount: true,
      pressCount: true,
      completedQty: true,
      defectQty: true,
      reworkQty: true,
      pieceworkAmount: true,
      startedAt: true,
      completedAt: true,
      orderItem: {
        select: {
          id: true,
          name: true,
          sequence: true,
          quantity: true,
          specification: true,
          paperType: true,
          foilColors: true,
          remark: true,
          isDoubleSided: true,
          isDoubleColor: true,
          designs: {
            where: { fileType: DesignFileType.IMAGE },
            orderBy: { uploadedAt: 'asc' },
            select: {
              id: true,
              fileName: true,
              fileUrl: true,
            },
          },
          order: {
            select: {
              id: true,
              orderNo: true,
              customName: true,
              isUrgent: true,
              customerRef: true,
              status: true,
              submitter: { select: { displayName: true } },
            },
          },
        },
      },
      craft: { select: { name: true } },
    },
  });
  return row;
}

export { InvalidTaskTransitionError };

// ─────────────────────────────────────────────────────────────────────
// Read helpers for the scheduling UI
// ─────────────────────────────────────────────────────────────────────

// All SUBMITTED orders awaiting scheduling. Foremen see everything
// (no scope filter) — matches `order:schedule` permission's "no
// ownership" posture.
export type PendingSchedulingCraftSummary = {
  id: string;
  name: string;
  count: number;
  assignedCount: number;
  isOutsource: boolean;
  isHybrid: boolean;
};

type PendingSchedulingCraftDefinition = Omit<
  SchedulingViewCraft,
  'assignedWorkerId'
> & {
  isActive: boolean;
};

export type PendingSchedulingOrderView = {
  id: string;
  orderNo: string;
  customName: string | null;
  kind: OrderKind;
  sourceOrder: { orderNo: string } | null;
  isUrgent: boolean;
  customerRef: string | null;
  promisedDate: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  submitter: { displayName: string; role: Role };
  itemCount: number;
  totalQuantity: number;
  internalTaskCount: number;
  assignedTaskCount: number;
  remainingTaskCount: number;
  craftSummaries: PendingSchedulingCraftSummary[];
  compatibleWorkerIds: string[];
  compatibleTaskCounts: Record<string, number>;
  recommendedTaskCounts: Record<string, number>;
  overrideTaskCounts: Record<string, number>;
  batchBlockReason: string | null;
};

export type PendingSchedulingBoard = {
  orders: PendingSchedulingOrderView[];
  workers: SchedulingViewCandidate[];
};

export async function getPendingSchedulingBoard(): Promise<PendingSchedulingBoard> {
  const orders = await db.order.findMany({
    where: { status: OrderStatus.SUBMITTED, items: { some: {} } },
    select: {
      id: true,
      orderNo: true,
      customName: true,
      kind: true,
      sourceOrder: { select: { orderNo: true } },
      isUrgent: true,
      customerRef: true,
      promisedDate: true,
      submittedAt: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          quantity: true,
          crafts: true,
          tasks: {
            select: {
              craftId: true,
              status: true,
            },
          },
        },
      },
      outsourceOrders: {
        where: { status: { not: OutsourceStatus.CANCELLED } },
        select: { id: true },
      },
      submitter: {
        select: { displayName: true, role: true },
      },
    },
    orderBy: [
      { isUrgent: 'desc' },
      { promisedDate: { sort: 'asc', nulls: 'last' } },
      { submittedAt: 'asc' },
    ],
  });

  const craftIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      for (const craftId of item.crafts) craftIds.add(craftId);
    }
  }
  const craftPromise: Promise<PendingSchedulingCraftDefinition[]> =
    craftIds.size === 0
      ? Promise.resolve([])
      : db.craft.findMany({
          where: { id: { in: [...craftIds] } },
          select: {
            id: true,
            name: true,
            isActive: true,
            isOutsource: true,
            defaultWorkerType: true,
            defaultMachineType: true,
            inHouseMachineTypes: true,
          },
        });
  const [crafts, workers] = await Promise.all([
    craftPromise,
    listActiveWorkerCandidates(),
  ]);
  const craftById = new Map(crafts.map((craft) => [craft.id, craft]));

  return {
    workers,
    orders: orders.map((order) => {
      const craftCountById = new Map<string, number>();
      const assignedCraftCountById = new Map<string, number>();
      const internalPairs: Array<{
        key: string;
        craft: PendingSchedulingCraftDefinition;
      }> = [];
      const existingTaskKeys = new Set<string>();
      let hasOutsource = false;
      let hasMissingCraft = false;
      let hasInactiveCraft = false;
      let hasInvalidTask = false;

      for (const item of order.items) {
        for (const task of item.tasks) {
          if (task.status !== TaskStatus.PENDING) hasInvalidTask = true;
          const key = `${item.id}:${task.craftId}`;
          existingTaskKeys.add(key);
          assignedCraftCountById.set(
            task.craftId,
            (assignedCraftCountById.get(task.craftId) ?? 0) + 1,
          );
        }
        for (const craftId of item.crafts) {
          craftCountById.set(
            craftId,
            (craftCountById.get(craftId) ?? 0) + 1,
          );
          const craft = craftById.get(craftId);
          if (!craft) {
            hasMissingCraft = true;
            continue;
          }
          if (!craft.isActive) hasInactiveCraft = true;
          if (craft.isOutsource) hasOutsource = true;
          if (!craft.isOutsource || craft.inHouseMachineTypes.length > 0) {
            internalPairs.push({
              key: `${item.id}:${craftId}`,
              craft,
            });
          }
        }
      }
      const internalPairKeys = new Set(
        internalPairs.map((pair) => pair.key),
      );
      if (
        [...existingTaskKeys].some((key) => !internalPairKeys.has(key))
      ) {
        hasInvalidTask = true;
      }
      const remainingPairs = internalPairs.filter(
        (pair) => !existingTaskKeys.has(pair.key),
      );

      let batchBlockReason: string | null = null;
      if (hasMissingCraft) {
        batchBlockReason = '包含已删除或缺失的工艺';
      } else if (hasInactiveCraft) {
        batchBlockReason = '包含已停用工艺';
      } else if (hasInvalidTask) {
        batchBlockReason = '包含已经开始或状态异常的任务，请单独检查';
      } else if (internalPairs.length === 0) {
        batchBlockReason = '仅外协工单，请单独确认排产';
      } else if (hasOutsource && order.outsourceOrders.length === 0) {
        batchBlockReason = '请先创建外协单';
      } else if (remainingPairs.length === 0) {
        batchBlockReason = '内部工艺已全部分配，请刷新状态';
      }

      const compatibleTaskCounts = Object.fromEntries(
        workers.map((worker) => [
          worker.id,
          remainingPairs.filter((pair) =>
            isWorkerCompatible(pair.craft, worker),
          ).length,
        ]),
      );
      const recommendedTaskCounts = Object.fromEntries(
        workers.map((worker) => [
          worker.id,
          remainingPairs.filter(
            (pair) =>
              getWorkerAssignmentEligibility(pair.craft, worker).recommended,
          ).length,
        ]),
      );
      const overrideTaskCounts = Object.fromEntries(
        workers.map((worker) => [
          worker.id,
          Math.max(
            0,
            compatibleTaskCounts[worker.id] -
              recommendedTaskCounts[worker.id],
          ),
        ]),
      );
      const compatibleWorkerIds =
        batchBlockReason === null
          ? workers
              .filter((worker) => compatibleTaskCounts[worker.id] > 0)
              .map((worker) => worker.id)
          : [];
      if (batchBlockReason === null && compatibleWorkerIds.length === 0) {
        batchBlockReason = '剩余工艺没有匹配的师傅';
      }

      return {
        id: order.id,
        orderNo: order.orderNo,
        customName: order.customName,
        kind: order.kind,
        sourceOrder: order.sourceOrder,
        isUrgent: order.isUrgent,
        customerRef: order.customerRef,
        promisedDate: order.promisedDate,
        submittedAt: order.submittedAt,
        createdAt: order.createdAt,
        submitter: order.submitter,
        itemCount: order.items.length,
        totalQuantity: order.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
        internalTaskCount: internalPairs.length,
        assignedTaskCount: internalPairs.length - remainingPairs.length,
        remainingTaskCount: remainingPairs.length,
        craftSummaries: [...craftCountById.entries()].map(
          ([craftId, count]) => {
            const craft = craftById.get(craftId);
            return {
              id: craftId,
              name: craft?.name ?? '未知工艺',
              count,
              assignedCount: assignedCraftCountById.get(craftId) ?? 0,
              isOutsource: craft?.isOutsource ?? false,
              isHybrid:
                Boolean(craft?.isOutsource) &&
                (craft?.inHouseMachineTypes.length ?? 0) > 0,
            };
          },
        ),
        compatibleWorkerIds,
        compatibleTaskCounts,
        recommendedTaskCounts,
        overrideTaskCounts,
        batchBlockReason,
      };
    }),
  };
}

export type SchedulingViewCraft = {
  id: string;
  name: string;
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
  inHouseMachineTypes: MachineType[];
  assignedWorkerId: string | null;
};

export type SchedulingViewItem = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  specification: string | null;
  paperType: string | null;
  foilColors: string[];
  remark: string | null;
  crafts: SchedulingViewCraft[];
};

export type SchedulingViewCandidate = {
  id: string;
  displayName: string;
  workerType: WorkerType | null;
  machineType: MachineType | null;
  machineCapabilities: MachineType[];
  craftCapabilityIds: string[];
  pendingTaskCount: number;
  inProgressTaskCount: number;
};

export type SchedulingView = {
  orderId: string;
  orderNo: string;
  customName: string | null;
  isUrgent: boolean;
  customerRef: string | null;
  submitterDisplayName: string;
  items: SchedulingViewItem[];
  workers: SchedulingViewCandidate[];
};

async function listActiveWorkerCandidates(): Promise<SchedulingViewCandidate[]> {
  const workers = await db.user.findMany({
    where: { role: Role.WORKER, isActive: true },
    select: {
      id: true,
      displayName: true,
      workerType: true,
      machineType: true,
      machineCapabilities: true,
      craftCapabilities: { select: { craftId: true } },
    },
    orderBy: { displayName: 'asc' },
  });
  const loadRows = await db.productionTask.groupBy({
    by: ['workerId', 'status'],
    where: {
      workerId: { not: null },
      status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
    },
    _count: { _all: true },
  });
  const loadByWorker = new Map<
    string,
    { pendingTaskCount: number; inProgressTaskCount: number }
  >();
  for (const row of loadRows) {
    if (!row.workerId) continue;
    const current = loadByWorker.get(row.workerId) ?? {
      pendingTaskCount: 0,
      inProgressTaskCount: 0,
    };
    if (row.status === TaskStatus.PENDING) {
      current.pendingTaskCount = row._count._all;
    } else if (row.status === TaskStatus.IN_PROGRESS) {
      current.inProgressTaskCount = row._count._all;
    }
    loadByWorker.set(row.workerId, current);
  }
  return workers.map(({ craftCapabilities, ...worker }) => ({
    ...worker,
    machineCapabilities:
      worker.machineCapabilities?.length > 0
        ? worker.machineCapabilities
        : worker.machineType
          ? [worker.machineType]
          : [],
    craftCapabilityIds: (craftCapabilities ?? []).map(
      (capability) => capability.craftId,
    ),
    ...(loadByWorker.get(worker.id) ?? {
      pendingTaskCount: 0,
      inProgressTaskCount: 0,
    }),
  }));
}

// Assembles the view-model the scheduling form needs: the order's items
// + their crafts resolved to names + isOutsource + machineType, plus
// the list of active WORKERs as assignment candidates. Returns null
// when the order is missing OR not in SUBMITTED (so the UI can bounce
// back to the list). Scope check: `order:schedule` permission is
// already ADMIN-only — no per-order ownership to apply.
export async function getSchedulingView(
  orderId: string,
): Promise<SchedulingView | null> {
  const order = await db.order.findFirst({
    where: { id: orderId, status: OrderStatus.SUBMITTED },
    select: {
      id: true,
      orderNo: true,
      customName: true,
      isUrgent: true,
      customerRef: true,
      submitter: { select: { displayName: true } },
      items: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          name: true,
          quantity: true,
          specification: true,
          paperType: true,
          foilColors: true,
          remark: true,
          crafts: true,
          tasks: {
            where: { status: TaskStatus.PENDING },
            select: { craftId: true, workerId: true },
          },
        },
      },
    },
  });
  if (!order) return null;

  const allCraftIds = new Set<string>();
  for (const item of order.items) for (const cid of item.crafts) allCraftIds.add(cid);
  const crafts =
    allCraftIds.size === 0
      ? []
      : await db.craft.findMany({
          where: { id: { in: [...allCraftIds] } },
          select: {
            id: true,
            name: true,
            isOutsource: true,
            defaultWorkerType: true,
            defaultMachineType: true,
            inHouseMachineTypes: true,
          },
        });
  const craftById = new Map(crafts.map((c) => [c.id, c]));

  const workers = await listActiveWorkerCandidates();

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    customName: order.customName,
    isUrgent: order.isUrgent,
    customerRef: order.customerRef,
    submitterDisplayName: order.submitter.displayName,
    items: order.items.map((item) => {
      const assignedWorkerByCraft = new Map(
        item.tasks.map((task) => [task.craftId, task.workerId]),
      );
      return {
        id: item.id,
        sequence: item.sequence,
        name: item.name,
        quantity: item.quantity,
        specification: item.specification,
        paperType: item.paperType,
        foilColors: item.foilColors,
        remark: item.remark,
        crafts: item.crafts
          .map((cid) => {
            const craft = craftById.get(cid);
            return craft
              ? {
                  ...craft,
                  assignedWorkerId:
                    assignedWorkerByCraft.get(cid) ?? null,
                }
              : undefined;
          })
          .filter(
            (craft): craft is SchedulingViewCraft =>
              typeof craft !== 'undefined',
          ),
      };
    }),
    workers,
  };
}

export type ReassignmentView = {
  tasks: Array<{
    id: string;
    itemName: string;
    itemSequence: number;
    craftName: string;
    craftId: string;
    currentWorkerId: string | null;
    currentWorkerName: string | null;
    eligibleWorkers: SchedulingViewCandidate[];
  }>;
};

export async function getPendingTaskReassignmentView(
  orderId: string,
): Promise<ReassignmentView> {
  const [tasks, workers] = await Promise.all([
    db.productionTask.findMany({
      where: {
        orderItem: { orderId },
        status: TaskStatus.PENDING,
      },
      select: {
        id: true,
        workerId: true,
        orderItem: { select: { name: true, sequence: true } },
        craft: {
          select: {
            name: true,
            id: true,
            defaultWorkerType: true,
            defaultMachineType: true,
            inHouseMachineTypes: true,
          },
        },
        worker: { select: { displayName: true } },
      },
      orderBy: [
        { orderItem: { sequence: 'asc' } },
        { craft: { sortOrder: 'asc' } },
      ],
    }),
    listActiveWorkerCandidates(),
  ]);

  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      itemName: task.orderItem.name,
      itemSequence: task.orderItem.sequence,
      craftName: task.craft.name,
      craftId: task.craft.id,
      currentWorkerId: task.workerId,
      currentWorkerName: task.worker?.displayName ?? null,
      eligibleWorkers: workers.filter((worker) =>
        isWorkerCompatible(
          {
            id: task.craft.id,
            isOutsource: false,
            defaultWorkerType: task.craft.defaultWorkerType,
            defaultMachineType: task.craft.defaultMachineType,
            inHouseMachineTypes: task.craft.inHouseMachineTypes,
          },
          worker,
        ),
      ),
    })),
  };
}

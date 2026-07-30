import {
  OrderStatus,
  Role,
  TaskStatus,
  MachineType,
  OutsourceStatus,
  WorkerType,
  DesignFileType,
} from '../generated/prisma/enums';
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
import { calcMachinePieceworkBreakdown } from './salary/machine-piecework';
import { getActiveMachineRule } from './salary/rules';
import { dispatchNotification } from './notification/dispatch';
import {
  maybeCompleteProductionOrder,
  type ProductionCompletionTx,
} from './production-completion';

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
      }>
    >;
  };
  productionTask: {
    createMany: (args: {
      data: unknown[];
    }) => Promise<{ count: number }>;
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: TaskStatus }>>;
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
      if (!c.isOutsource) {
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
          continue;
        }
        expectedKeys.add(`${item.id}:${cid}`);
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
          `款式 ${a.orderItemId} 没有需要排产的工艺 ${a.craftId}（或该工艺为外协）`,
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
      assertWorkerCompatible(
        craftById.get(assignment.craftId)!,
        workerById.get(assignment.workerId)!,
      );
    }

    // createMany is a single round trip — we assemble the full list
    // here rather than looping create() so a 50-item order doesn't
    // fan out to 50 round trips.
    const taskRows = input.assignments.map((a) => {
      const craft = craftById.get(a.craftId)!;
      return {
        orderItemId: a.orderItemId,
        craftId: a.craftId,
        workerId: a.workerId,
        workerType: craft.defaultWorkerType,
        // Snapshot the machine type at assign time. If we change
        // craft.defaultMachineType later, in-flight tasks keep their
        // original type — same principle as salaryRuleSnapshot.
        machineType: craft.defaultMachineType,
        status: TaskStatus.PENDING,
        plannedQty: itemQuantityById.get(a.orderItemId)!,
      };
    });
    const inserted = await txClient.productionTask.createMany({ data: taskRows });

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
    await txClient.orderLog.create({
      data: {
        orderId: order.id,
        operatorId: actor.id,
        action: 'STATUS_CHANGE',
        changedFields: {
          status: { before: order.status, after: OrderStatus.SCHEDULING },
        },
        remark: `排产：派工 ${inserted.count} 个任务${
          skippedOutsourceCrafts > 0 ? `（外协工艺 ${skippedOutsourceCrafts} 项另行处理）` : ''
        }`,
      },
    });

    const orderCompleted =
      inserted.count === 0 && skippedOutsourceCrafts > 0
        ? await maybeCompleteProductionOrder(
            txClient as unknown as ProductionCompletionTx,
            order.id,
            actor.id,
            new Date(),
          )
        : false;

    return {
      orderId: updated.id,
      status: orderCompleted ? OrderStatus.COMPLETED : updated.status,
      tasksCreated: inserted.count,
      skippedOutsourceCrafts,
      orderCompleted,
    };
  });

  // Slice C wire ─ ORDER_SCHEDULED（tx 已 commit；生产入持久化队列）。
  const payload = await db.order.findUnique({
    where: { id: result.orderId },
    select: { orderNo: true, customerRef: true },
  });
  if (payload) {
    await dispatchNotification(
      'ORDER_SCHEDULED',
      {
        orderId: result.orderId,
        orderNo: payload.orderNo,
        taskCount: result.tasksCreated,
      },
      { dedupeKey: `notification:ORDER_SCHEDULED:${result.orderId}` },
    );
    if (result.orderCompleted) {
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
};

type AssignmentWorker = {
  id: string;
  workerType: WorkerType | null;
  machineType: MachineType | null;
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
    !craft.defaultMachineType
  ) {
    throw new SchedulingError(
      `工艺 ${craft.id} 是开机工艺但未配置机型`,
    );
  }
}

function assertWorkerCompatible(
  craft: AssignmentCraft,
  worker: AssignmentWorker,
): void {
  assertCraftAssignmentConfigured(craft);
  if (worker.workerType !== craft.defaultWorkerType) {
    throw new SchedulingError(
      `师傅 ${worker.id} 的岗位与工艺 ${craft.id} 不匹配`,
    );
  }
  if (
    craft.defaultWorkerType === WorkerType.MACHINE &&
    worker.machineType !== craft.defaultMachineType
  ) {
    throw new SchedulingError(
      `师傅 ${worker.id} 的机型与工艺 ${craft.id} 不匹配`,
    );
  }
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
      },
    });
    if (!worker || worker.role !== Role.WORKER) {
      throw new ReportError('目标师傅不存在');
    }
    if (!worker.isActive) throw new ReportError('目标师傅已停用');
    try {
      assertWorkerCompatible(task.craft, worker);
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
        machineType: task.craft.defaultMachineType,
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
        },
        remark: `改派：${task.orderItem.name} (#${task.orderItem.sequence}) → ${worker.displayName}`,
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
        assignedWorker.machineType !== task.machineType)
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
      const rule = await getActiveMachineRule(
        task.machineType,
        now,
        task.workerId ?? undefined,
      );
      if (!rule) {
        throw new ReportError(
          `无当前生效的 ${task.machineType} 薪资规则，请联系管理员补规则后再报工`,
        );
      }
      const totalPressed =
        input.completedQty + input.defectQty + input.reworkQty;
      const breakdown = calcMachinePieceworkBreakdown(
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
      },
      select: { id: true, status: true },
    });

    // Cascade-to-COMPLETED gate: all non-CANCELLED tasks for this
    // order must be COMPLETED. Acquire cascade lock and re-read the
    // sibling statuses inside the lock.
    const { order } = task.orderItem;
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      order.id,
    )}))`;

    const orderCompleted = await maybeCompleteProductionOrder(
      txClient as unknown as ProductionCompletionTx,
      order.id,
      actor.id,
      now,
    );

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
  if (result.orderCompleted) {
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
              isUrgent: true,
            },
          },
        },
      },
      craft: { select: { name: true } },
    },
    orderBy: [
      { orderItem: { order: { isUrgent: 'desc' } } },
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
    },
  }));
}

// Single task detail for the worker report page. Scope guard: only
// the assigned worker (or ADMIN) can read the record.
export async function getWorkerTaskDetail(
  taskId: string,
  actor: { id: string; role: Role },
) {
  const row = await db.productionTask.findUnique({
    where: { id: taskId },
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
            },
          },
        },
      },
      craft: { select: { name: true } },
    },
  });
  if (!row) return null;
  const globalOverride = actor.role === Role.ADMIN;
  if (!globalOverride && row.workerId !== actor.id) return null;
  return row;
}

export { InvalidTaskTransitionError };

// ─────────────────────────────────────────────────────────────────────
// Read helpers for the scheduling UI
// ─────────────────────────────────────────────────────────────────────

// All SUBMITTED orders awaiting scheduling. Foremen see everything
// (no scope filter) — matches `order:schedule` permission's "no
// ownership" posture.
export async function listPendingSchedulingOrders() {
  return db.order.findMany({
    where: { status: OrderStatus.SUBMITTED, items: { some: {} } },
    select: {
      id: true,
      orderNo: true,
      customName: true,
      isUrgent: true,
      customerRef: true,
      promisedDate: true,
      submittedAt: true,
      createdAt: true,
      items: {
        select: { id: true, crafts: true },
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
}

export type SchedulingViewCraft = {
  id: string;
  name: string;
  isOutsource: boolean;
  defaultWorkerType: WorkerType | null;
  defaultMachineType: MachineType | null;
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
  return workers.map((worker) => ({
    ...worker,
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
    items: order.items.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      name: item.name,
      quantity: item.quantity,
      specification: item.specification,
      paperType: item.paperType,
      foilColors: item.foilColors,
      remark: item.remark,
      crafts: item.crafts
        .map((cid) => craftById.get(cid))
        .filter((c): c is SchedulingViewCraft => typeof c !== 'undefined'),
    })),
    workers,
  };
}

export type ReassignmentView = {
  tasks: Array<{
    id: string;
    itemName: string;
    itemSequence: number;
    craftName: string;
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
            defaultWorkerType: true,
            defaultMachineType: true,
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
      currentWorkerId: task.workerId,
      currentWorkerName: task.worker?.displayName ?? null,
      eligibleWorkers: workers.filter(
        (worker) =>
          worker.workerType === task.craft.defaultWorkerType &&
          (task.craft.defaultWorkerType !== WorkerType.MACHINE ||
            worker.machineType === task.craft.defaultMachineType),
      ),
    })),
  };
}

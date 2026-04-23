import {
  OrderStatus,
  Role,
  TaskStatus,
  MachineType,
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
import { calcMachinePieceworkBreakdown } from './salary/machine-piecework';
import { getActiveMachineRule } from './salary/rules';

// Thrown when a scheduling request violates the allowlist contract
// (duplicate / missing / unknown craft-item pairs, bad worker, etc.).
// Action layer maps to { status: 'error', message }.
export class SchedulingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulingError';
  }
}

// Advisory-lock namespace for the scheduling serialization guard.
// Same `print-shop-erp:<domain>:<invariant>` convention we use in
// lib/account.ts (OWNER count) and lib/order/order-number.ts
// (per-day serial).
function scheduleLockKey(orderId: string): string {
  return `print-shop-erp:schedule:order:${orderId}`;
}

// Minimal tx surface we need — kept narrow so a typed Prisma client
// upgrade doesn't explode the function signature (same pattern as
// lib/order.ts's OrderTxClient).
type ScheduleTxClient = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
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
        defaultMachineType: string | null;
      }>
    >;
  };
  user: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      Array<{ id: string; role: Role; isActive: boolean; machineType: string | null }>
    >;
  };
  productionTask: {
    createMany: (args: {
      data: unknown[];
    }) => Promise<{ count: number }>;
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
// Outsource-only orders succeed with zero tasks and still transition
// to SCHEDULING — Slice C will add the outsource-readiness gate.
export async function scheduleOrder(
  input: ScheduleOrderInput,
  actor: { id: string; role: Role },
): Promise<ScheduleOrderResult> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as ScheduleTxClient;

    // Serialize concurrent scheduling attempts on the same order.
    // Without this, two foremen clicking 排产 at the same moment can
    // both observe SUBMITTED, both pass the status-machine check, and
    // both createMany — producing duplicate ProductionTask rows and
    // two STATUS_CHANGE log entries. Lock is per-tx so the second
    // transaction blocks here and then sees SCHEDULING on its own
    // read, tripping transitionOrder's guard (Codex round 37 / P0).
    await txClient.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${scheduleLockKey(
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
      select: { id: true, role: true, isActive: true, machineType: true },
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

    // createMany is a single round trip — we assemble the full list
    // here rather than looping create() so a 50-item order doesn't
    // fan out to 50 round trips.
    const taskRows = input.assignments.map((a) => {
      const craft = craftById.get(a.craftId)!;
      return {
        orderItemId: a.orderItemId,
        craftId: a.craftId,
        workerId: a.workerId,
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
      data: { status: OrderStatus.SCHEDULING, scheduledAt: new Date() },
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

    return {
      orderId: updated.id,
      status: updated.status,
      tasksCreated: inserted.count,
      skippedOutsourceCrafts,
    };
  });
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

// Tx surface for begin/report. Same narrow-on-purpose style as the
// scheduling helper.
type TaskTxClient = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  productionTask: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<
      | {
          id: string;
          status: TaskStatus;
          workerId: string | null;
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
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<{
      id: string;
      status: OrderStatus;
    }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

// Advisory-lock helpers for the two cross-row invariants in this flow.
function taskLockKey(taskId: string): string {
  return `print-shop-erp:task:${taskId}`;
}
function orderCascadeLockKey(orderId: string): string {
  // Order-status cascade reads sibling task statuses, so any two
  // workers reporting at the same instant on the same order must
  // serialize through this lock. Distinct from the scheduling lock
  // (same order may hold both at different tx boundaries).
  return `print-shop-erp:order-cascade:${orderId}`;
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

    await txClient.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${taskLockKey(taskId)}))`;

    const task = await txClient.productionTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workerId: true,
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

    const globalOverride = actor.role === Role.OWNER || actor.role === Role.FOREMAN;
    if (!globalOverride && task.workerId !== actor.id) {
      throw new ReportError('只能开始分配给自己的任务');
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

    // Cascade Order SCHEDULING → IN_PRODUCTION on first task pickup.
    // SPEC §3.2 implies this transition when production actually
    // starts. Guard with a second advisory lock so two workers
    // clicking "开始" simultaneously on two different tasks of the
    // same order don't both try to transition (which the status
    // machine would catch, but the lock avoids the wasted round trip).
    let orderStatusChanged = false;
    const { order } = task.orderItem;
    if (order.status === OrderStatus.SCHEDULING) {
      await txClient.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
        order.id,
      )}))`;
      transitionOrder(order.status, OrderStatus.IN_PRODUCTION);
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
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as TaskTxClient;

    await txClient.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${taskLockKey(taskId)}))`;

    const task = await txClient.productionTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workerId: true,
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

    const globalOverride = actor.role === Role.OWNER || actor.role === Role.FOREMAN;
    if (!globalOverride && task.workerId !== actor.id) {
      throw new ReportError('只能报工分配给自己的任务');
    }

    if (!task.machineType) {
      // MVP: ProductionTask without a machineType = not a machine
      // worker flow (PACKER / CLEANER tasks are outside P0 #4 scope).
      throw new ReportError('此任务无机型，不支持计件报工');
    }

    transitionProductionTask(task.status, TaskStatus.COMPLETED);

    const rule = await getActiveMachineRule(task.machineType, now);
    if (!rule) {
      throw new ReportError(
        `无当前生效的 ${task.machineType} 薪资规则，请联系老板补规则后再报工`,
      );
    }

    // Effective pressed = completed + defect + rework. Each defective
    // / reworked piece still consumed a press, so the worker is paid
    // for total activity, not just the good output.
    const totalPressed =
      input.completedQty + input.defectQty + input.reworkQty;

    const breakdown = calcMachinePieceworkBreakdown(
      {
        quantity: totalPressed,
        itemCount: 1, // one ProductionTask ↔ one OrderItem in MVP
        isDoubleSided: task.orderItem.isDoubleSided,
        isDoubleColor: task.orderItem.isDoubleColor,
      },
      rule,
    );

    await txClient.productionTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.COMPLETED,
        completedQty: input.completedQty,
        defectQty: input.defectQty,
        reworkQty: input.reworkQty,
        boardCount: breakdown.boardCount,
        pressCount: breakdown.pressCount,
        pieceworkAmount: breakdown.amount.toFixed(2),
        salaryRuleSnapshot: rule as unknown as Record<string, unknown>,
        completedAt: now,
      },
      select: { id: true, status: true },
    });

    // Cascade-to-COMPLETED gate: all non-CANCELLED tasks for this
    // order must be COMPLETED. Acquire cascade lock and re-read the
    // sibling statuses inside the lock.
    const { order } = task.orderItem;
    await txClient.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      order.id,
    )}))`;

    const siblings = await txClient.productionTask.findMany({
      where: { orderItem: { orderId: order.id } },
      select: { id: true, status: true },
    });
    const activeSiblings = siblings.filter(
      (t) => t.status !== TaskStatus.CANCELLED,
    );
    // All tasks (including this one) must now be COMPLETED. The just-
    // updated task is in the list already because the read happens
    // after the update in the same tx.
    const allCompleted =
      activeSiblings.length > 0 &&
      activeSiblings.every((t) => t.status === TaskStatus.COMPLETED);

    let orderCompleted = false;
    if (allCompleted && order.status === OrderStatus.IN_PRODUCTION) {
      transitionOrder(order.status, OrderStatus.COMPLETED);
      await txClient.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.COMPLETED, completedAt: now },
        select: { id: true, status: true },
      });
      await txClient.orderLog.create({
        data: {
          orderId: order.id,
          operatorId: actor.id,
          action: 'STATUS_CHANGE',
          changedFields: {
            status: {
              before: OrderStatus.IN_PRODUCTION,
              after: OrderStatus.COMPLETED,
            },
          },
          remark: '全部任务完工',
        },
      });
      orderCompleted = true;
    }

    return {
      taskId: task.id,
      status: TaskStatus.COMPLETED,
      pieceworkAmount: breakdown.amount.toFixed(2),
      boardCount: breakdown.boardCount,
      pressCount: breakdown.pressCount,
      orderCompleted,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Worker-side read helpers
// ─────────────────────────────────────────────────────────────────────

export type WorkerTaskListRow = {
  id: string;
  status: TaskStatus;
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
  order: { id: string; orderNo: string; isUrgent: boolean };
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
            select: { id: true, orderNo: true, isUrgent: true },
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
      isUrgent: r.orderItem.order.isUrgent,
    },
  }));
}

// Single task detail for the worker report page. Scope guard: only
// the assigned worker (or OWNER/FOREMAN) can read the record.
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
          isDoubleSided: true,
          isDoubleColor: true,
          order: {
            select: {
              id: true,
              orderNo: true,
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
  const globalOverride = actor.role === Role.OWNER || actor.role === Role.FOREMAN;
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
    where: { status: OrderStatus.SUBMITTED },
    select: {
      id: true,
      orderNo: true,
      isUrgent: true,
      customerRef: true,
      submittedAt: true,
      createdAt: true,
      items: {
        select: { id: true, crafts: true },
      },
      submitter: {
        select: { displayName: true, role: true },
      },
    },
    orderBy: [{ isUrgent: 'desc' }, { submittedAt: 'asc' }],
  });
}

export type SchedulingViewCraft = {
  id: string;
  name: string;
  isOutsource: boolean;
  defaultMachineType: MachineType | null;
};

export type SchedulingViewItem = {
  id: string;
  sequence: number;
  name: string;
  quantity: number;
  specification: string | null;
  paperType: string | null;
  crafts: SchedulingViewCraft[];
};

export type SchedulingViewCandidate = {
  id: string;
  displayName: string;
  machineType: MachineType | null;
};

export type SchedulingView = {
  orderId: string;
  orderNo: string;
  isUrgent: boolean;
  customerRef: string | null;
  submitterDisplayName: string;
  items: SchedulingViewItem[];
  workers: SchedulingViewCandidate[];
};

// Assembles the view-model the scheduling form needs: the order's items
// + their crafts resolved to names + isOutsource + machineType, plus
// the list of active WORKERs as assignment candidates. Returns null
// when the order is missing OR not in SUBMITTED (so the UI can bounce
// back to the list). Scope check: `order:schedule` permission is
// already FOREMAN+OWNER only — no per-order ownership to apply.
export async function getSchedulingView(
  orderId: string,
): Promise<SchedulingView | null> {
  const order = await db.order.findFirst({
    where: { id: orderId, status: OrderStatus.SUBMITTED },
    select: {
      id: true,
      orderNo: true,
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
            defaultMachineType: true,
          },
        });
  const craftById = new Map(crafts.map((c) => [c.id, c]));

  const workers = await db.user.findMany({
    where: { role: Role.WORKER, isActive: true },
    select: { id: true, displayName: true, machineType: true },
    orderBy: { displayName: 'asc' },
  });

  return {
    orderId: order.id,
    orderNo: order.orderNo,
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
      crafts: item.crafts
        .map((cid) => craftById.get(cid))
        .filter((c): c is SchedulingViewCraft => typeof c !== 'undefined'),
    })),
    workers,
  };
}

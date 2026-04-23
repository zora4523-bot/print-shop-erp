import { OrderStatus, Role, TaskStatus } from '../generated/prisma/enums';
import { db } from './db';
import { transitionOrder } from './order/status-machine';
import { OrderInvariantError } from './order';
import type { ScheduleOrderInput } from './auth/schemas';

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
      if (!craftById.has(cid)) {
        throw new SchedulingError(`工艺不存在：${cid}`);
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

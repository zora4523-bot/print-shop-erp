import Decimal from 'decimal.js';
import {
  OrderStatus,
  OutsourceStatus,
  PartyType,
  Prisma,
  Role,
  TaskStatus,
} from '../generated/prisma/client';
import { db } from './db';
import { nextOrderNumber } from './order/order-number';
import {
  transitionOrder,
  InvalidOrderTransitionError,
} from './order/status-machine';
import { transitionProductionTask } from './production/status-machine';
import type {
  CreateOrderInput,
  UpdateEditableOrderInput,
  UpdateShippingOrderInput,
} from './auth/schemas';
import { getOrderScopeFilter } from './auth/order-scope';
import { orderCascadeLockKey } from './order/locks';
import {
  FULL_EDITABLE_FIELDS,
  SHIPPING_EDITABLE_FIELDS,
  editableFieldsetForStatus,
} from './order/editable-fields';
import { dispatchNotification } from './notification/dispatch';
import { formatMoneyPlain } from './dashboard/format';
import { sortBySearchRelevance } from './search-ranking';

export class OrderInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderInvariantError';
  }
}

// Minimum TxClient surface the order module needs. Kept local so we don't
// import from lib/account.ts (different table surface).
type OrderTxClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  order: {
    create: (args: { data: unknown; select?: unknown }) => Promise<{ id: string; orderNo: string }>;
    findFirst: (args: {
      where: unknown;
      orderBy?: unknown;
      select?: unknown;
    }) => Promise<{ orderNo: string } | null>;
  };
  craft: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string }>>;
  };
  product: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; isActive: boolean }>>;
  };
  party: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{ id: string; type: PartyType; isActive: boolean } | null>;
  };
};

// Decimal(12,2) column — 12 total digits, 2 after the point. Quantity is
// an int and unitPrice is a string like '0.1234'. The multiplication must
// happen in Decimal.js to preserve precision (plain JS floats round).
function computeSubtotal(quantity: number, unitPrice: string | null): string {
  const price = new Decimal(unitPrice ?? '0');
  return price.times(quantity).toFixed(2);
}

function sumTotals(subtotals: string[]): string {
  return subtotals
    .reduce((acc, s) => acc.plus(new Decimal(s)), new Decimal(0))
    .toFixed(2);
}

export type CreatedOrderSummary = {
  id: string;
  orderNo: string;
};

// The transaction path:
//   1. advisory-lock the per-day order-seq (inside nextOrderNumber)
//   2. verify every referenced Craft exists + is active
//   3. verify the optional productId (if any) exists + is active
//   4. compute subtotals + totalAmount in Decimal.js
//   5. nested-create Order + items + initial OrderLog("CREATE") in one call
export async function createOrder(
  input: CreateOrderInput,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<CreatedOrderSummary> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as OrderTxClient;

    // (1) allocate a fresh YYYYMMDD-XXXX (advisory lock inside).
    const orderNo = await nextOrderNumber(txClient, now);

    // (2) craft FK + activation check — surfaces a clean invariant error
    // instead of a Prisma FK error.
    const craftIds = [...new Set(input.items.flatMap((it) => it.crafts))];
    const foundCrafts = await txClient.craft.findMany({
      where: { id: { in: craftIds }, isActive: true },
      select: { id: true },
    });
    if (foundCrafts.length !== craftIds.length) {
      const missing = craftIds.filter((id) => !foundCrafts.some((c) => c.id === id));
      throw new OrderInvariantError(
        `工艺不存在或已停用：${missing.join(', ')}`,
      );
    }

    if (input.customerPartyId) {
      const party = await txClient.party.findUnique({
        where: { id: input.customerPartyId },
        select: { id: true, type: true, isActive: true },
      });
      if (!party) {
        throw new OrderInvariantError(`客户主数据不存在：${input.customerPartyId}`);
      }
      if (!party.isActive) {
        throw new OrderInvariantError(`客户主数据已停用：${input.customerPartyId}`);
      }
      if (party.type === PartyType.SUPPLIER) {
        throw new OrderInvariantError(`供应商不能作为工单客户：${input.customerPartyId}`);
      }
    }

    // (3) product FK check — one batch findMany over the distinct ids
    // (was per-item findUnique: a 10-item order paid up to 10 round
    // trips inside the tx). No productId → no query at all. Deliberately
    // NOT filtering isActive in the where: 不存在 and 已停用 are two
    // distinct messages, and the per-item loop keeps first-error order.
    const productIds = [
      ...new Set(
        input.items.flatMap((it) => (it.productId ? [it.productId] : [])),
      ),
    ];
    if (productIds.length > 0) {
      const foundProducts = await txClient.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, isActive: true },
      });
      const productById = new Map(foundProducts.map((p) => [p.id, p]));
      for (const item of input.items) {
        if (!item.productId) continue;
        const product = productById.get(item.productId);
        if (!product) {
          throw new OrderInvariantError(`产品不存在：${item.productId}`);
        }
        if (!product.isActive) {
          throw new OrderInvariantError(`产品已停用：${item.productId}`);
        }
      }
    }

    // (4) totals.
    const itemsWithSubtotals = input.items.map((it) => ({
      ...it,
      subtotal: computeSubtotal(it.quantity, it.unitPrice),
    }));
    const totalAmount = sumTotals(itemsWithSubtotals.map((i) => i.subtotal));

    // (5) one nested write: Order + items + first OrderLog.
    const created = await txClient.order.create({
      data: {
        orderNo,
        submitterId: actor.id,
        submitterRole: actor.role,
        createdById: actor.id,
        customerPartyId: input.customerPartyId ?? null,
        status: OrderStatus.DRAFT,
        isUrgent: input.isUrgent,
        customerRef: input.customerRef,
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        receiverAddress: input.receiverAddress,
        expressCode: input.expressCode,
        packageRequirement: input.packageRequirement,
        remark: input.remark,
        promisedDate: input.promisedDate ?? null,
        totalAmount,
        items: {
          create: itemsWithSubtotals.map((it, idx) => ({
            sequence: idx + 1,
            name: it.name,
            productId: it.productId ?? null,
            specification: it.specification ?? null,
            paperType: it.paperType ?? null,
            quantity: it.quantity,
            crafts: it.crafts,
            foilColor: it.foilColor ?? null,
            isDoubleSided: it.isDoubleSided,
            isDoubleColor: it.isDoubleColor,
            unitPrice: it.unitPrice ?? '0',
            subtotal: it.subtotal,
            suggestedPrice: it.suggestedPrice,
            remark: it.remark ?? null,
          })),
        },
        logs: {
          create: [
            {
              operatorId: actor.id,
              action: 'CREATE',
              remark: input.isUrgent ? '创建急单' : '创建工单',
            },
          ],
        },
      },
      select: { id: true, orderNo: true },
    });

    return created;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────

// Minimal tx surface for status-transition operations (no craft / product
// cross-table work, unlike create).
type StatusTxClient = {
  $executeRaw: (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
  order: {
    findUnique: (args: {
      where: { id: string };
      select?: unknown;
    }) => Promise<{ id: string; status: OrderStatus; submitterId: string } | null>;
    update: (args: { where: { id: string }; data: unknown; select?: unknown }) => Promise<{
      id: string;
      status: OrderStatus;
    }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

// Minimal tx surface for the cancelOrder → ProductionTask cascade
// (A1, DECISIONS 2026-07-09). Runs on the SAME tx as the order
// transition, so the task reads/writes participate in the same
// advisory lock + rollback boundary — no half-cancel possible.
type CascadeTxClient = {
  productionTask: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string; status: TaskStatus }>>;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<unknown>;
  };
  outsourceOrder: {
    findMany: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<Array<{ id: string }>>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

// Per-order advisory lock for status-transition writes. We share the
// SAME namespace as production.ts orderCascadeLockKey
// (`print-shop-erp:order-cascade:<id>`) so worker reportTask's
// auto-cascade can't race a manual ship/cancel/submit on the same
// order — both paths touch Order.status .

type TransitionOptions = {
  remark: string | null;
  // Optional authz guard that runs AFTER we've fetched the row (so it
  // can see submitterId / status) but BEFORE the status-machine check.
  // Throw OrderInvariantError to reject.
  authz?: (order: { submitterId: string; status: OrderStatus }) => void;
  now?: Date;
  // Optional extra columns to set on the Order in the same update.
  // Used by shipOrder to stamp `trackingNo` alongside the status
  // transition. Each call site is responsible for keeping the keys
  // valid Prisma update fields.
  extraData?: Record<string, unknown>;
  // Optional cascade to related rows, run INSIDE the same tx + advisory
  // lock, AFTER the Order row + OrderLog are written. Throwing here
  // rolls the whole transition back (so a block condition leaves no
  // half-cancel). Used by cancelOrder to void PENDING ProductionTasks.
  cascade?: (tx: CascadeTxClient, orderId: string) => Promise<void>;
};

async function transitionWithLog(
  orderId: string,
  target: OrderStatus,
  actor: { id: string; role: Role },
  opts: TransitionOptions,
): Promise<{ id: string; status: OrderStatus }> {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as StatusTxClient;
    // Per-order advisory lock: serialize ALL transitions on this
    // order. Without this, two concurrent ship calls each read
    // status=COMPLETED, both pass the status-machine check, both
    // updates succeed — second silently overwrites trackingNo and
    // doubles the OrderLog row . Same key as
    // worker-cascade so a manual transition can't interleave with
    // a sibling task report's auto-cascade either.
    await txClient.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderCascadeLockKey(
      orderId,
    )}))`;

    const target_order = await txClient.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, submitterId: true },
    });
    if (!target_order) throw new OrderInvariantError('工单不存在');

    if (opts.authz) opts.authz(target_order);

    // status-machine.ts throws InvalidOrderTransitionError on bad moves —
    // we let it propagate (action layer maps to a generic error result).
    transitionOrder(target_order.status, target);

    // Cascade to related rows BEFORE writing the Order row, so a block
    // condition (cancelOrder → an in-flight ProductionTask) throws before
    // anything is written — no half-cancel, in the DB or under test.
    if (opts.cascade) {
      await opts.cascade(tx as unknown as CascadeTxClient, orderId);
    }

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: {
        status: target,
        submittedAt: target === OrderStatus.SUBMITTED ? now : undefined,
        shippedAt: target === OrderStatus.SHIPPED ? now : undefined,
        finishedAt: target === OrderStatus.FINISHED ? now : undefined,
        // trackingNo flows through opts.extraData below if provided
        // (ship action sets it; other transitions don't touch it).
        ...(opts.extraData ?? {}),
      },
      select: { id: true, status: true },
    });

    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'STATUS_CHANGE',
        changedFields: {
          status: { before: target_order.status, after: target },
        },
        remark: opts.remark,
      },
    });

    return updated;
  });
}

export async function submitOrder(
  orderId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  const result = await transitionWithLog(orderId, OrderStatus.SUBMITTED, actor, {
    remark: '提交工单',
    now,
    authz: (order) => {
      // 'order:create' permission lets SALES / CS create AND submit — but
      // only for their own rows. OWNER / FOREMAN keep the global override.
      const globalOverride = actor.role === Role.OWNER || actor.role === Role.FOREMAN;
      if (!globalOverride && order.submitterId !== actor.id) {
        throw new OrderInvariantError('只能提交自己创建的工单');
      }
    },
  });

  // Slice C wire ─ ORDER_SUBMITTED + URGENT_ORDER（tx 已 commit）。
  // 生产只 await 快速入库，webhook 由 LIGHT worker 重试；dev/test
  // 降级到 Next `after()`。详见 lib/notification/dispatch.ts。
  const payload = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      customerRef: true,
      totalAmount: true,
      isUrgent: true,
      submitter: { select: { displayName: true } },
    },
  });
  if (payload) {
    // formatMoneyPlain：千分位 + 2 位小数，**不带 `¥ ` 前缀**。模板里
    // 的 `金额：¥{totalAmount}` 自带 ¥ —— 再加会变成 `¥¥ 5,000.00`。
    const totalAmount = formatMoneyPlain(
      payload.totalAmount as unknown as Decimal.Value,
    );
    const urgentMark = payload.isUrgent ? '🚨 急单' : '';
    await dispatchNotification(
      'ORDER_SUBMITTED',
      {
        orderId: payload.id,
        orderNo: payload.orderNo,
        submitterName: payload.submitter.displayName,
        customerRef: payload.customerRef,
        totalAmount,
        urgentMark,
      },
      { dedupeKey: `notification:ORDER_SUBMITTED:${payload.id}` },
    );
    // SPEC §8.1：急单提交 → 排产群+老板群（独立 rule，独立事件）。
    // 不是&ldquo;替代&rdquo; ORDER_SUBMITTED——两条都触发，老板群从 URGENT_ORDER
    // 看到，排产群从 ORDER_SUBMITTED 看到。
    if (payload.isUrgent) {
      await dispatchNotification(
        'URGENT_ORDER',
        {
          orderId: payload.id,
          orderNo: payload.orderNo,
          submitterName: payload.submitter.displayName,
          customerRef: payload.customerRef,
        },
        { dedupeKey: `notification:URGENT_ORDER:${payload.id}` },
      );
    }
  }

  return result;
}

export async function cancelOrder(
  orderId: string,
  actor: { id: string; role: Role },
  reason: string | null,
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  // The action-layer `requirePermission('order:cancel')` is OWNER-only, so
  // there's no additional ownership guard to run here.
  return transitionWithLog(orderId, OrderStatus.CANCELLED, actor, {
    remark: reason ? `取消：${reason}` : '取消工单',
    now,
    // A1 (owner ruling, DECISIONS 2026-07-09): cancelling an order must
    // dispose of its ProductionTasks in the SAME tx — otherwise cancelled
    // orders leave live tasks the worker can still begin/report on and
    // get paid for.
    cascade: async (tx, id) => {
      const tasks = await tx.productionTask.findMany({
        where: { orderItem: { orderId: id } },
        select: { id: true, status: true },
      });

      // Block if ANY task is already in-flight or finished. We refuse to
      // silently reverse piecework/payroll — the operator must handle the
      // production records first. This covers 已开工(IN_PROGRESS) /
      // 已报工·已完成·已产生计件金额·已结算(COMPLETED).
      const hasInFlight = tasks.some(
        (t) =>
          t.status === TaskStatus.IN_PROGRESS ||
          t.status === TaskStatus.COMPLETED,
      );
      if (hasInFlight) {
        throw new OrderInvariantError(
          '该工单存在已开工/已报工任务，不能直接取消，请先处理生产记录',
        );
      }

      // A1-A2 (owner ruling, DECISIONS 2026-07-09): if any linked
      // outsource order is still in flight (SENT / IN_PROGRESS), block
      // the cancel. We deliberately do NOT auto-cancel these —
      // supplier fulfillment / cost / manual confirmation is involved;
      // the operator must handle the outsource order first. RECEIVED /
      // CANCELLED outsource orders don't block. There is no
      // draft/未发送 OutsourceStatus (they default to SENT on create),
      // so there is nothing safe to cascade here — block only.
      const liveOutsource = await tx.outsourceOrder.findMany({
        where: {
          orderId: id,
          status: {
            in: [OutsourceStatus.SENT, OutsourceStatus.IN_PROGRESS],
          },
        },
        select: { id: true },
      });
      if (liveOutsource.length > 0) {
        throw new OrderInvariantError(
          '该工单存在已发送或进行中的外协单，请先处理外协单后再取消工单。',
        );
      }

      // Only 未开工 (PENDING) tasks are safe to void. Already-CANCELLED
      // tasks are left as-is (idempotent re-cancel / partial history).
      const pending = tasks.filter((t) => t.status === TaskStatus.PENDING);
      for (const t of pending) {
        // Route through the status machine so PENDING → CANCELLED stays
        // the single source of transition truth (CLAUDE.md §4.5).
        transitionProductionTask(t.status, TaskStatus.CANCELLED);
        await tx.productionTask.update({
          where: { id: t.id },
          data: { status: TaskStatus.CANCELLED },
          select: { id: true },
        });
      }
      if (pending.length > 0) {
        await tx.orderLog.create({
          data: {
            orderId: id,
            operatorId: actor.id,
            action: 'STATUS_CHANGE',
            changedFields: {
              cancelledTasks: { before: pending.length, after: 0 },
            },
            remark: `随工单取消 ${pending.length} 个未开工任务`,
          },
        });
      }
    },
  });
}

// COMPLETED → SHIPPED. Permission `order:ship` (OWNER + FOREMAN) is
// enforced at the action layer. Optional trackingNo lands on the same
// Order row via the transition's extraData so the audit OrderLog and
// the trackingNo write are atomic.
export async function shipOrder(
  orderId: string,
  actor: { id: string; role: Role },
  trackingNo: string | null,
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  // Treat both null AND whitespace-only as &ldquo;no tracking number&rdquo;:
  // `'   '.trim()` is `''`, not null, so a naive `?? null` would
  // happily write an empty string to Order.trackingNo.
  const trimmed = trackingNo?.trim() ?? '';
  const tracking = trimmed.length > 0 ? trimmed : null;
  const result = await transitionWithLog(
    orderId,
    OrderStatus.SHIPPED,
    actor,
    {
      remark: tracking ? `发货：${tracking}` : '标记发货',
      now,
      extraData: tracking !== null ? { trackingNo: tracking } : undefined,
    },
  );

  // Slice C wire ─ ORDER_SHIPPED（tx 已 commit；生产入持久化队列）。
  // **关键 null 映射**：events.ts:ORDER_SHIPPED.trackingNo 必填 string，
  // 如果传入 null/undefined，renderTemplate 会把 `{trackingNo}` 留成
  // raw 字面量流到群消息（HANDOFF round 102 Slice C TODO）。这里映射
  // null → '未填'。
  const payload = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNo: true },
  });
  if (payload) {
    await dispatchNotification(
      'ORDER_SHIPPED',
      {
        orderId: payload.id,
        orderNo: payload.orderNo,
        trackingNo: tracking ?? '未填',
      },
      { dedupeKey: `notification:ORDER_SHIPPED:${payload.id}` },
    );
  }

  return result;
}

// SHIPPED → FINISHED (terminal). The ledger close — used after delivery
// is acknowledged so the order leaves the active workspace. Same
// `order:ship` permission gate at the action layer (OWNER + FOREMAN);
// no separate `order:finish` permission since today there's no business
// rule that distinguishes the two transitions' authority.
export async function finishOrder(
  orderId: string,
  actor: { id: string; role: Role },
  now: Date = new Date(),
): Promise<{ id: string; status: OrderStatus }> {
  return transitionWithLog(orderId, OrderStatus.FINISHED, actor, {
    remark: '确认完工',
    now,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Order edit (E-lean: top-level fields only, SPEC §3.6)
// ─────────────────────────────────────────────────────────────────────
//
// Tx surface for the edit path. Kept separate from create/transition so
// the types don't drift when those grow new needs.
type EditTxClient = {
  order: {
    findFirst: (args: {
      where: unknown;
      select?: unknown;
    }) => Promise<
      | {
          id: string;
          status: OrderStatus;
          submitterId: string;
          customerRef: string | null;
          receiverName: string | null;
          receiverPhone: string | null;
          receiverAddress: string | null;
          expressCode: string | null;
          packageRequirement: string | null;
          remark: string | null;
          promisedDate: Date | null;
          isUrgent: boolean;
        }
      | null
    >;
    update: (args: {
      where: { id: string };
      data: unknown;
      select?: unknown;
    }) => Promise<{ id: string; status: OrderStatus }>;
  };
  orderLog: {
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

type EditableOrderFieldValue = string | boolean | Date | null;

type EditableOrderSnapshot = {
  customerRef: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  expressCode: string | null;
  packageRequirement: string | null;
  remark: string | null;
  promisedDate: Date | null;
  isUrgent: boolean;
};

// Zod `optionalTrimmedText` collapses blank → undefined in the parsed
// output; normalize that to explicit null so diffing and persistence
// treat "user cleared the field" the same as the DB's null state.
function normalizeEditableValue(raw: unknown): EditableOrderFieldValue {
  if (raw === undefined || raw === '') return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'boolean' || typeof raw === 'string') return raw;
  return null;
}

// Date 用时间戳比较（=== 对两个等值 Date 恒为 false，会把"没改"误判成
// 改动，刷出多余的 OrderLog）。
function editableValueEquals(
  a: EditableOrderFieldValue,
  b: EditableOrderFieldValue,
): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  return a === b;
}

// Shallow-pick only the fields that are editable at this status. Anything
// else in `input` is silently dropped; the action layer has already
// rejected unknown keys via Zod, so this is a second defense, not a
// silent filter of user-supplied data.
function pickEditableFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, EditableOrderFieldValue> {
  const out: Record<string, EditableOrderFieldValue> = {};
  for (const key of allowed) {
    if (!(key in input)) continue;
    out[key] = normalizeEditableValue(input[key]);
  }
  return out;
}

function diffEditableFields(
  before: EditableOrderSnapshot,
  next: Record<string, EditableOrderFieldValue>,
): Record<string, { before: EditableOrderFieldValue; after: EditableOrderFieldValue }> {
  const changes: Record<
    string,
    { before: EditableOrderFieldValue; after: EditableOrderFieldValue }
  > = {};
  for (const [key, after] of Object.entries(next)) {
    const prev = (before as unknown as Record<string, EditableOrderFieldValue>)[key] ?? null;
    if (!editableValueEquals(prev, after)) {
      changes[key] = { before: prev, after };
    }
  }
  return changes;
}

export type UpdateOrderResult = {
  id: string;
  status: OrderStatus;
  changed: boolean;
  changedFields: string[];
};

export async function updateOrderFields(
  orderId: string,
  input: UpdateEditableOrderInput | UpdateShippingOrderInput,
  actor: { id: string; role: Role },
): Promise<UpdateOrderResult> {
  return db.$transaction(async (tx) => {
    const txClient = tx as unknown as EditTxClient;

    const order = await txClient.order.findFirst({
      // Scope filter + id gives us "can this actor see this order?" in
      // a single query — action-layer ownership on top of role scope.
      where: { id: orderId, ...getOrderScopeFilter(actor) },
      select: {
        id: true,
        status: true,
        submitterId: true,
        customerRef: true,
        receiverName: true,
        receiverPhone: true,
        receiverAddress: true,
        expressCode: true,
        packageRequirement: true,
        remark: true,
        promisedDate: true,
        isUrgent: true,
      },
    });
    if (!order) throw new OrderInvariantError('工单不存在或无权访问');

    // SALES / CUSTOMER_SERVICE can only edit their own orders. OWNER /
    // FOREMAN have a global override so they can correct field data for
    // anyone. Same pattern as submitOrder's ownership guard.
    const globalOverride = actor.role === Role.OWNER || actor.role === Role.FOREMAN;
    if (!globalOverride && order.submitterId !== actor.id) {
      throw new OrderInvariantError('只能修改自己创建的工单');
    }

    const fieldset = editableFieldsetForStatus(order.status);
    if (fieldset === 'NONE') {
      throw new OrderInvariantError('当前状态不可编辑');
    }
    const allowed =
      fieldset === 'FULL' ? FULL_EDITABLE_FIELDS : SHIPPING_EDITABLE_FIELDS;

    const nextFields = pickEditableFields(
      input as unknown as Record<string, unknown>,
      allowed,
    );
    const changes = diffEditableFields(order, nextFields);

    // No-op edit — skip the UPDATE and the log entry. Keeps the
    // OrderLog feed clean for users who open the edit form and save
    // without changing anything.
    if (Object.keys(changes).length === 0) {
      return {
        id: order.id,
        status: order.status,
        changed: false,
        changedFields: [],
      };
    }

    const updated = await txClient.order.update({
      where: { id: orderId },
      data: nextFields,
      select: { id: true, status: true },
    });

    await txClient.orderLog.create({
      data: {
        orderId,
        operatorId: actor.id,
        action: 'UPDATE',
        changedFields: changes,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      changed: true,
      changedFields: Object.keys(changes),
    };
  });
}

// Quick one-click 急单 flip. Callable only while the order is in
// DRAFT / SUBMITTED (isUrgent is not in the SHIPPING_ONLY set); delegates
// to updateOrderFields so the same scope / OrderLog guarantees apply.
export async function setOrderUrgent(
  orderId: string,
  isUrgent: boolean,
  actor: { id: string; role: Role },
): Promise<UpdateOrderResult> {
  return updateOrderFields(orderId, { isUrgent } as UpdateEditableOrderInput, actor);
}

// ─────────────────────────────────────────────────────────────────────
// Read helpers — scoped by role (SPEC §2.2 permission matrix)
// ─────────────────────────────────────────────────────────────────────

export type OrderListRow = {
  id: string;
  orderNo: string;
  status: OrderStatus;
  isUrgent: boolean;
  customerRef: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  trackingNo: string | null;
  expressCode: string | null;
  searchPinyin: string | null;
  searchPinyinInitials: string | null;
  totalAmount: unknown; // Prisma Decimal — UI layer formats
  submitterId: string;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeSearchQuery(q?: string | null): string | null {
  const trimmed = q?.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function orderSearchFilter(q?: string | null): Prisma.OrderWhereInput | undefined {
  const query = normalizeSearchQuery(q);
  if (!query) return undefined;
  return {
    OR: [
      { orderNo: { contains: query, mode: 'insensitive' } },
      { customerRef: { contains: query, mode: 'insensitive' } },
      { receiverName: { contains: query, mode: 'insensitive' } },
      { receiverPhone: { contains: query, mode: 'insensitive' } },
      { trackingNo: { contains: query, mode: 'insensitive' } },
      { expressCode: { contains: query, mode: 'insensitive' } },
      { searchPinyin: { contains: query, mode: 'insensitive' } },
      { searchPinyinInitials: { contains: query, mode: 'insensitive' } },
    ],
  };
}

export async function listOrders(
  user: { id: string; role: Role },
  opts: { q?: string | null } = {},
): Promise<OrderListRow[]> {
  const scope = getOrderScopeFilter(user);
  const query = normalizeSearchQuery(opts.q);
  const search = orderSearchFilter(query);
  const rows = await db.order.findMany({
    where: search ? { AND: [scope, search] } : scope,
    select: {
      id: true,
      orderNo: true,
      status: true,
      isUrgent: true,
      customerRef: true,
      receiverName: true,
      receiverPhone: true,
      trackingNo: true,
      expressCode: true,
      searchPinyin: true,
      searchPinyinInitials: true,
      totalAmount: true,
      submitterId: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ isUrgent: 'desc' }, { createdAt: 'desc' }],
  });

  return sortBySearchRelevance(rows, query, (row) => ({
    fields: [
      row.orderNo,
      row.customerRef,
      row.receiverName,
      row.receiverPhone,
      row.trackingNo,
      row.expressCode,
    ],
    pinyinFields: [row.searchPinyin, row.searchPinyinInitials],
  }));
}

export async function getOrderDetail(id: string, user: { id: string; role: Role }) {
  const order = await db.order.findFirst({
    where: {
      id,
      // Same scope filter as listOrders — fetching by id respects the
      // role-based visibility rather than erroring inconsistently.
      ...getOrderScopeFilter(user),
    },
    include: {
      items: {
        orderBy: { sequence: 'asc' },
        include: {
          designs: true,
          product: {
            select: {
              id: true,
              name: true,
              categoryNodeId: true,
              categoryNode: { select: { id: true, name: true } },
            },
          },
        },
      },
      logs: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          operator: { select: { displayName: true, role: true } },
        },
      },
      submitter: {
        select: { id: true, displayName: true, username: true, role: true },
      },
    },
  });
  return order;
}

// Re-export for action-layer error mapping.
export { InvalidOrderTransitionError };

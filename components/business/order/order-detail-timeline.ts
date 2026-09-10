import { OrderStatus } from '../../../generated/prisma/enums';
import {
  formatDateShanghai,
  formatDateTimeShanghai,
} from '@/lib/format/dates';
import { orderStatusZh } from '@/lib/order/log-format';

export type OrderTimelineProductionUnit = {
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
};

export type OrderTimelineLog = {
  action: string;
  createdAt: Date;
  operatorName: string;
  changedFields?: unknown;
};

export type OrderTimelineInput = {
  status: OrderStatus;
  createdAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  promisedDate: Date | null;
  submitterName: string;
  logs: OrderTimelineLog[];
  productionUnits: OrderTimelineProductionUnit[];
  uncoveredOutsourceNames: string[];
  hasLiveOutsource: boolean;
  pendingChangeRequest: boolean;
};

export type OrderTimelineStepState = 'done' | 'current' | 'pending' | 'blocked';

export type OrderTimelineStep = {
  key: string;
  label: string;
  meta: string;
  state: OrderTimelineStepState;
  block: string | null;
};

const FLOW: Array<{ key: string; label: string }> = [
  { key: 'created', label: '已创建' },
  { key: 'submitted', label: '已提交' },
  { key: 'scheduled', label: '工序已生成' },
  { key: 'producing', label: '生产中' },
  { key: 'complete', label: '等待完工' },
  { key: 'shipped', label: '发货' },
  { key: 'finished', label: '结案与归集账单' },
];

const FLOW_INDEX: Record<OrderStatus, number> = {
  [OrderStatus.DRAFT]: 0,
  [OrderStatus.PENDING_FACTORY]: 1,
  [OrderStatus.REJECTED]: -1,
  [OrderStatus.CONFIRMED]: 1,
  [OrderStatus.ON_HOLD]: 2,
  [OrderStatus.RELEASED]: 2,
  [OrderStatus.FOILING]: 3,
  [OrderStatus.PACKING]: 4,
  [OrderStatus.SETTLED]: 6,
  [OrderStatus.SUBMITTED]: 1,
  [OrderStatus.SCHEDULING]: 2,
  [OrderStatus.IN_PRODUCTION]: 3,
  [OrderStatus.COMPLETED]: 4,
  [OrderStatus.SHIPPED]: 5,
  [OrderStatus.FINISHED]: 6,
  [OrderStatus.CANCELLED]: -1,
};

function logForStatus(logs: OrderTimelineLog[], status: OrderStatus) {
  return logs.find((log) => {
    if (log.action !== 'STATUS_CHANGE') return false;
    const fields = log.changedFields;
    if (!fields || typeof fields !== 'object') return false;
    const statusDiff = (fields as { status?: { after?: unknown } }).status;
    return statusDiff?.after === status;
  });
}

function logForAction(logs: OrderTimelineLog[], action: string) {
  return logs.find((log) => log.action === action);
}

function stamp(
  date: Date | null | undefined,
  who?: string,
  empty = '—',
): string {
  if (!date) return empty;
  const when = formatDateTimeShanghai(date);
  return who ? `${when} · ${who}` : when;
}

export function buildOrderDetailTimeline(
  input: OrderTimelineInput,
): OrderTimelineStep[] {
  const currentIndex = FLOW_INDEX[input.status];
  const completedUnits = input.productionUnits.filter(
    (unit) => unit.status === 'COMPLETED',
  ).length;
  const incompleteUnits = input.productionUnits.filter(
    (unit) => unit.status === 'PENDING' || unit.status === 'IN_PROGRESS',
  ).length;
  const submittedLog =
    logForStatus(input.logs, OrderStatus.PENDING_FACTORY) ??
    logForStatus(input.logs, OrderStatus.SUBMITTED);
  const scheduledLog = logForStatus(input.logs, OrderStatus.SCHEDULING);
  const productionLog = logForStatus(input.logs, OrderStatus.IN_PRODUCTION);
  // A production-changing revision clears completedAt but deliberately keeps
  // the prior generation's immutable audit rows. Never let an old canonical
  // log make the reopened generation look complete; completedAt is the current
  // generation's source of truth. Legacy terminal statuses remain compatible
  // with their historical STATUS_CHANGE row.
  const canonicalCompletedLog = input.completedAt
    ? logForAction(input.logs, 'PRODUCTION_COMPLETED')
    : undefined;
  const legacyCompletedLog = logForStatus(input.logs, OrderStatus.COMPLETED);
  const legacyProductionCompleted =
    input.status === OrderStatus.COMPLETED ||
    input.status === OrderStatus.SHIPPED ||
    input.status === OrderStatus.FINISHED ||
    input.status === OrderStatus.SETTLED;
  const productionCompleted =
    input.completedAt !== null || legacyProductionCompleted;
  const completedLog =
    canonicalCompletedLog ??
    (legacyProductionCompleted ? legacyCompletedLog : undefined);
  const shippedLog = logForStatus(input.logs, OrderStatus.SHIPPED);
  const finishedLog = logForStatus(input.logs, OrderStatus.FINISHED);
  const cancelledLog = logForStatus(input.logs, OrderStatus.CANCELLED);

  const uncovered =
    input.uncoveredOutsourceNames.length > 0
      ? `阻断：${input.uncoveredOutsourceNames.join('、')} 外协履约不足`
      : null;
  const liveOutsourceBlock = input.hasLiveOutsource
    ? '阻断：仍有已发出或进行中的外协单'
    : null;
  const incompleteBlock =
    incompleteUnits > 0
      ? `${incompleteUnits} 个工序未完工`
      : null;
  const changeBlock = input.pendingChangeRequest
    ? '有待审核的修改申请'
    : null;

  const metas = [
    stamp(input.createdAt, input.submitterName),
    stamp(
      input.submittedAt ?? submittedLog?.createdAt ?? null,
      submittedLog?.operatorName ?? input.submitterName,
      input.status === OrderStatus.DRAFT ? '尚未提交' : '—',
    ),
    scheduledLog
      ? stamp(scheduledLog.createdAt, scheduledLog.operatorName)
      : input.productionUnits.length > 0
        ? `已生成 ${input.productionUnits.length} 个生产工序`
        : input.status === OrderStatus.SCHEDULING
          ? '等待生成生产工序'
          : '—',
    productionLog
      ? `${stamp(productionLog.createdAt, productionLog.operatorName)} · 已完工 ${completedUnits} / ${input.productionUnits.length} 个工序`
      : input.productionUnits.length > 0
        ? `已完工 ${completedUnits} / ${input.productionUnits.length} 个工序`
        : '尚未生成生产工序',
    input.completedAt
      ? stamp(input.completedAt, completedLog?.operatorName)
      : completedLog
        ? stamp(completedLog.createdAt, completedLog.operatorName)
        : productionCompleted
          ? '已记录生产完成'
          : uncovered ?? '内部工序完工后转入',
    shippedLog
      ? stamp(shippedLog.createdAt, shippedLog.operatorName)
      : input.promisedDate
        ? `承诺交期 ${formatDateShanghai(input.promisedDate)}`
        : '—',
    finishedLog
      ? stamp(finishedLog.createdAt, finishedLog.operatorName)
      : '发货确认收件后结案',
  ];

  const blocks: Array<string | null> = [
    null,
    null,
    changeBlock && currentIndex <= 2 ? changeBlock : null,
    uncovered && input.status === OrderStatus.IN_PRODUCTION ? uncovered : null,
    uncovered &&
    (input.status === OrderStatus.IN_PRODUCTION ||
      input.status === OrderStatus.SCHEDULING)
      ? uncovered
      : incompleteBlock && currentIndex < 4
        ? incompleteBlock
        : null,
    liveOutsourceBlock ??
      (incompleteBlock && currentIndex < 5 ? incompleteBlock : null),
    null,
  ];

  if (input.status === OrderStatus.CANCELLED) {
    const cancelMeta = cancelledLog
      ? stamp(cancelledLog.createdAt, cancelledLog.operatorName)
      : '已取消';
    return [
      {
        key: 'cancelled',
        label: '已取消',
        meta: cancelMeta,
        state: 'current',
        block: '工单不再参与生产与账单归集',
      },
      ...FLOW.map((step, index) => ({
        key: step.key,
        label: step.label,
        meta: metas[index] ?? '—',
        state: 'pending' as const,
        block: null,
      })),
    ];
  }

  return FLOW.map((step, index) => {
    const isCurrent = currentIndex === index;
    const isDone = currentIndex > index;
    const block = isCurrent ? blocks[index] : null;
    const state: OrderTimelineStepState = isDone
      ? 'done'
      : isCurrent
        ? block
          ? 'blocked'
          : 'current'
        : 'pending';
    return {
      key: step.key,
      label:
        step.key === 'complete' && productionCompleted
          ? input.status === OrderStatus.COMPLETED && !canonicalCompletedLog
            ? '已完工'
            : '生产已完成'
          : step.key === 'producing' && isCurrent
            ? orderStatusZh(OrderStatus.IN_PRODUCTION)
            : step.label,
      meta: metas[index] ?? '—',
      state,
      block,
    };
  });
}

export function orderCancelImpact(input: {
  pendingProductionCount: number;
  inProgressProductionCount: number;
  completedProductionCount: number;
  liveOutsourceCount: number;
}): Array<{ label: string; value: string }> {
  return [
    {
      label: '取消未开工的生产工序',
      value: `${input.pendingProductionCount} 个`,
    },
    {
      label: '进行中工序需人工收尾',
      value: `${input.inProgressProductionCount} 个`,
    },
    {
      label: '已报工记录保留金额快照',
      value: `${input.completedProductionCount} 个`,
    },
    {
      label: '外协单需人工处理',
      value:
        input.liveOutsourceCount > 0
          ? `${input.liveOutsourceCount} 单已发出或进行中`
          : '无进行中外协',
    },
  ];
}

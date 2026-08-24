import {
  OrderStatus,
  TaskStatus,
} from '../../../generated/prisma/enums';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { orderStatusZh } from '@/lib/order/log-format';

export type OrderTimelineTask = {
  status: TaskStatus;
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
  promisedDate: Date | null;
  submitterName: string;
  logs: OrderTimelineLog[];
  tasks: OrderTimelineTask[];
  assignedWorkerCount: number;
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
  { key: 'scheduled', label: '排产完成' },
  { key: 'producing', label: '生产中' },
  { key: 'complete', label: '等待完工' },
  { key: 'shipped', label: '发货' },
  { key: 'finished', label: '结案与归集账单' },
];

const FLOW_INDEX: Record<OrderStatus, number> = {
  [OrderStatus.DRAFT]: 0,
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
  const completedTasks = input.tasks.filter(
    (task) => task.status === TaskStatus.COMPLETED,
  ).length;
  const incompleteTasks = input.tasks.filter(
    (task) =>
      task.status === TaskStatus.PENDING ||
      task.status === TaskStatus.IN_PROGRESS,
  ).length;
  const submittedLog = logForStatus(input.logs, OrderStatus.SUBMITTED);
  const scheduledLog = logForStatus(input.logs, OrderStatus.SCHEDULING);
  const productionLog = logForStatus(input.logs, OrderStatus.IN_PRODUCTION);
  const completedLog = logForStatus(input.logs, OrderStatus.COMPLETED);
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
    incompleteTasks > 0
      ? `${incompleteTasks} 个任务未完工`
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
      : input.assignedWorkerCount > 0
        ? `已分派 ${input.assignedWorkerCount} 名师傅`
        : input.status === OrderStatus.SCHEDULING
          ? '等待分派'
          : '—',
    productionLog
      ? `${stamp(productionLog.createdAt, productionLog.operatorName)} · 已完工 ${completedTasks} / ${input.tasks.length} 个任务`
      : input.tasks.length > 0
        ? `已完工 ${completedTasks} / ${input.tasks.length} 个任务`
        : '尚未排产',
    completedLog
      ? stamp(completedLog.createdAt, completedLog.operatorName)
      : uncovered ?? '内部任务完工后转入',
    shippedLog
      ? stamp(shippedLog.createdAt, shippedLog.operatorName)
      : input.promisedDate
        ? `承诺交期 ${input.promisedDate.toISOString().slice(0, 10)}`
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
      : '已进入 CANCELLED 终态';
    return [
      {
        key: 'cancelled',
        label: '已取消',
        meta: cancelMeta,
        state: 'current',
        block: '工单不再参与排产、生产与账单归集',
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
        step.key === 'complete' && input.status === OrderStatus.COMPLETED
          ? '已完工'
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
  pendingTaskCount: number;
  inProgressTaskCount: number;
  completedTaskCount: number;
  liveOutsourceCount: number;
}): Array<{ label: string; value: string }> {
  return [
    {
      label: '取消未开工的生产任务',
      value: `${input.pendingTaskCount} 个`,
    },
    {
      label: '进行中任务需人工收尾',
      value: `${input.inProgressTaskCount} 个`,
    },
    {
      label: '已完工任务保留计件工资',
      value: `${input.completedTaskCount} 个`,
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

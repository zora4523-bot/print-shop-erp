import Decimal from 'decimal.js';
import { formatMoney } from '@/lib/dashboard/format';
import type { AdminOrderBatchActionResult } from '@/actions/admin-order-workflow';
import type { AdminOrderBatchCommand, AdminOrderBatchItemResult } from '@/lib/order/admin-batch';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import type { OrderListSelectionItem } from './OrderListBatchSelection';

export const BATCH_COMMAND_CONFIG = {
  RELEASE_AND_CREATE_PRINT: {
    label: '下发生产', capability: 'release', prerequisite: '需资料与费用完整且无待审批申请',
    confirmLabel: '确认下发生产',
    impact: '工单下发至车间，并加入待打印。',
    completed: '已下发生产，待打印',
  },
  CREATE_PRINT: {
    label: '加入待打印', capability: 'createPrint', prerequisite: '需可打印且无待打印任务',
    confirmLabel: '确认加入待打印',
    impact: '将当前版本的工单加入待打印。',
    completed: '已加入待打印',
  },
  MARK_PRINTED: {
    label: '确认已打印', capability: 'markPrinted', prerequisite: '需有当前版待打印任务',
    confirmLabel: '确认已打印',
    impact: '将当前版本的待打印任务标记为已打印；请确认纸质工单已实际打印。',
    completed: '已标记为打印完成',
  },
  SETTLE: {
    label: '批量结算', capability: 'settle', prerequisite: '需已发货且费用已确认',
    confirmLabel: '确认批量结算',
    impact: '按每张工单的已确认金额完成结算，并记录结算时间。',
    completed: '已完成结算',
  },
  COMPLETE_PRODUCTION: {
    label: '批量完成生产', capability: 'completeProduction', prerequisite: '需为已安排师傅的单人生产工单且无数量待审批',
    confirmLabel: '确认完成生产',
    impact: '按计划数量为每个待完成的生产任务代师傅登记完成（生产日期记为今天），并按工价计入师傅提成。',
    completed: '已按计划数量登记生产完成',
  },
} as const;

export type BatchOrderSnapshot = {
  id: string;
  orderNo: string;
  customName: string | null;
  revision: number;
  workOrderVersion: number;
  pendingPrintJobId: string | null;
  confirmedFee: string | null;
  productionOwners: string[];
  eligible: boolean;
  reason: string | null;
};

/** Capture the reviewed selection, rather than a later selection or refreshed row. */
export function snapshotBatchSelection(
  command: AdminOrderBatchCommand,
  selectedItems: readonly OrderListSelectionItem[],
  orders: readonly AdminOrderWorkspaceRow[],
): BatchOrderSnapshot[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  return selectedItems.map((selected) => {
    const order = orderById.get(selected.id);
    let reason: string | null = null;
    if (!order) reason = '工单已移出当前列表，请刷新后重新选择';
    else if (!order.capabilities[BATCH_COMMAND_CONFIG[command].capability]) {
      reason = order.pendingChangeRequest
        ? '存在待审批申请，请先打开工单处理变更'
        : `${BATCH_COMMAND_CONFIG[command].prerequisite}，请打开工单核对`;
    } else if (command === 'MARK_PRINTED' && !order.pendingPrintJobId) {
      reason = '没有当前版待打印任务，请刷新后检查打印记录';
    } else if (command === 'SETTLE' && order.feeStages.confirmed === null) {
      reason = '缺少已确认金额，请打开工单核定费用';
    }
    return {
      id: selected.id,
      orderNo: selected.orderNo,
      customName: order?.customName ?? null,
      revision: order?.revision ?? 0,
      workOrderVersion: order?.workOrderVersion ?? 1,
      pendingPrintJobId: order?.pendingPrintJobId ?? null,
      confirmedFee: order?.feeStages.confirmed ?? null,
      productionOwners: order?.productionOwners ?? [],
      eligible: reason === null,
      reason,
    };
  });
}

export function batchConfirmationImpact(
  command: AdminOrderBatchCommand,
  orders: readonly BatchOrderSnapshot[],
): string[] {
  const eligible = orders.filter((order) => order.eligible);
  const excluded = orders.filter((order) => !order.eligible);
  const amounts = command === 'SETTLE'
    ? [`本次结算合计 ${formatMoney(eligible.reduce((total, order) => total.plus(order.confirmedFee!), new Decimal(0)))}`]
    : [];
  return [
    `已选 ${orders.length} 张，本次可处理 ${eligible.length} 张`,
    BATCH_COMMAND_CONFIG[command].impact,
    ...amounts,
    ...eligible.map((order) => `${order.orderNo}${order.customName ? ` · ${order.customName}` : ''}${command === 'SETTLE' ? `：${formatMoney(order.confirmedFee!)}` : ` · v${order.workOrderVersion}`}${command === 'COMPLETE_PRODUCTION' && order.productionOwners.length ? ` · 师傅：${order.productionOwners.join('、')}` : ''}`),
    ...excluded.map((order) => `${order.orderNo}：本次不处理；${order.reason}`),
    '逐单独立处理；已成功的工单不会因其他工单失败而回退。',
  ];
}

/** Server errors may contain enum values; only business-facing explanations reach this UI. */
export function batchFailureReason(code: string | undefined): string {
  switch (code) {
    case 'FORBIDDEN': return '当前账号没有操作权限，请联系管理员核对权限';
    case 'ORDER_NOT_FOUND': return '工单已不存在或不可访问，请刷新列表后核对';
    case 'STALE_VERSION':
    case 'VERSION_STALE': return '工单已更新，请打开工单核对最新版本后重新选择';
    case 'INVALID_STATUS':
    case 'ORDER_NOT_PRINTABLE':
    case 'ORDER_STATUS_NOT_ACTIVATABLE': return '工单当前状态不支持此操作，请打开工单检查当前待办';
    case 'PRINT_REQUEST_NOT_FOUND': return '待打印任务已变化，请打开工单核对最新打印记录';
    case 'PRINT_REQUEST_ALREADY_PENDING': return '已有待打印任务，请先打印并确认完成';
    case 'PRICING_NOT_CONFIRMED':
    case 'ORDER_NOT_CHARGEABLE': return '费用尚未确认，请打开工单完成核价';
    case 'CANONICAL_FACTS_INCOMPLETE':
    case 'CRAFT_FACTS_INCOMPLETE': return '生产资料不完整，请打开工单补齐款式与工艺';
    case 'EXISTING_OPERATION_MISMATCH': return '生产工序与当前工单不一致，请打开工单核对生产记录';
    case 'PREFLIGHT_FAILED': return '前置检查未通过，请打开工单处理待审批申请、费用或生产事项';
    case 'IDEMPOTENCY_CONFLICT': return '操作记录已变化，请先打开工单核对处理结果再重试';
    case 'INVALID_INPUT': return '当前操作资料不完整，请刷新列表后重新选择工单';
    default: return '暂不能处理，请打开工单检查当前状态与待办后重试';
  }
}

/** PlannedCompletionError messages are curated and name the worker or task to fix. */
const PLANNED_COMPLETION_CODES = new Set(['NOT_SIMPLE_PRODUCTION', 'CHANGE_PENDING', 'QUANTITY_PENDING', 'UNASSIGNED_PRODUCTION', 'WORKER_UNAVAILABLE', 'NOTHING_TO_COMPLETE', 'REGISTRATION_FAILED']);

export type BatchReceiptRow = {
  order: BatchOrderSnapshot;
  outcome: 'success' | 'skipped' | 'unknown' | 'not-attempted';
  label: string;
  reason: string;
};

export function batchReceiptRows(
  command: AdminOrderBatchCommand,
  orders: readonly BatchOrderSnapshot[],
  response: AdminOrderBatchActionResult | null,
): BatchReceiptRow[] {
  const resultById = new Map<string, AdminOrderBatchItemResult>(
    response?.status === 'success' || response?.status === 'partial_failure'
      ? response.result.items.map((item) => [item.orderId, item])
      : [],
  );
  return orders.map((order) => {
    if (!order.eligible) return { order, outcome: 'skipped', label: '未纳入处理', reason: order.reason! };
    if (response?.status === 'invalid' || response?.status === 'error') {
      return { order, outcome: 'not-attempted', label: '未执行', reason: batchFailureReason(response.status === 'error' ? response.code : 'INVALID_INPUT') };
    }
    const result = resultById.get(order.id);
    if (result?.status === 'success') return { order, outcome: 'success', label: '成功', reason: BATCH_COMMAND_CONFIG[command].completed };
    if (result?.status === 'skipped') return { order, outcome: 'skipped', label: '业务跳过', reason: PLANNED_COMPLETION_CODES.has(result.code) ? result.message : batchFailureReason(result.code) };
    if (result?.status === 'not_attempted') return { order, outcome: 'not-attempted', label: '未执行', reason: '前序工单处理异常，本次未继续执行；请核对列表后重新选择' };
    return { order, outcome: 'unknown', label: '结果未知', reason: '未能确认处理结果；请先打开工单核对最新记录，不要直接重复提交' };
  });
}

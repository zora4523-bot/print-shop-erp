// Pure formatter for OrderLog.changedFields. Separate from the detail
// page so both the UI render and tests can share the same label /
// value-formatting rules.

const FIELD_LABELS: Record<string, string> = {
  // Top-level Order fields the edit form can touch
  customName: '工单名称',
  customerRef: '客户名称/简称',
  receiverName: '收货人',
  receiverPhone: '收货电话',
  receiverAddress: '收货地址',
  expressCode: '快递代码',
  packageRequirement: '包装要求',
  remark: '工单备注',
  promisedDate: '承诺交期',
  isUrgent: '急单',
  isSfCollect: '顺丰到付',
  // Status changes land in the same log table under action='STATUS_CHANGE'
  status: '状态',
  // Created-by / submitted-by meta
  trackingNo: '快递单号',
  // 超计划报工（action='TASK_OVER_REPORT'）落在同一张表里
  completedQty: '合格数',
  defectQty: '不良数',
  reworkQty: '返工数',
  taskId: '生产任务',
  disputeStatus: '异议状态',
  disputeResolution: '异议处理回复',
  workerId: '接单师傅',
  workerType: '生产岗位',
  machineType: '生产机型',
  isSelfClaimable: '抢单池状态',
  claimMachineTypes: '可接机型',
  selfClaimedAt: '抢单时间',
  pricingStatus: '对客价格状态',
  priceRevision: '价格修订',
  priceBooks: '本次价目簿',
  totalAmount: '对客应收总额',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  SCHEDULING: '待排产',
  IN_PRODUCTION: '生产中',
  COMPLETED: '已完工',
  SHIPPED: '已发货',
  FINISHED: '已完成',
  CANCELLED: '已取消',
};

const PRICING_STATUS_LABELS: Record<string, string> = {
  LEGACY_CONFIRMED: '历史已确认',
  AUTO_CONFIRMED: '系统自动确认',
  PENDING_ADMIN_CONFIRMATION: '待管理员确认价格',
  ADMIN_CONFIRMED: '管理员已确认',
};

const UNKNOWN_ORDER_STATUS_LABEL = '未识别工单状态';
const UNKNOWN_PRICING_STATUS_LABEL = '未识别价格状态';
const UNKNOWN_FIELD_LABEL = '其他变更';
const UNKNOWN_VALUE_LABEL = '未识别变更内容';
const UNKNOWN_ACTION_LABEL = '其他操作';

function hasKnownField(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIELD_LABELS, name);
}

// 工单状态中文标签（cron 推送 / 日志渲染共用）。
export function orderStatusZh(status: string): string {
  return STATUS_LABELS[status] ?? UNKNOWN_ORDER_STATUS_LABEL;
}

export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? UNKNOWN_FIELD_LABEL;
}

// Format a single before/after value for display. Booleans render as
// 是/否 (not true/false), null / undefined / empty string as em-dash
// "—" so the reader can see a real "cleared" event. Status enum values
// get their Chinese label.
export function formatLogValue(
  fieldName: string,
  value: unknown,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (!hasKnownField(fieldName)) return UNKNOWN_VALUE_LABEL;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (fieldName === 'status' && typeof value === 'string') {
    return STATUS_LABELS[value] ?? UNKNOWN_ORDER_STATUS_LABEL;
  }
  if (fieldName === 'pricingStatus' && typeof value === 'string') {
    return PRICING_STATUS_LABELS[value] ?? UNKNOWN_PRICING_STATUS_LABEL;
  }
  // 日期字段：diff 里的 Date 落 JSON 后是 ISO 串，只展示日期部分
  if (fieldName === 'promisedDate') {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'string') return value.slice(0, 10);
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return UNKNOWN_VALUE_LABEL;
}

export type LogChangeRow = {
  field: string;
  label: string;
  before: string;
  after: string;
};

// Accept raw JSON shape as stored — `Record<field, { before, after }>`.
// Unknown / malformed entries are skipped rather than throwing; an
// OrderLog that pre-dates a field rename shouldn't break the detail
// page.
export function formatOrderLogChanges(changedFields: unknown): LogChangeRow[] {
  if (!changedFields || typeof changedFields !== 'object') return [];
  const rows: LogChangeRow[] = [];
  for (const [field, entry] of Object.entries(changedFields as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { before?: unknown; after?: unknown };
    if (!('before' in e) && !('after' in e)) continue;
    rows.push({
      field,
      label: fieldLabel(field),
      before: formatLogValue(field, e.before),
      after: formatLogValue(field, e.after),
    });
  }
  return rows;
}

// Human-readable label for OrderLog.action. Kept here so the detail
// page doesn't hardcode the enum strings.
const ACTION_LABELS: Record<string, string> = {
  CREATE: '创建',
  UPDATE: '编辑',
  STATUS_CHANGE: '状态变更',
  DELETE: '删除',
  // 旧派工/抢单写入器已移除；这些标签仅供历史 OrderLog 时间线解读。
  TASK_REASSIGN: '任务改派',
  TASK_OVER_REPORT: '超计划报工',
  TASK_RELEASE_TO_POOL: '释放到抢单池',
  TASK_SELF_CLAIM: '师傅抢单',
  TASK_DISPUTE_CREATED: '师傅发起任务异议',
  TASK_DISPUTE_RESOLVED: '任务异议已解决',
  TASK_DISPUTE_REJECTED: '任务异议已驳回',
  PRICING_ADMIN_CONFIRMED: '管理员终价确认',
  ORDER_MANUAL_CHARGE_CREATED: '新增对客费用',
  ORDER_MANUAL_CHARGE_UPDATED: '修改对客费用',
  ORDER_MANUAL_CHARGE_REMOVED: '移除对客费用',
  ORDER_PLATE_DETAIL_CREATED: '新增制版明细',
  ORDER_PLATE_DETAIL_UPDATED: '修改制版明细',
  ORDER_PLATE_DETAIL_REMOVED: '移除制版明细',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? UNKNOWN_ACTION_LABEL;
}

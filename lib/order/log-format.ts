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

// 工单状态中文标签（cron 推送 / 日志渲染共用）。
export function orderStatusZh(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name;
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
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (fieldName === 'status' && typeof value === 'string') {
    return STATUS_LABELS[value] ?? value;
  }
  // 日期字段：diff 里的 Date 落 JSON 后是 ISO 串，只展示日期部分
  if (fieldName === 'promisedDate') {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'string') return value.slice(0, 10);
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  // Unexpected shape — show JSON so reviewers can still decode it
  // rather than rendering `[object Object]`.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

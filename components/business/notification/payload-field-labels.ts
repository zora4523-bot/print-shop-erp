/**
 * 推送模板占位符的业务含义。规则编辑页展示「{token}（中文含义）」，
 * token 本身必须原样保留，管理员要把它抄进模板。
 */
const PAYLOAD_FIELD_LABELS: Record<string, string> = {
  orderId: '工单内部编号',
  orderNo: '工单号',
  summary: '事件摘要',
  deepLink: '工单链接',
  submitterName: '提交人',
  externalSalesName: '外部销售',
  customerRef: '客户（已停用）',
  taskCount: '派工任务数',
  workOrderVersion: '工单版本',
  trackingNo: '快递单号',
  outsourceId: '外协单内部编号',
  supplierName: '外协厂',
  daysOverdue: '逾期天数',
  expectedDate: '预计回货日期',
  promisedDate: '承诺交期',
  status: '工单状态',
  materialName: '物料名称',
  currentStock: '当前库存',
  safetyStock: '安全库存',
  date: '日期',
  workerCount: '师傅人数',
  totalAmount: '总金额',
};

export function payloadFieldLabel(field: string): string | null {
  return PAYLOAD_FIELD_LABELS[field] ?? null;
}

/** 金额类占位符：千分位数字，不含货币符号。 */
export const AMOUNT_PAYLOAD_FIELD = 'totalAmount';

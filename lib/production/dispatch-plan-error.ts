type OrderIdentity = { id: string; customName: string | null; orderNo: string; revision: number; workOrderVersion: number };

const ISSUE_COPY: Record<string, string> = {
  NO_ITEMS: '未填写款式，请完善款式资料。',
  DUPLICATE_ITEM: '款式重复，请核对款式资料。',
  INVALID_ITEM_QUANTITY: '数量必须是正整数，请核对款式数量。',
  OPERATION_QUANTITY_OVERFLOW: '计件数量过大，请核对款式和包装数量。',
  UNKNOWN_CRAFT: '生产工艺不明确，请完善工艺资料。',
  MISSING_PARTIAL_PASS_FACTS: '局部烫金缺少正反面颜色次数，请完善烫金资料。',
  AMBIGUOUS_PRINT_FOIL_MODE: '彩印叠加烫金方式不明确，请选择局部或专版烫金。',
  NO_PACKAGING_GROUPS: '未填写包装组，请完善包装资料。',
  DUPLICATE_PACKAGING_GROUP: '包装组重复，请核对包装资料。',
  INVALID_PACKAGING_QUANTITY: '实际袋数必须是正整数，请核对包装数量。',
  EMPTY_PACKAGING_GROUP: '包装组没有款式，请添加对应款式。',
  UNKNOWN_PACKAGING_ITEM: '包装组包含不属于本单的款式，请核对包装资料。',
  DUPLICATE_PACKAGING_LINE: '包装组内款式重复，请核对款式归属。',
  INVALID_UNITS_PER_BAG: '每袋数量必须是正整数，请核对包装数量。',
  PACKAGING_QUANTITY_MISMATCH: '款式的包装归属或数量不匹配，请核对包装资料。',
  DUPLICATE_ITEM_CRAFT: '款式工艺重复，请核对工艺资料。',
  MISSING_CRAFT_DICTIONARY_ROW: '所选工艺已不存在，请重新选择工艺。',
  INACTIVE_CRAFT: '所选工艺已停用，请核对并选择可用工艺。',
};

/** Expected planning failures remain errors for write callers, but can be shown by the read page. */
export class DispatchPlanValidationError extends Error {
  readonly order: { id: string; name: string; revision: number; version: number };
  readonly issues: string[];

  constructor(order: OrderIdentity, issues: readonly { code: string; message: string }[]) {
    super(issues.map(issue => issue.message).join('；'));
    this.name = 'DispatchPlanValidationError';
    this.order = { id: order.id, name: order.customName || order.orderNo, revision: order.revision, version: order.workOrderVersion };
    this.issues = [...new Set(issues.map(issue => {
      const subject = issue.message.match(/^(?:款式|包装组) #\d+/)?.[0];
      return `${subject ? `${subject}：` : ''}${ISSUE_COPY[issue.code] ?? '生产资料不完整，请核对工单资料。'}`;
    }))];
  }
}

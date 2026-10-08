/** 已核定可展示给用户的生产业务提示。 */
export class ProductionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionInputError';
  }
}

/** 冲突核对记录已经提交，调用方须刷新对应工单。 */
export class ProductionConflictError extends ProductionInputError {
  constructor(readonly orderId: string, message: string) {
    super(message);
    this.name = 'ProductionConflictError';
  }
}

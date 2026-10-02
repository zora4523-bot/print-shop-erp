export class CdrBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdrBundleError';
  }
}

export class CdrBundleStaleError extends CdrBundleError {
  constructor() {
    super('CDR 文件已更新，请刷新工单后重新生成');
    this.name = 'CdrBundleStaleError';
  }
}

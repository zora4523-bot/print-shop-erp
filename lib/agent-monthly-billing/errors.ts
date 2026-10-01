export class AgentMonthlyBillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentMonthlyBillingError';
  }
}

export class AgentMonthlyBillNotFoundError extends AgentMonthlyBillingError {
  constructor() {
    super('月度账单不存在');
    this.name = 'AgentMonthlyBillNotFoundError';
  }
}

export class AgentMonthlyBillFrozenError extends AgentMonthlyBillingError {
  constructor(message = '账单已确认，不可修改') {
    super(message);
    this.name = 'AgentMonthlyBillFrozenError';
  }
}

export class InvalidAgentMonthlyBillTransitionError extends AgentMonthlyBillingError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAgentMonthlyBillTransitionError';
  }
}

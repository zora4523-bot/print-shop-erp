import type { AgentMonthlyBillStatus } from '../generated/prisma/enums';

export type AgentMonthlyBillActionResult =
  | {
      status: 'success';
      message: string;
      billStatus?: AgentMonthlyBillStatus;
    }
  | { status: 'invalid'; fieldErrors: Record<string, string[]> }
  | { status: 'error'; message: string };

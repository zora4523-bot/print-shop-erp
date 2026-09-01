import type {
  AgentMonthlyBillStatus,
  Role,
} from '../../generated/prisma/enums';

export type AgentMonthlyBillActor = {
  id: string;
  role: Role;
};

export type AgentMonthlyBillGenerationRow = {
  billId: string;
  agentUserId: string;
  period: string;
  status: AgentMonthlyBillStatus;
  orderCount: number;
  memberSubtotal: string;
  adjustmentAmount: string;
  totalAmount: string;
  created: boolean;
};

export type AgentMonthlyBillGenerationResult = {
  period: string;
  generated: AgentMonthlyBillGenerationRow[];
};

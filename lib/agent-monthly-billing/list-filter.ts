import { AgentMonthlyBillStatus } from '@/generated/prisma/enums';
import { firstSearchParam, parsePositiveInt } from '@/lib/admin/table';
import { isAgentBillPeriod } from './period';

type Param = string | string[] | undefined;
export type AgentBillSearchParams = { period?: Param; status?: Param; agentUserId?: Param; page?: Param };

/** Both screens use the applied URL values, including when malformed input is ignored. */
export function parseAgentBillFilters(raw: AgentBillSearchParams) {
  const period = firstSearchParam(raw.period);
  const status = Object.values(AgentMonthlyBillStatus).find((value) => value === firstSearchParam(raw.status));
  return {
    period: isAgentBillPeriod(period) ? period : undefined,
    status,
    agentUserId: firstSearchParam(raw.agentUserId).trim() || undefined,
    page: parsePositiveInt(raw.page, { defaultValue: 1 }),
  };
}

export function agentBillWhere(filter: { period?: string; status?: AgentMonthlyBillStatus; agentUserId?: string }) {
  return {
    ...(filter.period ? { period: filter.period } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.agentUserId ? { agentUserId: filter.agentUserId } : {}),
  };
}

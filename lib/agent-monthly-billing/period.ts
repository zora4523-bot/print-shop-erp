import { AgentMonthlyBillingError } from './errors';

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function currentShanghaiYearMonth(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 7);
}

export function isAgentBillPeriod(value: string): boolean {
  return YEAR_MONTH_PATTERN.test(value);
}

export function assertAgentBillPeriod(value: string): void {
  if (!isAgentBillPeriod(value)) {
    throw new AgentMonthlyBillingError('账期必须是有效的 YYYY-MM');
  }
}

export function assertClosedAgentBillPeriod(
  period: string,
  now: Date = new Date(),
): void {
  assertAgentBillPeriod(period);
  if (period >= currentShanghaiYearMonth(now)) {
    throw new AgentMonthlyBillingError('只能生成已结束的上海日历月账单');
  }
}

export function agentBillPeriodRange(period: string): {
  start: Date;
  end: Date;
} {
  assertAgentBillPeriod(period);
  const [yearText, monthText] = period.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return {
    start: new Date(Date.UTC(year, monthIndex, 1) - SHANGHAI_OFFSET_MS),
    end: new Date(Date.UTC(year, monthIndex + 1, 1) - SHANGHAI_OFFSET_MS),
  };
}

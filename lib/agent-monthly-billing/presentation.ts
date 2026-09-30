import Decimal from 'decimal.js';
import { buildTableHref } from '@/lib/admin/table';
import { parseAgentBillFilters } from './list-filter';

export function remainingCreditAmount(settledFee: Decimal.Value, credits: ReadonlyArray<{ requestedAmount: Decimal.Value }>) {
  return credits.reduce((amount, credit) => amount.plus(credit.requestedAmount), new Decimal(settledFee)).toFixed(2);
}

/** Rebuild only known list filters; never accept an arbitrary return destination. */
export function billListReturnHref(value: string | string[] | undefined, sales = false) {
  const base = sales ? '/sales/bills' : '/owner/agent-bills';
  if (typeof value !== 'string' || !value.startsWith(`${base}?`)) return base;
  const raw = new URLSearchParams(value.slice(base.length + 1));
  const filter = parseAgentBillFilters(Object.fromEntries(raw));
  return buildTableHref(base, {}, { ...filter, agentUserId: sales ? undefined : filter.agentUserId, page: filter.page > 1 ? filter.page : undefined });
}

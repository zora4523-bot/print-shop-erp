import Decimal from 'decimal.js';
import { OrderStatus } from '@/generated/prisma/enums';
import { ORDER_STATUS_REGISTRY, type StatusDefinition } from '@/lib/ui/status-registry';
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

/**
 * Link to a bill detail (or a page beneath it) that keeps the list scope. The list destination is
 * re-sanitized here, so callers may pass the raw query value; the unfiltered list adds no parameter.
 */
export function billScopedHref(path: string, returnTo: string | string[] | undefined, sales = false) {
  const base = sales ? '/sales/bills' : '/owner/agent-bills';
  const back = billListReturnHref(returnTo, sales);
  return buildTableHref(path, {}, { returnTo: back === base ? undefined : back });
}

type CreditAllocationRow = { amount: Decimal.Value; bill: { status: string } };

/**
 * Split a credit's allocations by target bill state: only frozen (non-DRAFT) bills count as
 * deducted; DRAFT allocations are provisional because regeneration may still move them.
 */
export function creditAllocationSummary(credit: { requestedAmount: Decimal.Value; allocations: ReadonlyArray<CreditAllocationRow> }) {
  const zero = new Decimal(0);
  const confirmed = credit.allocations.filter((row) => row.bill.status !== 'DRAFT').reduce((sum, row) => sum.plus(new Decimal(row.amount).abs()), zero);
  const pending = credit.allocations.filter((row) => row.bill.status === 'DRAFT').reduce((sum, row) => sum.plus(new Decimal(row.amount).abs()), zero);
  const requested = new Decimal(credit.requestedAmount).abs();
  return {
    requested: requested.toFixed(2),
    confirmed: confirmed.toFixed(2),
    pending: pending.toFixed(2),
    remaining: requested.minus(confirmed).minus(pending).toFixed(2),
  };
}

/** Billing screens and downloads must distinguish cancellation fees from completion. */
export function billOrderStatus(snapshot: string): StatusDefinition {
  const definition = Object.hasOwn(ORDER_STATUS_REGISTRY, snapshot)
    ? ORDER_STATUS_REGISTRY[snapshot as OrderStatus]
    : { label: '未识别配置', tone: 'neutral' as const };
  return { ...definition, label: definition.label + (snapshot === OrderStatus.CANCELLED ? '（取消费）' : '') };
}

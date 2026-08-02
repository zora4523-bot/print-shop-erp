import Decimal from 'decimal.js';
import { Role } from '../../generated/prisma/enums';

type CsSalesEntryForAttribution = {
  amount: Decimal.Value;
  salaryPeriod: {
    commissions: Array<{ tierRate: Decimal.Value }>;
  };
};

type BillItemForAttribution = {
  order: {
    submitterRole?: Role;
    csSalesEntries: CsSalesEntryForAttribution[];
  };
};

export type CsBillAttribution = {
  ledgerSales: Decimal;
  settledSales: Decimal;
  pendingSales: Decimal;
  attributedCommission: Decimal;
  settledRates: string[];
  entryCount: number;
};

/**
 * A bill belongs to the CS sales flow based on immutable order history, not
 * the account's current role. The ledger fallback also keeps migrated rows
 * visible if a historical snapshot is incomplete.
 */
export function hasCustomerServiceAttribution(
  items: BillItemForAttribution[],
): boolean {
  return items.some(
    (item) =>
      item.order.submitterRole === Role.CUSTOMER_SERVICE ||
      item.order.csSalesEntries.length > 0,
  );
}

/**
 * Attributes a CS bill from the immutable per-order sales ledger.
 *
 * A monthly receivable can contain orders submitted in different four-month
 * salary periods. Applying one rate selected from the bill month therefore
 * misstates commission. Each ledger entry instead uses the final rate of its
 * own salary period; entries in an unsettled period remain explicitly pending.
 */
export function calculateCsBillAttribution(
  items: BillItemForAttribution[],
): CsBillAttribution {
  let ledgerSales = new Decimal(0);
  let settledSales = new Decimal(0);
  let pendingSales = new Decimal(0);
  let attributedCommission = new Decimal(0);
  let entryCount = 0;
  const rates = new Set<string>();

  for (const item of items) {
    for (const entry of item.order.csSalesEntries) {
      const amount = new Decimal(entry.amount);
      const commission = entry.salaryPeriod.commissions[0];
      ledgerSales = ledgerSales.plus(amount);
      entryCount += 1;
      if (!commission) {
        pendingSales = pendingSales.plus(amount);
        continue;
      }

      const rate = new Decimal(commission.tierRate);
      const normalizedRate = rate.toFixed(4);
      rates.add(normalizedRate);
      settledSales = settledSales.plus(amount);
      attributedCommission = attributedCommission.plus(amount.times(rate));
    }
  }

  return {
    ledgerSales,
    settledSales,
    pendingSales,
    attributedCommission,
    settledRates: [...rates].sort((a, b) => new Decimal(a).cmp(b)),
    entryCount,
  };
}

import Decimal from 'decimal.js';

// Pure math for the client-service commission calculation (SPEC §5.3).
// No DB — takes an already-decoded tier schedule and a totalSales
// amount, returns the chosen tier + commission amount. Kept separate
// so unit tests don't need Prisma.
//
// Mode FLAT: whole totalSales gets the rate of the highest-reached
// tier. (Stepwise mode is P2, not implemented.)

export type CsTier = {
  minSales: string | number;
  rate: string | number;
};

export type CsTiersConfig = {
  mode: 'FLAT' | 'STEPPED';
  tiers: readonly CsTier[];
};

export type CsCommissionBreakdown = {
  // true when totalSales fell below every tier's minSales — no
  // commission. The caller still records zeros so the period shows
  // up on the "settled" list.
  belowAllTiers: boolean;
  tierIndex: number | null; // index into tiers[] of the winning tier
  tierRate: Decimal;
  commissionAmount: Decimal;
};

export function calcCsCommission(
  totalSales: string | number | Decimal,
  config: CsTiersConfig,
): CsCommissionBreakdown {
  const total = new Decimal(totalSales as Decimal.Value);

  if (config.mode !== 'FLAT') {
    // P2 hook; MVP is FLAT only per SPEC §5.3.
    throw new Error(`不支持的提成模式：${config.mode}`);
  }

  // Highest minSales <= total wins. Sort tiers descending by minSales
  // and find the first that total meets or exceeds.
  const sorted = [...config.tiers].sort(
    (a, b) => Number(b.minSales) - Number(a.minSales),
  );
  for (const tier of sorted) {
    if (total.gte(new Decimal(tier.minSales as Decimal.Value))) {
      const rate = new Decimal(tier.rate as Decimal.Value);
      const originalIdx = config.tiers.findIndex(
        (t) => t.minSales === tier.minSales && t.rate === tier.rate,
      );
      return {
        belowAllTiers: false,
        tierIndex: originalIdx,
        tierRate: rate,
        commissionAmount: total.times(rate),
      };
    }
  }

  return {
    belowAllTiers: true,
    tierIndex: null,
    tierRate: new Decimal(0),
    commissionAmount: new Decimal(0),
  };
}

// SPEC §7.3: 底薪合计 = monthlyBase * durationMonths.
// Kept as a helper so the arithmetic is visible / testable.
export function calcCsMonthlyBaseTotal(
  monthlyBase: string | number | Decimal,
  durationMonths: number,
): Decimal {
  return new Decimal(monthlyBase as Decimal.Value).times(durationMonths);
}

export function calcCsTotalIncome(
  monthlyBaseTotal: Decimal,
  commissionAmount: Decimal,
): Decimal {
  return monthlyBaseTotal.plus(commissionAmount);
}

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

  if (!total.isFinite()) {
    throw new Error('客服业绩金额非法');
  }

  if (config.mode !== 'FLAT') {
    // P2 hook; MVP is FLAT only per SPEC §5.3.
    throw new Error(`不支持的提成模式：${config.mode}`);
  }

  if (config.tiers.length === 0) {
    throw new Error('客服提成档位不能为空');
  }

  const seenThresholds = new Set<string>();
  const parsedTiers = config.tiers.map((tier, originalIndex) => {
    const minSales = new Decimal(tier.minSales as Decimal.Value);
    const rate = new Decimal(tier.rate as Decimal.Value);
    if (
      !minSales.isFinite() ||
      minSales.isNegative() ||
      minSales.decimalPlaces() > 2
    ) {
      throw new Error('客服提成档位的业绩门槛非法');
    }
    if (
      !rate.isFinite() ||
      rate.isNegative() ||
      rate.gt(1) ||
      rate.decimalPlaces() > 4
    ) {
      throw new Error('客服提成比例必须在 0% 到 100% 之间，最多四位小数');
    }
    const thresholdKey = minSales.toFixed(2);
    if (seenThresholds.has(thresholdKey)) {
      throw new Error('客服提成档位的业绩门槛不能重复');
    }
    seenThresholds.add(thresholdKey);
    return { minSales, rate, originalIndex };
  });

  // Highest minSales <= total wins. Sort tiers descending by minSales
  // and find the first that total meets or exceeds.
  const sorted = parsedTiers.sort((a, b) => b.minSales.comparedTo(a.minSales));
  for (const tier of sorted) {
    if (total.gte(tier.minSales)) {
      return {
        belowAllTiers: false,
        tierIndex: tier.originalIndex,
        tierRate: tier.rate,
        commissionAmount: total.times(tier.rate),
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

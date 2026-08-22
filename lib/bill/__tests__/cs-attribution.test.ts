import { describe, expect, it } from 'vitest';
import { OrderSettlementType } from '../../../generated/prisma/enums';
import {
  calculateCsBillAttribution,
  hasCustomerServiceAttribution,
} from '../cs-attribution';

describe('calculateCsBillAttribution', () => {
  it('uses each sales entry own settled period rate', () => {
    const result = calculateCsBillAttribution([
      {
        order: {
          csSalesEntries: [
            {
              amount: '1000.00',
              salaryPeriod: { commissions: [{ tierRate: '0.0100' }] },
            },
            {
              amount: '2000.00',
              salaryPeriod: { commissions: [{ tierRate: '0.0600' }] },
            },
          ],
        },
      },
    ]);

    expect(result.ledgerSales.toFixed(2)).toBe('3000.00');
    expect(result.settledSales.toFixed(2)).toBe('3000.00');
    expect(result.attributedCommission.toFixed(2)).toBe('130.00');
    expect(result.settledRates).toEqual(['0.0100', '0.0600']);
  });

  it('keeps unsettled and cancellation adjustments visible', () => {
    const result = calculateCsBillAttribution([
      {
        order: {
          csSalesEntries: [
            {
              amount: '500.00',
              salaryPeriod: { commissions: [] },
            },
            {
              amount: '-100.00',
              salaryPeriod: { commissions: [{ tierRate: '0.0200' }] },
            },
          ],
        },
      },
    ]);

    expect(result.ledgerSales.toFixed(2)).toBe('400.00');
    expect(result.pendingSales.toFixed(2)).toBe('500.00');
    expect(result.settledSales.toFixed(2)).toBe('-100.00');
    expect(result.attributedCommission.toFixed(2)).toBe('-2.00');
    expect(result.entryCount).toBe(2);
  });

  it('does not invent attribution for pre-ledger bills', () => {
    const result = calculateCsBillAttribution([
      { order: { csSalesEntries: [] } },
    ]);

    expect(result.entryCount).toBe(0);
    expect(result.ledgerSales.toFixed(2)).toBe('0.00');
    expect(result.settledRates).toEqual([]);
  });
});

describe('hasCustomerServiceAttribution', () => {
  it('uses the immutable internal-sales settlement path', () => {
    expect(
      hasCustomerServiceAttribution([
        {
          order: {
            settlementType: OrderSettlementType.INTERNAL_SALES,
            csSalesEntries: [],
          },
        },
      ]),
    ).toBe(true);
  });

  it('does not turn an external-sales receivable into internal commission', () => {
    expect(
      hasCustomerServiceAttribution([
        {
          order: {
            settlementType: OrderSettlementType.EXTERNAL_SALES,
            csSalesEntries: [],
          },
        },
      ]),
    ).toBe(false);
  });

  it('keeps migrated CS ledger rows visible as a history fallback', () => {
    expect(
      hasCustomerServiceAttribution([
        {
          order: {
            settlementType: OrderSettlementType.EXTERNAL_SALES,
            csSalesEntries: [
              {
                amount: '1.00',
                salaryPeriod: { commissions: [] },
              },
            ],
          },
        },
      ]),
    ).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { OrderCostCategory } from '../../../generated/prisma/enums';
import {
  calculateOrderCostBreakdown,
  listOrderCostEntryDetails,
} from '../costing';

describe('calculateOrderCostBreakdown', () => {
  it('adds direct and rework costs without double-counting manual automatic categories', () => {
    const result = calculateOrderCostBreakdown({
      items: [{ tasks: [{ pieceworkAmount: '20.00' }] }],
      outsourceOrders: [{ amount: '30.00' }],
      costEntries: [
        { category: OrderCostCategory.MATERIAL, amount: '40.00' },
        // Legacy rows remain auditable but must not duplicate the 20/30 above.
        { category: OrderCostCategory.PIECEWORK, amount: '20.00' },
        { category: OrderCostCategory.OUTSOURCE, amount: '30.00' },
      ],
      reworkOrders: [
        {
          items: [{ tasks: [{ pieceworkAmount: '5.00' }] }],
          outsourceOrders: [{ amount: '6.00' }],
          costEntries: [
            { category: OrderCostCategory.SHIPPING, amount: '7.00' },
            { category: OrderCostCategory.PIECEWORK, amount: '5.00' },
          ],
        },
      ],
    });

    expect(result.piecework.toFixed(2)).toBe('20.00');
    expect(result.pieceworkSource).toBe('automatic');
    expect(result.outsource.toFixed(2)).toBe('30.00');
    expect(result.outsourceSource).toBe('automatic');
    expect(result.manual.toFixed(2)).toBe('40.00');
    expect(result.rework.toFixed(2)).toBe('18.00');
    expect(result.totalCost.toFixed(2)).toBe('108.00');
  });

  it('lists included original and rework entries with their source order for reconciliation', () => {
    const createdAt = new Date('2026-08-02T04:00:00.000Z');
    const order = {
      id: 'order-1',
      orderNo: '20260802-0001',
      items: [],
      outsourceOrders: [],
      costEntries: [
        {
          id: 'cost-original',
          category: OrderCostCategory.MATERIAL,
          description: '原单纸张',
          quantity: '2.000',
          unit: '包',
          unitPrice: '20.0000',
          amount: '40.00',
          remark: null,
          createdAt,
          createdBy: { displayName: '管理员' },
        },
      ],
      reworkOrders: [
        {
          id: 'rework-1',
          orderNo: 'RW-20260802-0001',
          items: [{ tasks: [{ pieceworkAmount: '5.00' }] }],
          outsourceOrders: [],
          costEntries: [
            {
              id: 'cost-rework',
              category: OrderCostCategory.SHIPPING,
              description: '重做补发运费',
              quantity: null,
              unit: null,
              unitPrice: null,
              amount: '7.00',
              remark: '物流损毁',
              createdAt,
              createdBy: { displayName: '财务' },
            },
            {
              id: 'legacy-piecework',
              category: OrderCostCategory.PIECEWORK,
              description: '历史重做计件',
              quantity: null,
              unit: null,
              unitPrice: null,
              amount: '5.00',
              remark: null,
              createdAt,
              createdBy: { displayName: '财务' },
            },
          ],
        },
      ],
    };

    const details = listOrderCostEntryDetails(order);
    expect(details.map((detail) => ({
      id: detail.entry.id,
      source: detail.source,
      sourceOrderNo: detail.sourceOrderNo,
      included: detail.includedInCostTotal,
    }))).toEqual([
      {
        id: 'cost-original',
        source: 'original',
        sourceOrderNo: '20260802-0001',
        included: true,
      },
      {
        id: 'cost-rework',
        source: 'rework',
        sourceOrderNo: 'RW-20260802-0001',
        included: true,
      },
      {
        id: 'legacy-piecework',
        source: 'rework',
        sourceOrderNo: 'RW-20260802-0001',
        included: false,
      },
    ]);

    const includedLedgerTotal = details.reduce(
      (sum, detail) =>
        detail.includedInCostTotal
          ? sum.plus(detail.entry.amount)
          : sum,
      new Decimal(0),
    );
    const breakdown = calculateOrderCostBreakdown(order);
    expect(includedLedgerTotal.toFixed(2)).toBe('47.00');
    expect(breakdown.totalCost.toFixed(2)).toBe('52.00');
    expect(breakdown.totalCost.minus(includedLedgerTotal).toFixed(2)).toBe(
      '5.00',
    );
  });

  it('keeps signed adjustment entries in the total', () => {
    const result = calculateOrderCostBreakdown({
      items: [],
      outsourceOrders: [],
      costEntries: [
        { category: OrderCostCategory.MATERIAL, amount: '100.00' },
        { category: OrderCostCategory.ADJUSTMENT, amount: '-20.00' },
      ],
      reworkOrders: [],
    });
    expect(result.totalCost.toFixed(2)).toBe('80.00');
  });

  it('uses legacy piecework and outsource rows when no automatic ledger exists', () => {
    const result = calculateOrderCostBreakdown({
      items: [],
      outsourceOrders: [],
      costEntries: [
        { category: OrderCostCategory.PIECEWORK, amount: '20.00' },
        { category: OrderCostCategory.OUTSOURCE, amount: '30.00' },
      ],
      reworkOrders: [],
    });

    expect(result.piecework.toFixed(2)).toBe('20.00');
    expect(result.pieceworkSource).toBe('legacy');
    expect(result.outsource.toFixed(2)).toBe('30.00');
    expect(result.outsourceSource).toBe('legacy');
    expect(result.manual.toFixed(2)).toBe('0.00');
    expect(result.totalCost.toFixed(2)).toBe('50.00');
  });

  it('treats a completed zero-value task as automatic piecework evidence', () => {
    const result = calculateOrderCostBreakdown({
      items: [{ tasks: [{ pieceworkAmount: '0.00' }] }],
      outsourceOrders: [],
      costEntries: [
        { category: OrderCostCategory.PIECEWORK, amount: '20.00' },
      ],
      reworkOrders: [],
    });

    expect(result.manual.toFixed(2)).toBe('0.00');
    expect(result.totalCost.toFixed(2)).toBe('0.00');
  });

  it('uses the operation-report generation exclusively and includes PACKING', () => {
    const result = calculateOrderCostBreakdown({
      productionOperations: [
        { reports: [{ amount: '12.00' }, { amount: '-2.00' }] },
        { reports: [{ amount: '0.50' }] },
      ],
      // Transitional legacy evidence may coexist, but must never be added.
      items: [{ tasks: [{ pieceworkAmount: '99.00' }] }],
      outsourceOrders: [],
      costEntries: [
        { category: OrderCostCategory.PIECEWORK, amount: '88.00' },
      ],
      reworkOrders: [],
    });

    expect(result.piecework.toFixed(2)).toBe('10.50');
    expect(result.pieceworkSource).toBe('automatic');
    expect(result.manual.toFixed(2)).toBe('0.00');
    expect(result.totalCost.toFixed(2)).toBe('10.50');
  });

  it('falls back to a legacy outsource row until an automatic amount is posted', () => {
    const withoutPostedAmount = calculateOrderCostBreakdown({
      items: [],
      outsourceOrders: [{ amount: null }],
      costEntries: [
        { category: OrderCostCategory.OUTSOURCE, amount: '30.00' },
      ],
      reworkOrders: [],
    });
    expect(withoutPostedAmount.totalCost.toFixed(2)).toBe('30.00');

    const withPostedAmount = calculateOrderCostBreakdown({
      items: [],
      outsourceOrders: [{ amount: '0.00' }],
      costEntries: [
        { category: OrderCostCategory.OUTSOURCE, amount: '30.00' },
      ],
      reworkOrders: [],
    });
    expect(withPostedAmount.totalCost.toFixed(2)).toBe('0.00');
  });
});

describe('completion-only wage evidence shared by analytics and billing', () => {
  it.each(['5.00', '0.00'])('treats priced wage %s as authoritative and suppresses historical manual piecework', amount => {
    const result = calculateOrderCostBreakdown({ items: [], productionOperations: [], productionJobs: [{ wages: [{ amount }] }], outsourceOrders: [], costEntries: [{ category: OrderCostCategory.PIECEWORK, amount: '90.00' }], reworkOrders: [] });
    expect(result.piecework.toFixed(2)).toBe(amount);
    expect(result.pieceworkSource).toBe('automatic');
  });
  it('retains historical evidence while a wage is still unpriced', () => {
    const result = calculateOrderCostBreakdown({ items: [], productionJobs: [{ wages: [{ amount: null }] }], outsourceOrders: [], costEntries: [{ category: OrderCostCategory.PIECEWORK, amount: '90.00' }], reworkOrders: [] });
    expect(result.piecework.toFixed(2)).toBe('90.00');
    expect(result.pieceworkSource).toBe('legacy');
  });
});

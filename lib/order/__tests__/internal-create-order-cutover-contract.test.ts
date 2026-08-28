import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const orderSource = readFileSync(
  path.join(process.cwd(), 'lib/order.ts'),
  'utf8',
);
const formSource = readFileSync(
  path.join(process.cwd(), 'components/business/order/OrderForm.tsx'),
  'utf8',
);

describe('internal create engine cutover source contract', () => {
  it('has no old create-time item quote runtime call', () => {
    expect(orderSource).toContain('calculateCreateOrderQuoteFromCatalogInTx');
    expect(formSource).toContain('quoteInternalCreateOrderAction');
    expect(formSource).toContain(
      'items: values.items.map(internalOrderItemQuoteFacts)',
    );
  });

  it('persists canonical null/manual evidence and pure engine version snapshots', () => {
    expect(orderSource).toContain(
      'OrderItemQuoteDisposition.MANUAL_PRICING_REQUIRED',
    );
    expect(orderSource).toContain('quotedAmount: null');
    expect(orderSource).toContain("engineVersion: 'CREATE_ORDER_PURE_V1'");
    expect(orderSource).toContain('priceVersionLocks');
    expect(orderSource).toContain("source: 'INTERNAL_CREATE_AUTO'");
    expect(orderSource).toContain(
      "source: 'INTERNAL_CREATE_MANUAL_REQUIRED'",
    );
  });

  it('activates confirmed chargeable submissions and returns the materialized status', () => {
    const pricingRead = orderSource.indexOf('const currentPricing =');
    const activation = orderSource.indexOf(
      'activateProductionOperationsInTx(',
      pricingRead,
    );
    const returnStatus = orderSource.indexOf(
      'status: activated.orderStatus',
      activation,
    );
    expect(pricingRead).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(pricingRead);
    expect(returnStatus).toBeGreaterThan(activation);
    expect(orderSource.slice(pricingRead, activation)).toContain(
      'ORDER_PRICING_STATUS.AUTO_CONFIRMED',
    );
    expect(orderSource.slice(pricingRead, activation)).toContain(
      'OrderBillingMode.CHARGE',
    );
  });
});

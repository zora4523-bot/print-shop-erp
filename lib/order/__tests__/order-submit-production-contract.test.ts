import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const orderSource = readFileSync(
  path.join(process.cwd(), 'lib/order.ts'),
  'utf8',
);

describe('order submission source contract', () => {
  it('prepares submissions without automatic production release', () => {
    const pricingRead = orderSource.indexOf('const currentPricing =');
    const activation = orderSource.indexOf(
      'prepareOrderForProductionInTx(',
      pricingRead,
    );
    const returnStatus = orderSource.indexOf(
      'status: prepared.status',
      activation,
    );
    expect(pricingRead).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(pricingRead);
    expect(returnStatus).toBeGreaterThan(activation);
    expect(orderSource).not.toContain('await activateProductionOperationsInTx(');
  });
});

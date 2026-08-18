import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'order',
    'OrderForm.tsx',
  ),
  'utf8',
);

describe('OrderForm logistics quote authority', () => {
  it('requests the authoritative server quote instead of calculating bundled defaults', () => {
    expect(source).toContain(
      "import { quoteExternalOrderChargesAction } from '@/actions/order-logistics-quote';",
    );
    expect(source).toContain(
      'const response = await quoteExternalOrderChargesAction(input);',
    );
    expect(source).not.toContain('calculateExternalOrderCharges(input)');
    expect(source).not.toContain('DEFAULT_EXTERNAL_ORDER_CHARGE_RULES');
  });

  it('does not apply an async quote after its shipment facts become stale', () => {
    expect(source).toContain(
      'if (JSON.stringify(currentLogisticsQuoteInput()) !== inputKey)',
    );
    expect(source).toContain(
      'setLogisticsQuote({ inputKey, result: response.quote });',
    );
  });

  it('writes nullable server lines so an incomplete re-quote clears old suggestions', () => {
    expect(source).toContain(
      'setValue(shippingPath, shipment.shipping.amount, {',
    );
    expect(source).toContain(
      'setValue(packingPath, shipment.packaging.amount, {',
    );
  });

  it('marks edited fees as adjusted and blocks submission while quoting', () => {
    expect(source).toContain('logisticsQuoteAmountsAdjusted');
    expect(source).toContain('实际快递费或耗材费已调整');
    expect(source).toMatch(
      /type="submit"[\s\S]{0,180}disabled=\{[\s\S]{0,180}logisticsQuoting/,
    );
  });
});

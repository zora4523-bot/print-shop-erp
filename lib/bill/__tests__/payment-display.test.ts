import { describe, expect, it } from 'vitest';
import { isLegacyOpeningBillPayment } from '../payment-display';

describe('isLegacyOpeningBillPayment', () => {
  it('recognizes only deterministic migration opening receipts', () => {
    expect(
      isLegacyOpeningBillPayment({
        idempotencyKey: 'migration:20260802:bill-payment:bill-1',
      }),
    ).toBe(true);
    expect(
      isLegacyOpeningBillPayment({
        idempotencyKey: '5f36c1df-a5ae-4b75-b15f-6c661daf95f5',
      }),
    ).toBe(false);
  });
});

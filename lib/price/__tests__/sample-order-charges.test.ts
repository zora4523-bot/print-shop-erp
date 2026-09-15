import { describe, expect, it } from 'vitest';
import {
  calculateExternalOrderCharges,
  type ExternalOrderChargeRule,
} from '../external-order-charges';
import {
  DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
  DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
} from './fixtures/external-order-charge-fixtures';

const tiers = DEFAULT_EXTERNAL_ORDER_CHARGE_RULES.filter(
  (rule) => rule.kind === 'PACKAGING',
).sort((a, b) => a.maxQty - b.maxQty);
const shipment = {
  shipmentKey: '1',
  province: '浙江',
  billableWeightKg: '1',
  itemQuantity: 3000,
};
function quote(
  ruleCode: string | null,
  rules: readonly ExternalOrderChargeRule[] = DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
) {
  return calculateExternalOrderCharges(
    {
      isSfCollect: false,
      samplePackaging: { ruleCode },
      shipments: [shipment],
    },
    rules,
    DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
  );
}
describe('sample shipment charges', () => {
  it('uses the smallest published tier without changing real quantity or shipping', () => {
    const result = quote(null);
    expect(result.shipments[0].packaging.amount).toBe(
      Number(tiers[0].amount).toFixed(2),
    );
    expect(result.shipments[0].packaging.basis.orderTotalQuantity).toBe(3000);
    const standard = calculateExternalOrderCharges(
      { isSfCollect: false, shipments: [shipment] },
      DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
      DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
    );
    expect(result.shipments[0].shipping).toEqual(
      standard.shipments[0].shipping,
    );
    expect(result.shipments[0].packaging.amount).not.toBe(
      standard.shipments[0].packaging.amount,
    );
  });
  it('honors a larger published selection and rejects unavailable codes', () => {
    expect(quote(tiers[1].code).shipments[0].packaging.amount).toBe(
      Number(tiers[1].amount).toFixed(2),
    );
    expect(quote('MISSING').suggestedTotal).toBeNull();
    expect(quote('MISSING').errors.join()).toContain('重新选择包装');
  });
  it('uses new rule values, not a hardcoded minimum price', () => {
    const result = quote(
      null,
      DEFAULT_EXTERNAL_ORDER_CHARGE_RULES.map((rule) =>
        rule.code === tiers[0].code ? { ...rule, amount: '9.87' } : rule,
      ),
    );
    expect(result.shipments[0].packaging.amount).toBe('9.87');
  });
  it('leaves unweighed prepaid freight pending and never makes it free', () => {
    const result = calculateExternalOrderCharges(
      {
        isSfCollect: false,
        samplePackaging: { ruleCode: null },
        shipments: [
          { ...shipment, requiresActualWeight: true, billableWeightKg: null },
        ],
      },
      DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
      DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
    );
    expect(result.suggestedShippingTotal).toBeNull();
    expect(result.suggestedTotal).toBeNull();
  });
  it('retains one order packaging charge with multiple SF collect destinations', () => {
    const result = calculateExternalOrderCharges(
      {
        isSfCollect: true,
        samplePackaging: { ruleCode: null },
        shipments: [shipment, { ...shipment, shipmentKey: '2' }],
      },
      DEFAULT_EXTERNAL_ORDER_CHARGE_RULES,
      DEFAULT_EXTERNAL_ORDER_LOGISTICS_POLICY,
    );
    expect(result.suggestedShippingTotal).toBe('0.00');
    expect(result.shipments[1].packaging.amount).toBe('0.00');
    expect(result.suggestedTotal).toBe(Number(tiers[0].amount).toFixed(2));
  });
});

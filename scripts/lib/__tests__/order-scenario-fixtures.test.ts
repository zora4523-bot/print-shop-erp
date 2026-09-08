import { describe, expect, it, vi } from 'vitest';
import { ORDER_SCENARIOS, buildOrderScenarioInput, scenarioSubmissionId, type ScenarioCatalog } from '../order-scenario-fixtures';
import { calculatePackagingBagCount } from '@/lib/order/packaging-bag-count';

vi.mock('@/lib/order/submit-external-order', () => ({ ExternalOrderQuoteChangedError: class extends Error {}, finalizeExternalOrderQuoteInTx: vi.fn() }));

const catalog: ScenarioCatalog = { products: { PARTIAL: 'partial', FULL: 'full', PRINT: 'print' }, crafts: { PARTIAL: 'partial', FULL: 'full', PRINT: 'print', PRINT_FOIL: 'print-foil', MANUAL: 'triple' } };
const now = new Date('2026-09-08T01:00:00Z');
describe('order scenario fixture inputs', () => {
  it.each(ORDER_SCENARIOS)('$key: uses valid creation facts with complete packaging and shipment allocation', (scenario) => {
    const input = buildOrderScenarioInput(scenario, catalog, now);
    for (const group of input.packagingGroups) {
      const result = calculatePackagingBagCount({ mode: group.mode, itemQuantities: input.items.map((item) => item.quantity), itemUnitsPerBag: group.itemUnitsPerBag });
      expect(result.complete).toBe(true);
      expect(result.bagCount).toBe(group.actualBagCount);
    }
    input.items.forEach((item, index) => {
      expect(input.packagingGroups.reduce((sum, group) => sum + group.actualBagCount * (group.itemUnitsPerBag[index] ?? 0), 0)).toBe(item.quantity);
      expect(input.additionalShipments.reduce((sum, shipment) => sum + (shipment.itemQuantities[index] ?? 0), 0)).toBeLessThan(item.quantity);
    });
    expect(input.customerRef).toBe('演示客户');
    expect(input.remark).toContain('ORDER_SCENARIO_V1');
  });
  it('has stable unique idempotency keys and Shanghai relative delivery dates', () => {
    expect(new Set(ORDER_SCENARIOS.map((s) => scenarioSubmissionId(s.key))).size).toBe(ORDER_SCENARIOS.length);
    expect(scenarioSubmissionId('partial')).toBe(scenarioSubmissionId('partial'));
    expect(buildOrderScenarioInput(ORDER_SCENARIOS[1], catalog, now).promisedDate?.toISOString().slice(0, 10)).toBe('2026-09-09');
    expect(buildOrderScenarioInput(ORDER_SCENARIOS[8], catalog, now).promisedDate).toBeNull();
  });
  it('covers all canonical routes, manual pricing, mixed styles and two shipping addresses', () => {
    const inputs = ORDER_SCENARIOS.map((s) => buildOrderScenarioInput(s, catalog, now));
    expect(new Set(inputs.flatMap((input) => input.items.map((item) => item.pricingRoute)))).toEqual(new Set(['STOCK_BLANK', 'CUSTOM_SINGLE_FLAT_FOIL', 'COLOR_PRINT']));
    expect(inputs[6]!.additionalShipments).toHaveLength(1);
    expect(inputs[6]!.packagingGroups[0]!.mode).toBe('MIXED_STYLE');
    expect(inputs[7]!.items[0]!.frontFoilColors).toHaveLength(3);
    expect(inputs[7]!.items[0]!.manualQuoteReason).toBeNull();
    expect(inputs[3]!.items[0]!.frontFoilColors).toHaveLength(1);
  });
});

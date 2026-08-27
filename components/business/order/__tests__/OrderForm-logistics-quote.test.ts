import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(process.cwd(), 'components', 'business', 'order', 'OrderForm.tsx'),
  'utf8',
);
const railSource = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'order',
    'OrderFormRail.tsx',
  ),
  'utf8',
);
const schedulingSource = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'production',
    'SchedulingForm.tsx',
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

  it('sends item facts and per-address allocations so the server derives weight', () => {
    expect(source).toContain('items: values.items.map((item, index) => ({');
    expect(source).toContain('paperWeightGsm: item.paperWeightGsm');
    expect(source).toContain('productStructure: item.productStructure');
    expect(source).toContain('itemQuantities: primaryItemQuantities');
    expect(source).toContain('itemQuantities: shipment.itemQuantities');
    expect(source).not.toContain("name: 'quotedWeightKg'");
    expect(source).not.toContain('watchedQuotedWeightKg');
  });

  it('does not apply an async quote after its shipment facts become stale', () => {
    expect(source).toContain(
      'if (JSON.stringify(currentLogisticsQuoteInput()) !== inputKey)',
    );
    expect(source).toContain(
      'setLogisticsQuote({ inputKey, result: response.quote });',
    );
  });

  it('keeps the authoritative quote as display state instead of writing external-sales fees', () => {
    expect(source).not.toContain(
      'setValue(shippingPath, shipment.shipping.amount, {',
    );
    expect(source).not.toContain(
      'setValue(packingPath, shipment.packaging.amount, {',
    );
    expect(source).toContain('<ShipmentPricingFactsFields');
    expect(source).not.toContain('factsOnly');
    expect(source).not.toContain('对客快递费（元，销售暂定）');
    expect(source).not.toContain('收费调整说明');
  });

  it('keeps every address fact editable and clears stale provinces after paste parsing', () => {
    expect(source).toContain("registration={register('receiverName')}");
    expect(source).toContain("registration={register('receiverPhone')}");
    expect(source).toContain(
      '`additionalShipments.${shipmentIndex}.receiverName`',
    );
    expect(source).toContain(
      '`additionalShipments.${shipmentIndex}.receiverPhone`',
    );
    expect(source).toContain(
      '`additionalShipments.${shipmentIndex}.destinationProvince`',
    );
    expect(source).toContain("setValue('destinationProvince', parsed.province");
    expect(source).not.toContain('if (parsed.province)');
  });

  it('removes unreachable manual-fee adjustment state and blocks submission while quoting', () => {
    expect(source).not.toContain('logisticsQuoteAmountsAdjusted');
    expect(source).not.toContain('实际快递费或耗材费已调整');
    expect(source).toMatch(
      /type="submit"[\s\S]{0,180}disabled=\{[\s\S]{0,180}logisticsQuoting/,
    );
    expect(source).toContain(
      'if (createdDraft || quoting || logisticsQuoting) return;',
    );
  });

  it('announces every pending phase and prevents unsafe navigation during writes', () => {
    expect(source).toContain('aria-busy={pendingState.busy}');
    expect(source).toContain(
      'aria-disabled={pendingState.lockNavigation || undefined}',
    );
    expect(source).toContain(
      "'pointer-events-none cursor-not-allowed opacity-50'",
    );
  });
});

describe('OrderForm processing quote concurrency', () => {
  it('rejects an older request and never applies a response to changed facts', () => {
    expect(source).toContain(
      'latestQuoteRequestByField.current[fieldId] !== requestId',
    );
    expect(source).toContain(
      'quoteFactsKey(getValues(`items.${index}`)) === inputKey',
    );
    expect(source).toMatch(/result\.complete\s*&&\s*factsStillCurrent/);
  });

  it('offers only business routes and clears any historical manual reason', () => {
    expect(source).toContain('NEW_ORDER_PRICING_ROUTES.map');
    expect(source).not.toContain('value={OrderItemPricingRoute.MANUAL_QUOTE}');
    expect(source).toContain('`items.${index}.manualQuoteReason`');
    expect(source).toContain('manualQuoteReason: null');
  });
});

describe('OrderForm local draft recovery', () => {
  it('requires an explicit restore/discard decision before enabling the form', () => {
    expect(source).toContain('恢复本地草稿');
    expect(source).toContain('放弃本地草稿');
    expect(source).toContain('reset(pendingLocalDraft.values');
    expect(source).toMatch(
      /<fieldset[\s\S]{0,120}disabled=\{!localDraftReady \|\| submitting \|\| uploading\}/,
    );
    expect(source).not.toContain('reset(draft.values');
  });

  it('throttles serializable RHF saves, shows the timestamp, and clears after server creation', () => {
    expect(source).toContain('serializeLocalOrderFormDraft(');
    expect(source).toContain('localDraftPricingScope');
    expect(source).toContain('watchedFormValues');
    expect(source).toContain('}, 900);');
    expect(source).toContain('本地草稿已保存');
    expect(source).toContain('clearLocalDraftAfterServerCreate();');
    expect(source).toContain(
      'window.localStorage.removeItem(localDraftStorageKey)',
    );
  });
});

describe('OrderForm style tabs and shared controls', () => {
  it('uses the complete style-tab contract with roving focus and arrow/home/end keys', () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('aria-controls={`order-item-${index}-editor`}');
    expect(source).toContain('tabIndex={active ? 0 : -1}');
    expect(source).toContain('handleItemTabKeyDown(event, index)');
    expect(source).toContain("event.key === 'ArrowRight'");
    expect(source).toContain("event.key === 'ArrowLeft'");
    expect(source).toContain("event.key === 'Home'");
    expect(source).toContain("event.key === 'End'");
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain('＋ 添加款式');
    expect(source).toContain('复制当前');
    expect(source).toContain('删除当前');
    expect(source).toMatch(
      /role="tablist"[\s\S]*?\}\)\}\s*<\/div>\s*<div[\s\S]{0,180}role="group"[\s\S]{0,80}aria-label="款式操作"/,
    );
    expect(source.indexOf('aria-label="款式操作"')).toBeLessThan(
      source.indexOf('＋ 添加款式'),
    );
    expect(source).not.toContain('order-step-');
    expect(source).not.toContain('上一步');
    expect(source).not.toContain('下一步');
  });

  it('routes custom clickable controls through the shared Button component', () => {
    expect(source).not.toContain('<button');
    expect(railSource).not.toContain('<button');
    expect(schedulingSource).not.toContain('<button');
  });
});

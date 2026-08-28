import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  beginOrderQuoteRequest,
  createOrderQuoteRequestGate,
  invalidateOrderQuoteRequests,
  isCurrentOrderQuoteResponse,
} from '../create-order-quote-request';

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
    'ExternalSalesOrderFormRail.tsx',
  ),
  'utf8',
);
const formBSource = readFileSync(
  path.join(
    process.cwd(),
    'components',
    'business',
    'order',
    'order-form-b',
    'ExternalSalesOrderFormB.tsx',
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
  it('requests one authoritative server quote for items, packaging, and logistics', () => {
    expect(source).toContain(
      "import { quoteExternalCreateOrderAction } from '@/actions/create-order-quote';",
    );
    expect(source).toContain('quoteExternalCreateOrderAction(input)');
    expect(source).not.toContain('quoteExternalOrderChargesAction');
    expect(source).not.toContain('quoteOrderPackagingGroupsAction');
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
    expect(source).toContain('isCurrentOrderQuoteResponse({');
    expect(source).toContain(
      'currentInputKey: currentExternalQuoteInput().factsKey',
    );
    expect(source).toContain('currentFieldIds: itemFieldIdsRef.current');
  });

  it('keeps the authoritative quote as display state instead of writing external-sales fees', () => {
    expect(source).not.toContain(
      'setValue(shippingPath, shipment.shipping.amount, {',
    );
    expect(source).not.toContain(
      'setValue(packingPath, shipment.packaging.amount, {',
    );
    expect(source).toContain('const railLogistics = usesExternalSalesPricing');
    expect(railSource).toContain("{packaging.label ?? '入袋'}");
    expect(railSource).toContain("{logistics?.packagingLabel ?? '纸箱耗材'}");
    expect(railSource).toContain("{logistics?.shippingLabel ?? '快递费'}");
    expect(railSource).toContain('当前合计');
    expect(source).not.toContain('对客快递费（元，销售暂定）');
    expect(source).not.toContain('收费调整说明');
  });

  it('keeps every address fact editable and updates provinces after paste parsing', () => {
    expect(formBSource).toContain('onReceiverNameChange');
    expect(formBSource).toContain('onReceiverPhoneChange');
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
    expect(source).toContain('busy={');
    expect(source).toContain('pendingState.busy ||');
    expect(source).toMatch(
      /if\s*\(\s*createdDraft\s*\|\|\s*quoting\s*\|\|\s*externalQuoteQuoting\s*\|\|\s*externalQuoteNeedsRefresh\s*\)\s*\{\s*return;\s*\}/,
    );
  });

  it('announces pending writes and keeps the B rail disabled while totals are settling', () => {
    expect(source).toContain('aria-busy={pendingState.busy}');
    expect(railSource).toContain('disabled={busy}');
  });
});

describe('unified create-order quote request gate', () => {
  it('accepts only the newest response for the same full-order facts', () => {
    const gate = createOrderQuoteRequestGate();
    const oldRequestId = beginOrderQuoteRequest(gate);
    const newRequestId = beginOrderQuoteRequest(gate);
    const shared = {
      gate,
      inputKey: 'new',
      currentInputKey: 'new',
      fieldIds: ['fig-1', 'fig-3'],
      currentFieldIds: ['fig-1', 'fig-3'],
    };

    expect(
      isCurrentOrderQuoteResponse({ ...shared, requestId: oldRequestId }),
    ).toBe(false);
    expect(
      isCurrentOrderQuoteResponse({ ...shared, requestId: newRequestId }),
    ).toBe(true);
  });

  it('rejects a response after facts, row identity, or request validity changes', () => {
    const gate = createOrderQuoteRequestGate();
    const requestId = beginOrderQuoteRequest(gate);
    const base = {
      gate,
      requestId,
      inputKey: 'before',
      currentInputKey: 'after',
      fieldIds: ['fig-1'],
      currentFieldIds: ['fig-1'],
    };
    expect(isCurrentOrderQuoteResponse(base)).toBe(false);
    expect(
      isCurrentOrderQuoteResponse({
        ...base,
        currentInputKey: 'before',
        currentFieldIds: ['fig-2'],
      }),
    ).toBe(false);
    invalidateOrderQuoteRequests(gate);
    expect(
      isCurrentOrderQuoteResponse({
        ...base,
        currentInputKey: 'before',
      }),
    ).toBe(false);
  });
});

describe('OrderForm processing quote concurrency', () => {
  it('rejects an older request and never writes preview money into create fields', () => {
    expect(source).toContain(
      'latestQuoteRequestByField.current[fieldId] !== requestId',
    );
    expect(source).toContain('if (!sameRow) {');
    expect(source).not.toContain(
      'setValue(`items.${index}.unitPrice`, result.suggestedUnitPrice',
    );
    expect(source).not.toContain(
      'setValue(`items.${index}.fixedFee`, result.suggestedFixedFee',
    );
  });

  it('invalidates all dependent quotes and immediately saves structural changes', () => {
    expect(source).toContain('latestQuoteRequestByField.current = {};');
    expect(source).toContain(
      'invalidateOrderQuoteRequests(externalQuoteRequestGate.current);',
    );
    expect(source).toContain('setQuoteViews({});');
    expect(source).toContain('setLogisticsQuote(null);');
    expect(source).toContain('setPackagingQuote(null);');
    expect(source).toContain('persistLocalDraftValues({');
    expect(source).toContain('onRemove={(index) => {');
  });

  it('offers only B business routes and reserves configuration-outside notes for internal create', () => {
    expect(formBSource).toContain('options={ROUTE_OPTIONS}');
    expect(formBSource).not.toContain('OrderItemPricingRoute.MANUAL_QUOTE');
    expect(source).toContain(
      'manualQuoteReason: usesExternalSalesPricing',
    );
    expect(source).toContain(': item.manualQuoteReason');
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
    expect(source).toContain('草稿已保存 ${formatLocalDraftTime');
    expect(source).toContain('clearLocalDraftAfterServerCreate();');
    expect(source).toContain(
      'window.localStorage.removeItem(localDraftStorageKey)',
    );
  });
});

describe('OrderForm B style navigation and shared controls', () => {
  it('uses the B style navigation and removes the retired tab-panel contract', () => {
    expect(formBSource).toContain('aria-label="款式"');
    expect(formBSource).toContain('＋ 加款');
    expect(formBSource).toContain('⧉ 复制当前');
    expect(formBSource).toContain('删除当前');
    expect(source).not.toContain('role="tablist"');
    expect(source).not.toContain('handleItemTabKeyDown');
  });

  it('routes custom clickable controls through the shared Button component', () => {
    expect(source).not.toContain('<button');
    expect(railSource).not.toContain('<button');
    expect(formBSource).not.toContain('<button');
    expect(schedulingSource).not.toContain('<button');
  });
});

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

describe('OrderForm processing quote concurrency', () => {
  it('rejects an older request and never applies a response to changed facts', () => {
    expect(source).toContain(
      'latestQuoteRequestByField.current[fieldId] !== requestId',
    );
    expect(source).toContain(
      'quoteFactsKey(getValues(`items.${index}`)) === inputKey',
    );
    expect(source).toContain('result.complete && factsStillCurrent');
  });
});

describe('OrderForm local draft recovery', () => {
  it('requires an explicit restore/discard decision before enabling the form', () => {
    expect(source).toContain('恢复本地草稿');
    expect(source).toContain('放弃本地草稿');
    expect(source).toContain('reset(pendingLocalDraft.values');
    expect(source).toContain('disabled={!localDraftReady}');
    expect(source).not.toContain('reset(draft.values');
  });

  it('throttles serializable RHF saves, shows the timestamp, and clears after server creation', () => {
    expect(source).toContain('serializeLocalOrderFormDraft(');
    expect(source).toContain('watchedFormValues');
    expect(source).toContain('}, 900);');
    expect(source).toContain('本地草稿已保存');
    expect(source).toContain('clearLocalDraftAfterServerCreate();');
    expect(source).toContain(
      'window.localStorage.removeItem(localDraftStorageKey)',
    );
  });
});

describe('OrderForm step tabs and shared controls', () => {
  it('uses the complete tab contract with roving focus and arrow/home/end keys', () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('aria-controls={`order-step-${key}-panel`}');
    expect(source).toContain('tabIndex={active ? 0 : -1}');
    expect(source).toContain("event.key === 'ArrowRight'");
    expect(source).toContain("event.key === 'ArrowLeft'");
    expect(source).toContain("event.key === 'Home'");
    expect(source).toContain("event.key === 'End'");
    expect(source).toContain('role="tabpanel"');
  });

  it('routes custom clickable controls through the shared Button component', () => {
    expect(source).not.toContain('<button');
    expect(railSource).not.toContain('<button');
    expect(schedulingSource).not.toContain('<button');
  });
});

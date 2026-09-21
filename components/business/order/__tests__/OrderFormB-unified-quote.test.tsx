import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderSettlementType } from '@/generated/prisma/enums';
import type { CreateOrderQuoteActionInput } from '@/actions/create-order-quote.types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/actions/order', () => ({
  createOrderAction: vi.fn(),
  submitOrderAction: vi.fn(),
}));
vi.mock('@/actions/create-order-quote', () => ({
  quoteExternalCreateOrderAction: vi.fn(),
  quoteInternalCreateOrderAction: vi.fn(),
  quoteSampleOrderAction: vi.fn(),
}));
vi.mock('@/actions/workbench', () => ({ quoteWorkbenchItemAction: vi.fn() }));
vi.mock('@/actions/design-upload', () => ({ deleteOrderItemDesignAction: vi.fn() }));
vi.mock('../design-upload-client', () => ({
  uploadOrderItemDesignFile: vi.fn(),
}));

import { quoteExternalCreateOrderAction } from '@/actions/create-order-quote';
import {
  compactOrderQuoteFactsKey,
  quoteFactsKey,
} from '../OrderForm';
import { OrderFormBRail } from '../ExternalSalesOrderFormRail';
import {
  beginOrderQuoteRequest,
  createOrderQuoteRequestGate,
  isCurrentOrderQuoteResponse,
} from '../create-order-quote-request';

const orderFormSource = readFileSync(
  path.join(process.cwd(), 'components', 'business', 'order', 'OrderForm.tsx'),
  'utf8',
);

type QuoteActionResponse = Awaited<
  ReturnType<typeof quoteExternalCreateOrderAction>
>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function successResponse(
  factsKey: string,
  knownTotal: string,
): QuoteActionResponse {
  return {
    status: 'success',
    quote: {
      factsKey,
      knownTotal,
    },
  } as QuoteActionResponse;
}

function quoteInput(args: {
  quantities: readonly number[];
  actualBagCount: number;
  province: string;
}): CreateOrderQuoteActionInput {
  const orderItemCount = args.quantities.length;
  const items = args.quantities.map((quantity, index) => ({
    productId: `product-${index + 1}`,
    specification: '大号封',
    paperType: '触感纸',
    paperWeightGsm: 200,
    quantity,
    crafts: ['craft-local-foil'],
  })) as CreateOrderQuoteActionInput['items'];
  const packagingGroups = [
    {
      groupKey: '1',
      mode: 'SINGLE_STYLE',
      actualBagCount: args.actualBagCount,
    },
  ] as CreateOrderQuoteActionInput['packagingGroups'];
  const logistics = {
    isSfCollect: false,
    items: items.map((item, index) => ({
      itemKey: String(index + 1),
      quantity: item.quantity,
      paperWeightGsm: item.paperWeightGsm,
      paperType: item.paperType,
      productStructure: item.productStructure,
    })),
    shipments: [
      {
        shipmentKey: '1',
        province: args.province,
        billableWeightKg: null,
        itemQuantity: args.quantities.reduce(
          (total, quantity) => total + quantity,
          0,
        ),
        itemQuantities: [...args.quantities],
      },
    ],
  } as CreateOrderQuoteActionInput['logistics'];
  const itemFacts = items.map((item) =>
    quoteFactsKey(item, orderItemCount),
  );
  const factsKey = compactOrderQuoteFactsKey({
    itemFacts,
    packaging: JSON.stringify({ groups: packagingGroups }),
    logistics: JSON.stringify(logistics),
    openedPriceVersion: { processing: 7, logistics: 3 },
  });

  return {
    factsKey,
    settlementType: OrderSettlementType.EXTERNAL_SALES,
    items,
    orderItemCount,
    packagingGroups,
    logistics,
  };
}

describe('OrderForm B unified external-sales quote', () => {
  it.each(['manualQuoteReason', 'artworkVersion'] as const)(
    'keeps %s blank DOM input and restored null draft on the same quote key',
    (field) => {
      const watched = { quantity: 1000, [field]: null };
      const registered = { ...watched, [field]: '' };
      expect(quoteFactsKey(watched, 1)).toBe(quoteFactsKey(registered, 1));
      expect(quoteFactsKey(watched, 1)).toBe(
        quoteFactsKey({ ...watched, [field]: '  ' }, 1),
      );
      expect(quoteFactsKey(watched, 1)).not.toBe(
        quoteFactsKey({ ...watched, [field]: '需核实' }, 1),
      );
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds one action request from real item-count, packaging, and logistics facts', () => {
    const builderStart = orderFormSource.indexOf(
      'const currentExternalQuoteInput = useCallback(() => {',
    );
    const builderEnd = orderFormSource.indexOf(
      'const currentExternalQuoteRequestReady',
      builderStart,
    );
    const builder = orderFormSource.slice(builderStart, builderEnd);

    expect(builderStart).toBeGreaterThan(-1);
    expect(builderEnd).toBeGreaterThan(builderStart);
    expect(builder).toContain('items: values.items.map(orderItemQuoteFacts)');
    expect(builder).toContain('orderItemCount: values.items.length');
    expect(builder).toContain('packagingGroups: packaging.groups');
    expect(builder).toContain('logistics,');
    expect(orderFormSource).toContain(
      'const response = await quoteExternalCreateOrderAction(input)',
    );
    expect(orderFormSource).toContain('setQuoteViews(');
    expect(orderFormSource).toContain('setPackagingQuote({');
    expect(orderFormSource).toContain('setLogisticsQuote({');
    expect(orderFormSource).toContain('setExternalOrderQuote({');
    expect(orderFormSource).toContain('<OrderFormB');
    expect(orderFormSource).not.toContain('<OrderFormC');
    expect(orderFormSource).toContain(
      'externalCreateOrderOptions ? externalFoilOptions : undefined',
    );
  });

  it('rejects a delayed old response after quantity and row facts change', async () => {
    const oldInput = quoteInput({
      quantities: [1_000],
      actualBagCount: 100,
      province: '广东',
    });
    const newInput = quoteInput({
      quantities: [2_000, 1_000],
      actualBagCount: 300,
      province: '上海',
    });
    const oldResponse = deferred<QuoteActionResponse>();
    const newResponse = deferred<QuoteActionResponse>();
    const action = vi.mocked(quoteExternalCreateOrderAction);
    action.mockImplementation((input) =>
      (input as CreateOrderQuoteActionInput).factsKey === oldInput.factsKey
        ? oldResponse.promise
        : newResponse.promise,
    );

    const gate = createOrderQuoteRequestGate();
    let currentInput = oldInput;
    let currentFieldIds = ['fig-1'];
    let displayedKnownTotal: string | null = null;
    const request = async (
      input: CreateOrderQuoteActionInput,
      fieldIds: readonly string[],
    ) => {
      const requestId = beginOrderQuoteRequest(gate);
      const response = await quoteExternalCreateOrderAction(input);
      const current = isCurrentOrderQuoteResponse({
        gate,
        requestId,
        inputKey: input.factsKey,
        currentInputKey: currentInput.factsKey,
        fieldIds,
        currentFieldIds,
      });
      if (
        current &&
        response.status === 'success' &&
        response.quote.factsKey === input.factsKey
      ) {
        displayedKnownTotal = response.quote.knownTotal;
      }
      return current;
    };

    const pendingOld = request(oldInput, ['fig-1']);
    currentInput = newInput;
    currentFieldIds = ['fig-1', 'fig-2'];
    const pendingNew = request(newInput, currentFieldIds);

    newResponse.resolve(successResponse(newInput.factsKey, '566.30'));
    await expect(pendingNew).resolves.toBe(true);
    expect(displayedKnownTotal).toBe('566.30');

    oldResponse.resolve(successResponse(oldInput.factsKey, '999.99'));
    await expect(pendingOld).resolves.toBe(false);
    expect(displayedKnownTotal).toBe('566.30');

    expect(oldInput.factsKey).not.toBe(newInput.factsKey);
    expect(newInput.factsKey.length).toBeLessThanOrEqual(512);
    expect(action).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderItemCount: 2,
        packagingGroups: [
          expect.objectContaining({ actualBagCount: 300 }),
        ],
        logistics: expect.objectContaining({
          shipments: [
            expect.objectContaining({
              province: '上海',
              itemQuantities: [2_000, 1_000],
            }),
          ],
        }),
      }),
    );
  });

  it('changes the compact identity for item-count, packaging, or logistics changes', () => {
    const base = quoteInput({
      quantities: [1_000],
      actualBagCount: 100,
      province: '广东',
    });
    const itemCountChanged = quoteInput({
      quantities: [1_000, 1_000],
      actualBagCount: 200,
      province: '广东',
    });
    const packagingChanged = quoteInput({
      quantities: [1_000],
      actualBagCount: 101,
      province: '广东',
    });
    const logisticsChanged = quoteInput({
      quantities: [1_000],
      actualBagCount: 100,
      province: '上海',
    });

    expect(new Set([
      base.factsKey,
      itemCountChanged.factsKey,
      packagingChanged.factsKey,
      logisticsChanged.factsKey,
    ])).toHaveLength(4);
    expect(JSON.parse(quoteFactsKey(base.items[0], 1))).toMatchObject({
      orderItemCount: 1,
      quantity: 1_000,
    });
    expect(quoteFactsKey(base.items[0], 1)).not.toBe(
      quoteFactsKey(base.items[0], 2),
    );
  });

  it('renders all B-rail fee lines and the server known total', () => {
    const html = renderToStaticMarkup(
      <OrderFormBRail
        itemCount={2}
        quoteItems={[
          {
            key: 'fig-1',
            label: '局部烫金 · 大号封',
            status: 'complete',
            amount: '500.00',
            components: [{ label: '款式加工费', amount: '500.00' }],
          },
          {
            key: 'fig-2',
            label: '专版烫金 · 三色',
            status: 'incomplete',
            amount: null,
            components: [],
            message: '专版三色需工厂核价',
          },
        ]}
        packaging={{
          status: 'complete',
          amount: '10.00',
          label: '入袋 300袋',
        }}
        logistics={{
          status: 'complete',
          shippingAmount: '41.30',
          packagingAmount: '15.00',
          totalAmount: '56.30',
          packagingLabel: '纸箱耗材',
          shippingLabel: '快递费 · 上海 12kg',
        }}
        plateFee={{
          status: 'PENDING',
          amount: null,
          displayAmount: '待定',
          label: '制烫金版费',
        }}
        usesExternalSalesPricing
        settlementLabel="外部销售应付工厂"
        knownTotal="566.30"
        totalSemantics="EXCLUDES_MANUAL_ITEMS"
        gaps={[]}
        busy={false}
        onAttemptSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('款式加工费');
    expect(html).toContain('入袋 300袋');
    expect(html).toContain('制烫金版费');
    expect(html).toContain('待工厂核价');
    expect(html).toContain('纸箱耗材');
    expect(html).toContain('快递费 · 上海 12kg');
    expect(html).toContain('已知合计');
    expect(html).toContain('¥ 566.30');
    expect(html).toContain('不含待核价款');
    expect(html).not.toContain('>——<');
  });
});

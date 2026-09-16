'use client';

import { type SampleOrderFormState, type SampleOrderContext, SampleOrderForm } from '@/components/business/order/SampleOrderForm';
import { OrderPurposePicker } from '@/components/business/order/OrderPurposePicker';
import { useSampleWorkbenchDraft } from './useSampleWorkbenchDraft';
import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import type { PricingCraftIdentity } from '@/lib/order/pricing-route';
import {
  createExternalOrderItem,
  normalizeExternalOrderItem,
} from '@/lib/order/order-item-configuration';
import {
  orderItemSelectionUpdate,
  type OrderItemSelectionChange,
} from '@/lib/order/order-item-selection';
import { externalOrderCatalogCandidates } from '@/lib/order/order-item-catalog';
import { orderItemFieldOptions } from '@/components/business/order/order-item-field-options';
import {
  OrderItemCraftFields,
  OrderItemMaterialFields,
  OrderItemQuantityField,
  OrderItemProductField,
} from '@/components/business/order/order-form-b/OrderItemFields';
import { workbenchItemQuoteSchema } from '@/lib/workbench/item-quote';
import { suggestWorkbenchAmount } from '@/lib/workbench/quote';
import { saveWorkbenchTransfer } from '@/lib/workbench/order-transfer';
import { formatMoney } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Card } from '@/components/ui/card';
import { ActionNotice, EmptyState } from '@/components/ui-business';
import { useWorkbenchAutoQuote } from './useWorkbenchAutoQuote';

function workbenchInputIssue(item: { productId: string | null; crafts: string[] }, valid: boolean) {
  return !item.productId
    ? '请选择可用的纸张、规格和匹配产品'
    : item.crafts.length === 0
      ? '所选工艺暂不可用，请联系管理员配置后重试'
      : !valid
        ? '请补全数量和工艺条件'
        : null;
}

function selectWorkbenchItem(
  item: import('@/lib/auth/schemas').CreateOrderInput['items'][number],
  change: OrderItemSelectionChange,
  options: ExternalCreateOrderOptions,
  crafts: readonly PricingCraftIdentity[],
) {
  const next = orderItemSelectionUpdate(item, change, options.products, options);
  if (!next) return null;
  return change.type === 'customSize' ? next.item : normalizeExternalOrderItem({
    ...next.options, item: next.item, crafts, products: options.products,
    paperMaterials: options.papers,
    preserveCustomSize: next.options.preserveCustomSize ?? true,
  });
}

export function WorkbenchCalculator({
  options,
  crafts = [],
  draftScope = '',
  createEntry,
}: {
  createEntry?: {
    canEditFees?: boolean;
    purpose: 'SAMPLE_SHIPMENT' | 'PROOF';
    form: SampleOrderFormState;
    context: SampleOrderContext;
    item: import('@/lib/auth/schemas').CreateOrderInput['items'][number];
    onStandard: (route: import('@/generated/prisma/enums').OrderItemPricingRoute, form: SampleOrderFormState) => void;
    onPurposeChange: (purpose: 'SAMPLE_SHIPMENT' | 'PROOF') => void;
    onComplete: () => void;
  };
  options: ExternalCreateOrderOptions;
  crafts?: readonly PricingCraftIdentity[];
  draftScope?: string;
}) {
  const uid = useId().replaceAll(':', '');
  const router = useRouter();
  const [item, setItem] = useState(() =>
    createEntry?.item ?? createExternalOrderItem(
      crafts,
      options.products,
      options.papers,
      options.foilColors[0]?.name,
    ),
  );
  const { purpose, setPurpose, specialLocked, sampleFormProps } = useSampleWorkbenchDraft(item, setItem, draftScope, createEntry);
  const [markup, setMarkup] = useState('35');
  const [transferError, setTransferError] = useState<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const fields = orderItemFieldOptions(item, options.products, options);
  const parsed = workbenchItemQuoteSchema.safeParse({ item });
  const inputIssue = workbenchInputIssue(item, parsed.success);
  const { result, pending, invalidate, calculate } = useWorkbenchAutoQuote(
    purpose === 'STANDARD' && parsed.success && !inputIssue ? parsed.data : null,
    resultHeading,
    inputIssue,
  );
  function update(next: typeof item) {
    invalidate();
    setTransferError(null);
    setItem(next);
  }
  function select(change: OrderItemSelectionChange) {
    const next = selectWorkbenchItem(item, change, options, crafts);
    if (next) update(next);
  }
  const quote = result?.status === 'success' ? result.quote : null;
  const markupValid =
    markup.trim() !== '' &&
    Number.isInteger(Number(markup)) &&
    Number(markup) >= 0 &&
    Number(markup) <= 100;
  const suggested = suggestWorkbenchAmount(
    quote?.baseAmount ?? null,
    markupValid ? Number(markup) : 0,
  );
  function createOrder() {
    if (!parsed.success || inputIssue) return;
    try {
      const id = saveWorkbenchTransfer(
        window.sessionStorage,
        draftScope,
        parsed.data,
      );
      router.push(`/orders/new?fromWorkbench=${encodeURIComponent(id)}`);
    } catch {
      setTransferError('报价条件暂时无法带入，请检查浏览器存储权限后重试');
    }
  }
  return (
    <div className="@container min-w-0">
      <div className={purpose === 'SAMPLE_SHIPMENT' ? 'grid min-w-0 gap-4' : 'grid min-w-0 gap-4 @min-[881px]:grid-cols-[minmax(0,1fr)_19rem]'}>
        <Card className="min-w-0 p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">{purpose === 'SAMPLE_SHIPMENT' ? '工单条件' : '款式条件'}</h2>
          <OrderPurposePicker value={purpose === 'STANDARD' ? item.pricingRoute : purpose} disabled={specialLocked}
            onChange={(value) => {
              invalidate();
              if (value === 'SAMPLE_SHIPMENT' || value === 'PROOF') { setPurpose(value); createEntry?.onPurposeChange(value); }
              else if (value === 'STOCK_BLANK' || value === 'CUSTOM_SINGLE_FLAT_FOIL' || value === 'COLOR_PRINT') { if (createEntry) createEntry.onStandard(value, sampleFormProps.value); else { setPurpose('STANDARD'); select({ type: 'route', value }); } }
            }} />
          {purpose === 'SAMPLE_SHIPMENT' ? <div className="mt-4"><SampleOrderForm canEditFees={createEntry?.canEditFees} purpose="SAMPLE_SHIPMENT" {...sampleFormProps} onComplete={() => { sampleFormProps.onComplete(); createEntry?.onComplete(); }} /></div> : !options.products.length ? <EmptyState title="暂无可报价产品" description="请联系管理员配置产品后重试" /> : <fieldset disabled={specialLocked} className="min-w-0">
          <OrderItemCraftFields
            hideRoute={purpose === 'STANDARD'}
            uid={uid}
            item={item}
            first
            paperKey={fields.activeExternalPaper?.key ?? null}
            paperOptions={fields.externalPaperOptions}
            foilOptions={fields.externalFoilOptions}
            onRouteChange={(value) => select({ type: 'route', value })}
            onLaminationChange={(value) =>
              update(
                normalizeExternalOrderItem({
                  item: { ...item, lamination: value },
                  crafts,
                  products: options.products,
                  paperMaterials: options.papers,
                  preserveCustomSize: true,
                }),
              )
            }
            onPrintFoilModeChange={(value) =>
              select({ type: 'printFoil', value })
            }
            onFoilSidesChange={(front, back) =>
              select({ type: 'foil', front, back })
            }
            onBackFoilToggle={(enabled) =>
              select({
                type: 'foil',
                front: item.frontFoilColors,
                back: enabled ? [...item.frontFoilColors] : [],
              })
            }
            onFoilTechniqueChange={(value) =>
              select({ type: 'technique', value })
            }
          />
          <OrderItemMaterialFields
            uid={uid}
            item={item}
            paperKey={fields.activeExternalPaper?.key ?? null}
            paperOptions={fields.externalPaperOptions}
            weightOptions={fields.externalWeightOptions}
            specificationOptions={fields.externalSpecificationOptions}
            allowCustomSize
            onPaperChange={(value) => select({ type: 'paper', value })}
            onWeightChange={(value) => select({ type: 'weight', value })}
            onSpecificationChange={(value) =>
              select({ type: 'specification', value })
            }
            onCustomSizeChange={(value) =>
              select({ type: 'customSize', value })
            }
          />
          <OrderItemProductField
            value={item.productId}
            products={externalOrderCatalogCandidates(
              options.products,
              item.pricingRoute,
              item.paperType ?? '',
              item.specification ?? '',
            )}
            onChange={(productId) => update({ ...item, productId })}
          />
          <div className="mt-4 border-t pt-4">
            <OrderItemQuantityField
              uid={uid}
              item={item}
              onQuantityChange={(quantity) => update({ ...item, quantity })}
            />
          </div>
          </fieldset>}
        </Card>
        {purpose !== 'SAMPLE_SHIPMENT' && options.products.length > 0 ? <aside className="min-w-0 @min-[881px]:sticky @min-[881px]:top-20 @min-[881px]:self-start">
          {purpose === 'PROOF' ? <SampleOrderForm canEditFees={createEntry?.canEditFees} purpose="PROOF" item={item} {...sampleFormProps} onComplete={() => { sampleFormProps.onComplete(); createEntry?.onComplete(); }} /> : <Card className="min-w-0 gap-4 p-4 sm:p-5">
            <h2
              ref={resultHeading}
              tabIndex={-1}
              className="text-lg font-semibold focus-visible:ring-2 focus-visible:ring-ring"
            >
              加工费参考报价
            </h2>
            <div role="status" aria-live="polite" aria-atomic="true">
              {pending ? (
                <p className="text-sm text-muted-foreground">正在计算…</p>
              ) : result?.status === 'error' ? (
                <ActionNotice tone="error" title={result.message} />
              ) : quote ? (
                <>
                  <p className="text-3xl font-semibold tabular-nums">
                    {quote.needsPricing ||
                    !markupValid ||
                    suggested.suggestedAmount === null
                      ? '待核价'
                      : formatMoney(suggested.suggestedAmount)}
                  </p>
                  {quote.needsPricing ? (
                    <p className="mt-2 text-sm text-warning-foreground">
                      {quote.pricingReasons?.join('；') || '部分费用待核价'}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {inputIssue ?? '正在准备报价'}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-markup`}>加工费加价比例（%）</Label>
              <Input
                id={`${uid}-markup`}
                className="min-h-11"
                type="number"
                min={0}
                max={100}
                step={1}
                value={markup}
                aria-invalid={!markupValid}
                aria-describedby={
                  !markupValid ? `${uid}-markup-error` : undefined
                }
                onChange={(event) => setMarkup(event.target.value)}
              />
              {!markupValid ? (
                <p
                  id={`${uid}-markup-error`}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  请输入 0–100 的整数
                </p>
              ) : null}
            </div>
            {quote ? (
              <>
                <dl className="space-y-2 text-sm tabular-nums">
                  <div className="flex justify-between gap-2">
                    <dt>基础加工费</dt>
                    <dd>
                      {quote.baseAmount === null
                        ? '待核价'
                        : formatMoney(quote.baseAmount)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>加价金额</dt>
                    <dd>
                      {!markupValid || suggested.markupAmount === null
                        ? '待核价'
                        : formatMoney(suggested.markupAmount)}
                    </dd>
                  </div>
                </dl>
                <Disclosure className="border-t pt-3">
                  <DisclosureSummary className="min-h-11 cursor-pointer text-sm">
                    费用明细 · 第 {quote.processingVersion} 版
                  </DisclosureSummary>
                  <dl className="space-y-2 text-sm">
                    {quote.lines.map((line, index) => (
                      <div key={index} className="flex justify-between gap-3">
                        <dt>{line.name}</dt>
                        <dd className="shrink-0 tabular-nums">
                          {formatMoney(line.amount)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Disclosure>
                <p className="text-xs text-muted-foreground">
                  {quote.plateFeePending ? '制版费待定；' : ''}包装、运费另计
                </p>
              </>
            ) : null}
            <Button
              className="min-h-11"
              type="button"
              variant="outline"
              disabled={pending || !!inputIssue}
              onClick={() => void calculate(true)}
            >
              {pending
                ? '正在计算…'
                : result?.status === 'error'
                  ? '重试报价'
                  : '刷新报价'}
            </Button>
            <Button
              className="min-h-11"
              type="button"
              disabled={!!inputIssue || pending}
              onClick={createOrder}
            >
              按此款式创建工单
            </Button>
            {transferError ? (
              <ActionNotice tone="error" title={transferError} />
            ) : null}
          </Card>}
        </aside> : null}
      </div>
    </div>
  );
}

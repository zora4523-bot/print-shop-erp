'use client';

import type { OrderCreationLifecycle } from './order-creation-editor';
import type { SampleOrderFormState, SampleOrderContext, SavedSampleDraft } from './sample-order-types';
export type { SampleOrderFormState, SampleOrderContext, SavedSampleDraft } from './sample-order-types';
import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOrderAction, submitOrderAction } from '@/actions/order';
import { quoteSampleOrderAction } from '@/actions/create-order-quote';
import { createOrderSchema, type CreateOrderInput } from '@/lib/auth/schemas';
import type { SampleOrderQuote } from '@/lib/order/sample-order';
import { createBlankItem } from '@/lib/order/order-item-configuration';
import { buildExternalCreateOrderPayload } from '@/lib/order/external-create-order-payload';
import { ZTO_PROVINCE_OPTIONS } from '@/lib/price/external-order-charges';
import { formatMoney } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { ReceiverAddressPasteField } from './ReceiverAddressPasteField';
import { applyParsedReceiverFact } from '@/lib/order/receiver-address-paste';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ActionNotice } from '@/components/ui-business';
import { DesignUploadPanel } from './DesignUploadPanel';
import type { ExternalSalesAccountOption } from '@/lib/order/external-sales-association';
import { ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE } from '@/lib/order/settlement';
import { NoExternalSalesEmptyState } from './NoExternalSalesEmptyState';
import { SampleExternalSalesField } from './SampleExternalSalesField';

export const EMPTY_SAMPLE_FORM: SampleOrderFormState = {
  name: '',
  quantity: '1',
  receiverName: '',
  receiverPhone: '',
  receiverAddress: '',
  province: '',
  packing: '',
  collect: false,
  remark: '',
};
const emptySampleContext: SampleOrderContext = {
  externalSalesUserId: null, promisedDate: null, isUrgent: false,
  expressCode: null, customName: undefined, packageRequirement: null,
};
type SampleOrderFormProps = {
  lifecycle?: OrderCreationLifecycle;
  canEditFees?: boolean;
  context?: SampleOrderContext;
  /** 管理员代建时传入（可为空数组）；外部销售本人建单时不传。 */
  externalSalesAccounts?: readonly ExternalSalesAccountOption[];
  onContextChange?: (context: SampleOrderContext) => void;
  purpose: 'SAMPLE_SHIPMENT' | 'PROOF';
  item?: CreateOrderInput['items'][number];
  value: SampleOrderFormState;
  onChange: (value: SampleOrderFormState) => void;
  draft: SavedSampleDraft | null;
  onDraftChange: (value: SavedSampleDraft) => void;
  onComplete: () => void;
  onBusyChange?: (busy: boolean) => void;
};

function completeSavedSample(
  draft: SavedSampleDraft, intent: 'draft' | 'submit' | 'fees',
  lifecycle: OrderCreationLifecycle | undefined, onComplete: () => void, navigate: (url: string) => void,
) {
  lifecycle?.onCompleted({ orderId: draft.orderId, orderNo: draft.orderId, intent });
  if (lifecycle?.retainResult && intent !== 'fees') return;
  onComplete();
  navigate(`/orders/${draft.orderId}${intent === 'fees' ? '#admin-fee-editor' : ''}`);
}

export function SampleOrderForm({
  lifecycle,
  purpose,
  item,
  value,
  onChange,
  draft,
  onDraftChange,
  onComplete,
  onBusyChange,
  context,
  canEditFees = false,
  externalSalesAccounts,
  onContextChange,
}: SampleOrderFormProps) {
  const uid = useId();
  const router = useRouter();
  const requestId = useRef<{ key: string; id: string } | null>(null);
  const {
    name,
    quantity,
    receiverName,
    receiverPhone,
    receiverAddress,
    province,
    packing,
    collect,
    remark,
  } = value;
  const [quote, setQuote] = useState<SampleOrderQuote | null>(null);
  const [quotedFacts, setQuotedFacts] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const salesField = useRef<HTMLSelectElement>(null);
  const sampleItem: CreateOrderInput['items'][number] = {
    ...createBlankItem([]),
    name,
    quantity: Number(quantity),
    pricingRoute: 'MANUAL_QUOTE',
    pack: null,
    crafts: [],
    frontFoilColors: [],
    backFoilColors: [],
    foilColors: [],
    foilTechnique: 'NONE',
    hasLocalFoil: null,
  };
  const facts = {
    purpose,
    customName: purpose === 'PROOF' ? context?.customName || item?.name : name,
    samplePackagingRuleCode:
      purpose === 'SAMPLE_SHIPMENT' ? packing || null : null,
    externalSalesUserId: context?.externalSalesUserId ?? null,
    promisedDate: context?.promisedDate ?? null,
    receiverName,
    receiverPhone,
    receiverAddress,
    destinationProvince: province || null,
    expressCode: context?.expressCode ?? null,
    packageRequirement: context?.packageRequirement ?? null,
    remark,
    isUrgent: context?.isUrgent ?? false,
    isSfCollect: collect,
    items: [purpose === 'PROOF' ? item : sampleItem],
    additionalShipments: [],
    packagingGroups:
      purpose === 'PROOF'
        ? [
            {
              name: null,
              mode: 'SINGLE_STYLE',
              itemUnitsPerBag: [1],
              actualBagCount: item?.quantity ?? 1,
            },
          ]
        : [],
  };
  const factsKey = JSON.stringify(facts);
  const currentQuote = quotedFacts === factsKey ? quote : null;
  function input() {
    const parsed = createOrderSchema.safeParse(facts);
    if (!receiverName.trim() || !receiverPhone.trim()) {
      setError('请填写收货人和手机号');
      return null;
    }
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join('；'));
      return null;
    }
    return parsed.data;
  }
  async function preview() {
    const data = input();
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const result = await quoteSampleOrderAction(data);
      if (result.status === 'success') {
        setQuote(result.quote);
        setQuotedFacts(factsKey);
      } else setError(result.message);
    } catch {
      setError('报价暂时不可用，请重试');
    } finally {
      setBusy(false);
      lifecycle?.onBusyChange?.(false);
    }
  }
  async function create() {
    // 业主 2026-09-24：管理员代建的寄样品 / 打样同样必须归属外部销售。
    if (externalSalesAccounts && !context?.externalSalesUserId) {
      setSalesError(ADMIN_EXTERNAL_SALES_REQUIRED_MESSAGE);
      salesField.current?.focus();
      return;
    }
    const data = input();
    if (!data || !currentQuote) return;
    setBusy(true);
    onBusyChange?.(true);
    lifecycle?.onBusyChange?.(true);
    setError(null);
    try {
      if (requestId.current?.key !== factsKey)
        requestId.current = { key: factsKey, id: crypto.randomUUID() };
      const result = await createOrderAction(
        null,
        {
          ...buildExternalCreateOrderPayload({ ...data, clientSubmissionId: lifecycle?.submissionId ?? requestId.current.id }),
          ...(context?.externalSalesUserId ? { externalSalesUserId: context.externalSalesUserId } : {}),
        },
      );
      if (result.status !== 'success') {
        if (result.status === 'invalid') setSalesError(result.fieldErrors.externalSalesUserId?.[0] ?? null);
        setError(
          result.status === 'error'
            ? result.message
            : Object.values(result.fieldErrors).flat().join('；'),
        );
        return;
      }
      lifecycle?.onCreated({ orderId: result.orderId, orderNo: result.orderNo, intent: 'draft' });
      onDraftChange({ orderId: result.orderId, itemIds: result.itemIds });
    } catch {
      setError('工单保存失败，请重试');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      lifecycle?.onBusyChange?.(false);
    }
  }
  async function submit(editFees = false) {
    if (!draft) return;
    setBusy(true);
    lifecycle?.onBusyChange?.(true);
    setError(null);
    try {
      const result = await submitOrderAction(
        draft.orderId,
        quote?.quoteToken ?? null,
      );
      if (result.status === 'success') {
        requestId.current = null;
        completeSavedSample(draft, editFees ? 'fees' : 'submit', lifecycle, onComplete, (url) => {
          router.push(url);
          router.refresh();
        });
        return;
      }
      if (result.status === 'quote_changed') {
        setQuote({
          shippingAmount: null,
          packagingAmount: null,
          packagingOptions: [],
          errors: [],
          ...quote,
          quoteToken: result.quoteToken,
          knownTotal: result.quotedFee,
          total:
            result.quotedFeeCompleteness === 'COMPLETE'
              ? result.quotedFee
              : null,
        });
        setError(result.message);
      } else
        setError(
          result.status === 'error'
            ? result.message
            : Object.values(result.fieldErrors).flat().join('；'),
        );
    } catch {
      setError('提交失败，请重试');
    } finally {
      setBusy(false);
      lifecycle?.onBusyChange?.(false);
    }
  }
  if (externalSalesAccounts?.length === 0 && !draft) return <NoExternalSalesEmptyState />;
  return (
    <Card
      className={
        purpose === 'SAMPLE_SHIPMENT'
          ? 'min-w-0 gap-4 border-0 p-0 shadow-none'
          : 'min-w-0 gap-4 p-4 sm:p-5'
      }
    >
      <h2 className="text-lg font-semibold">
        {purpose === 'PROOF' ? '打样工单' : '寄样品工单'}
      </h2>
      {!draft ? (
        <>
          {externalSalesAccounts ? <SampleExternalSalesField ref={salesField} accounts={externalSalesAccounts}
            value={context?.externalSalesUserId ?? null} error={salesError} disabled={busy}
            onChange={(externalSalesUserId) => {
              setSalesError(null);
              onContextChange?.({ ...emptySampleContext, ...context, externalSalesUserId });
            }} /> : null}
          <SampleOrderFields
            uid={uid}
            purpose={purpose}
            value={value}
            onChange={onChange}
            busy={busy}
            packagingOptions={quote?.packagingOptions ?? []}
          />
          {currentQuote ? <SampleQuoteSummary purpose={purpose} quote={currentQuote} /> : null}
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void preview()}
          >
            {busy ? '正在处理…' : '核对费用'}
          </Button>
          <Button
            type="button"
            disabled={busy || !currentQuote}
            onClick={() => void create()}
          >
            保存工单
          </Button>
        </>
      ) : (
        <>
          {purpose === 'PROOF' ? (
            <DesignUploadPanel
              orderId={draft.orderId}
              orderItemId={draft.itemIds[0]!}
              designs={[]}
              canEdit
              onBusyChange={setUploading}
            />
          ) : null}
          <p className="text-sm">
            {quote?.total == null
              ? '费用待核价'
              : `合计 ${formatMoney(quote?.total ?? '0')}`}
          </p>
          {canEditFees ? <Button type="button" variant="outline" disabled={busy || uploading} onClick={() => void submit(true)}>提交并编辑收费</Button> : null}
          <Button
            type="button"
            disabled={busy || uploading}
            onClick={() => void submit()}
          >
            {busy ? '正在提交…' : '提交工单'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => { requestId.current = null; completeSavedSample(draft, 'draft', lifecycle, onComplete, (url) => router.push(url)); }}
          >
            {lifecycle?.retainResult ? '保存并继续下一张' : '查看已保存工单'}
          </Button>
        </>
      )}
      {error ? <ActionNotice tone="error" title={error} /> : null}
    </Card>
  );
}

function SampleOrderFields({
  uid,
  purpose,
  value,
  onChange,
  busy,
  packagingOptions,
}: {
  uid: string;
  purpose: 'SAMPLE_SHIPMENT' | 'PROOF';
  value: SampleOrderFormState;
  onChange: (value: SampleOrderFormState) => void;
  busy: boolean;
  packagingOptions: SampleOrderQuote['packagingOptions'];
}) {
  const {
    name,
    quantity,
    receiverName,
    receiverPhone,
    receiverAddress,
    province,
    packing,
    collect,
    remark,
  } = value;
  function change<K extends keyof SampleOrderFormState>(
    key: K,
    next: SampleOrderFormState[K],
  ) {
    onChange({ ...value, [key]: next });
  }
  return (
    <fieldset
      disabled={busy}
      className={
        purpose === 'SAMPLE_SHIPMENT'
          ? 'grid min-w-0 gap-4 sm:grid-cols-2'
          : 'min-w-0 space-y-4'
      }
    >
      {purpose === 'SAMPLE_SHIPMENT' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-name`}>样品名称</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => change('name', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-quantity`}>样品数量</Label>
            <Input
              id={`${uid}-quantity`}
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => change('quantity', e.target.value)}
            />
          </div>
        </>
      ) : null}
      <ReceiverAddressPasteField
        id={`${uid}-address`}
        label="收货地址"
        className={purpose === 'SAMPLE_SHIPMENT' ? 'sm:col-span-2' : undefined}
        value={receiverAddress}
        onChange={(next, parsed, source) =>
          onChange({
            ...value,
            receiverAddress: next,
            receiverName: applyParsedReceiverFact(value.receiverName, parsed.receiverName, source),
            receiverPhone: applyParsedReceiverFact(value.receiverPhone, parsed.receiverPhone, source),
            province: applyParsedReceiverFact(value.province, parsed.province, source),
          })
        }
      />
      <div className="space-y-2">
        <Label htmlFor={`${uid}-receiver`}>收货人</Label>
        <Input
          id={`${uid}-receiver`}
          value={receiverName}
          onChange={(e) => change('receiverName', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${uid}-phone`}>手机号</Label>
        <Input
          id={`${uid}-phone`}
          type="tel"
          value={receiverPhone}
          onChange={(e) => change('receiverPhone', e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${uid}-province`}>收件省份</Label>
        <NativeSelect
          id={`${uid}-province`}
          value={province}
          onChange={(e) => change('province', e.target.value)}
        >
          <option value="">请选择省份</option>
          {ZTO_PROVINCE_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeSelect>
      </div>
      {purpose === 'SAMPLE_SHIPMENT' ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-packing`}>包装规格</Label>
            <NativeSelect
              id={`${uid}-packing`}
              value={packing}
              onChange={(e) => change('packing', e.target.value)}
            >
              <option value="">最小包装</option>
              {packagingOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label} · {formatMoney(option.amount)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${uid}-collect`}
              checked={collect}
              onCheckedChange={(value) => change('collect', value === true)}
            />
            <Label htmlFor={`${uid}-collect`}>顺丰到付</Label>
          </div>
        </>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={`${uid}-remark`}>
          {purpose === 'PROOF' ? '打样要求' : '备注'}
        </Label>
        <Textarea
          id={`${uid}-remark`}
          value={remark}
          onChange={(e) => change('remark', e.target.value)}
        />
      </div>
    </fieldset>
  );
}

function SampleQuoteSummary({ purpose, quote }: { purpose: 'SAMPLE_SHIPMENT' | 'PROOF'; quote: SampleOrderQuote }) {
  return (
    <div role="status" className="space-y-2 text-sm">
      {purpose === 'SAMPLE_SHIPMENT' ? (
        <dl className="space-y-2">
          <div className="flex justify-between">
            <dt>快递费</dt>
            <dd>
              {quote.shippingAmount === null
                ? '待核价'
                : formatMoney(quote.shippingAmount)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>包装费</dt>
            <dd>
              {quote.packagingAmount === null
                ? '待核价'
                : formatMoney(quote.packagingAmount)}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="text-xl font-semibold">
        {quote.total === null
          ? '待核价'
          : formatMoney(quote.total)}
      </p>
      {purpose === 'PROOF' ? (
        <p className="text-muted-foreground">整单总价由管理员填写</p>
      ) : quote.shippingAmount === null ? (
        <p className="text-muted-foreground">
          请在发货前补齐计费重量并核定快递费
        </p>
      ) : null}
    </div>
  );
}

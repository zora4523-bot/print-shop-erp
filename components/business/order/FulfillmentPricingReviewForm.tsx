'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  finalizeFulfillmentPricingAction,
  previewFulfillmentPricingAction,
} from '@/actions/order-fulfillment-pricing';
import type { FulfillmentPricingFailure } from '@/actions/order-fulfillment-pricing.types';
import type {
  FulfillmentPricingPreview,
  PreviewFulfillmentPricingCommand,
} from '@/lib/order/fulfillment-pricing';
import { ZTO_PROVINCE_OPTIONS } from '@/lib/price/external-order-charges';
import { formatMoney } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOrderEditorAuxiliary } from './use-order-editor-auxiliary';

type Props = {
  orderId: string;
  currentValue: boolean;
  isPricingPending: boolean;
  variant?: 'page' | 'drawer';
  onSuccess?: () => void;
  shipments: Array<{
    id: string;
    sequence: number;
    destinationProvince: string | null;
    weightKg: string | null;
  }>;
};

function failureText(result: FulfillmentPricingFailure): string {
  return result.status === 'error'
    ? result.message
    : Object.values(result.fieldErrors).flat().join('；') || '请检查输入内容';
}

function readCommand(form: HTMLFormElement, orderId: string, isSfCollect: boolean): PreviewFulfillmentPricingCommand {
  const data = new FormData(form);
  const values = (name: string) => data.getAll(name).map((value) => typeof value === 'string' ? value : '');
  const provinces = values('sfShipmentDestinationProvince');
  const weights = values('sfShipmentWeightKg');
  const fees = values('sfShipmentShippingFee');
  const reasons = values('sfShipmentChargeOverrideReason');
  return {
    orderId,
    isSfCollect,
    shipments: isSfCollect ? [] : values('sfShipmentId').map((shipmentId, index) => ({
      shipmentId,
      destinationProvince: provinces[index] || null,
      weightKg: weights[index] || null,
      shippingFee: fees[index] || null,
      customerChargeOverrideReason: reasons[index] || null,
    })),
  };
}

export function FulfillmentPricingReviewForm({ orderId, currentValue, isPricingPending, shipments, variant = 'page', onSuccess }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState(currentValue);
  const [edited, setEdited] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const generation = useRef(0);
  const [accepted, setAccepted] = useState<{
    command: PreviewFulfillmentPricingCommand;
    preview: FulfillmentPricingPreview;
    idempotencyKey: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const dirty = !confirmed && (edited || target !== currentValue || accepted !== null);
  const auxiliary = useOrderEditorAuxiliary({ dirty, pending });
  function resetDraft() {
    generation.current += 1;
    setTarget(currentValue);
    setEdited(false);
    setAccepted(null);
    setError(null);
    setFormVersion((value) => value + 1);
  }

  function invalidatePreview() {
    generation.current += 1;
    setEdited(true);
    setAccepted(null);
    setError(null);
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || confirmed || auxiliary.blocked) return;
    const command = readCommand(event.currentTarget, orderId, target);
    const currentGeneration = ++generation.current;
    setAccepted(null);
    setError(null);
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await previewFulfillmentPricingAction(null, command);
        if (currentGeneration !== generation.current) return;
        if (result.status === 'success') {
          setAccepted({ command, preview: result.preview, idempotencyKey: crypto.randomUUID() });
        } else {
          setError(failureText(result));
        }
      } catch {
        if (currentGeneration === generation.current) setError('预览暂时失败，请重试；尚未修改工单。');
      } finally {
        busy.current = false;
      }
    });
  }

  function confirmPricing() {
    if (busy.current || confirmed || auxiliary.blocked || !accepted?.preview.canConfirm) return;
    // The accepted request is immutable: editing any field clears it. A
    // network retry keeps this request's key, so a lost response cannot
    // authorize a second financial revision.
    const { command, preview: quote, idempotencyKey } = accepted;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await finalizeFulfillmentPricingAction(null, {
          ...command,
          expectedOrderRevision: quote.expectedOrderRevision,
          expectedEditVersion: quote.expectedEditVersion,
          expectedWorkOrderVersion: quote.expectedWorkOrderVersion,
          expectedPriceRevision: quote.expectedPriceRevision,
          previewToken: quote.previewToken,
          idempotencyKey,
        });
        if (result.status === 'success') {
          setConfirmed(true);
          if (onSuccess) onSuccess();
          else router.refresh();
        } else {
          setError(failureText(result));
          setAccepted(null);
        }
      } catch {
        setError('暂未收到确认结果，请重试。');
      } finally {
        busy.current = false;
      }
    });
  }

  const quote = accepted?.preview;
  return (
    <section data-variant={variant} id="fulfillment-pricing" className="min-w-0 scroll-mt-24 border-t pt-4">
      {auxiliary.blocked ? <p className="text-xs text-muted-foreground">请先保存或还原正在编辑的工单资料或费用。</p> : null}
      <h3 className="text-sm font-semibold">物流费用确认</h3>

      {confirmed ? (
        <p role="status" className="mt-3 text-sm">物流费用已确认，工单已刷新。</p>
      ) : (
        <form key={formVersion} onSubmit={preview} onChange={invalidatePreview} aria-busy={pending} className="mt-4 min-w-0 space-y-4">
          <fieldset disabled={pending || auxiliary.blocked} className="min-w-0 space-y-4">
            <div className="max-w-sm space-y-1">
              <label htmlFor={`fulfillment-mode-${orderId}`} className="text-sm font-medium">更正后的物流方式</label>
              <select
                id={`fulfillment-mode-${orderId}`}
                value={String(target)}
                onChange={(event) => setTarget(event.target.value === 'true')}
                className={fieldClass}
              >
                <option value="true">顺丰到付（本单不收快递费）</option>
                <option value="false">非到付（确认对客快递费）</option>
              </select>
            </div>
            {target ? (
              <p className="text-sm text-muted-foreground">对客快递费将按零元核对，其他收费保持不变；存在已记录运费成本时仍需先处理成本冲突。</p>
            ) : shipments.map((shipment) => {
              const prefix = `fulfillment-${shipment.id}`;
              return (
                <fieldset key={shipment.id} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2">
                  <legend className="px-1 text-sm font-medium">地址 {shipment.sequence}</legend>
                  <input type="hidden" name="sfShipmentId" value={shipment.id} />
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${prefix}-province`} className="text-xs font-medium">计费省份</label>
                    <select id={`${prefix}-province`} name="sfShipmentDestinationProvince" defaultValue={shipment.destinationProvince ?? ''} className={fieldClass}>
                      <option value="">请选择计费省份</option>
                      {ZTO_PROVINCE_OPTIONS.map((province) => <option key={province} value={province}>{province}</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${prefix}-weight`} className="text-xs font-medium">计费重量（kg）</label>
                    <Input id={`${prefix}-weight`} name="sfShipmentWeightKg" inputMode="decimal" defaultValue={shipment.weightKg ?? ''} placeholder="填写实际计费重量" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${prefix}-fee`} className="text-xs font-medium">实际对客快递费（元，选填）</label>
                    <Input id={`${prefix}-fee`} name="sfShipmentShippingFee" inputMode="decimal" placeholder="留空按原物流计价依据计算" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${prefix}-reason`} className="text-xs font-medium">收费调整说明</label>
                    <Input id={`${prefix}-reason`} name="sfShipmentChargeOverrideReason" maxLength={500} placeholder="填写实际运费的凭据或调整原因" />
                  </div>
                </fieldset>
              );
            })}
            <Button type="submit" variant="outline" disabled={pending || auxiliary.blocked || (!isPricingPending && target === currentValue && (target || !edited))}>
              {pending ? '处理中…' : '预览费用差额'}
            </Button>
          </fieldset>
          {quote ? (
            <div className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-3" aria-live="polite">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">更正前合计</dt><dd className="font-medium">{formatMoney(quote.oldTotal)}</dd></div>
                <div><dt className="text-muted-foreground">更正后合计</dt><dd className="font-medium">{quote.newTotal === null ? '待补齐费用' : formatMoney(quote.newTotal)}</dd></div>
                <div><dt className="text-muted-foreground">本次差额</dt><dd className="font-medium">{quote.delta === null ? '待确认' : formatMoney(quote.delta)}</dd></div>
              </dl>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {quote.shipments.map((shipment) => (
                  <li key={shipment.shipmentId} className="break-words">
                    地址 {shipment.sequence}：快递费 {shipment.currentShippingFee === null ? '待确认' : formatMoney(shipment.currentShippingFee)} → {shipment.shippingFee === null ? '待确认' : formatMoney(shipment.shippingFee)}
                  </li>
                ))}
              </ul>
              {quote.issues.length > 0 ? <ul role="alert" className="list-inside list-disc text-sm text-destructive">{quote.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul> : null}
              <p className="text-xs text-muted-foreground">确认后采用上方物流金额。</p>
              <Button type="button" disabled={pending || auxiliary.blocked || !quote.canConfirm} onClick={confirmPricing}>
                确认物流费用
              </Button>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </form>
      )}
      {auxiliary.managed && dirty ? <Button type="button" variant="outline" className="mt-3" disabled={pending || auxiliary.pending} onClick={resetDraft}>还原物流输入</Button> : null}
    </section>
  );
}

const fieldClass = 'min-h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

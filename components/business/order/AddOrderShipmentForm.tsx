'use client';

import { useId, useState, useTransition } from 'react';
import { addOrderShipmentAction } from '@/actions/order-shipment';
import type {
  AddOrderShipmentInput,
  AddOrderShipmentPreview,
} from '@/lib/order/add-shipment-schema';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { ReceiverAddressPasteField } from './ReceiverAddressPasteField';
import { applyParsedReceiverFact } from '@/lib/order/receiver-address-paste';
import { orderItemRowLabel } from '@/lib/order/item-label';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Label } from '@/components/ui/label';
import { ActionNotice } from '@/components/ui-business';
import { formatMoney } from '@/lib/dashboard/format';
import { useOrderEditorAuxiliary } from './use-order-editor-auxiliary';

type Props = Pick<
  AddOrderShipmentInput,
  | 'orderId'
  | 'expectedRevision'
  | 'expectedEditVersion'
  | 'expectedWorkOrderVersion'
  | 'expectedPriceRevision'
> & {
  nextSequence: number;
  allowManualPricing?: boolean;
  sources: {
    id: string;
    sequence: number;
    receiverAddress: string | null;
    // 同一设计款的规格行共用款名，标签靠序号与规格区分（见 orderItemRowLabel）。
    lines: {
      orderItemId: string;
      sequence: number;
      name: string;
      specification: string | null;
      quantity: number;
    }[];
  }[];
};

export function AddOrderShipmentForm({
  sources,
  nextSequence,
  allowManualPricing = true,
  ...guard
}: Props) {
  const uid = useId();
  const [opened, setOpened] = useState(false);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [receiver, setReceiver] = useState({
    receiverName: '',
    receiverPhone: '',
    receiverAddress: '',
    destinationProvince: '',
  });
  const [manual, setManual] = useState({
    shippingFee: '',
    packingMaterialFee: '',
    overrideReason: '',
  });
  const [preview, setPreview] = useState<AddOrderShipmentPreview | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const auxiliary = useOrderEditorAuxiliary({ dirty: opened, pending });
  const source = sources.find((row) => row.id === sourceId);
  const blocked = pending || auxiliary.blocked;
  function submit(mode: 'preview' | 'save') {
    if (!source || blocked) return;
    const input: AddOrderShipmentInput = {
      ...guard,
      ...receiver,
      ...(manual.shippingFee ? { shippingFee: manual.shippingFee } : {}),
      ...(manual.packingMaterialFee
        ? { packingMaterialFee: manual.packingMaterialFee }
        : {}),
      ...(manual.overrideReason
        ? { overrideReason: manual.overrideReason }
        : {}),
      sourceShipmentId: sourceId,
      lines: source.lines.map((line) => ({
        orderItemId: line.orderItemId,
        quantity: Number(quantities[line.orderItemId] || 0),
      })),
      ...(preview ? { previewToken: preview.token } : {}),
    };
    setError('');
    startTransition(async () => {
      try {
        const result = await addOrderShipmentAction(input, mode);
        if (result.status === 'error') {
          setError(result.message);
          setPreview(null);
        } else if (result.status === 'preview') setPreview(result.preview);
        else {
          setOpened(false);
          setManual({
            shippingFee: '',
            packingMaterialFee: '',
            overrideReason: '',
          });
          setPreview(null);
          setQuantities({});
          setReceiver({
            receiverName: '',
            receiverPhone: '',
            receiverAddress: '',
            destinationProvince: '',
          });
        }
      } catch {
        setError('添加地址未完成，请刷新工单核对后重试');
        setPreview(null);
      }
    });
  }
  if (!sources.length || nextSequence > 10) return null;
  return (
    <section
      aria-label="添加收货地址"
      className="min-w-0 rounded-xl border bg-card p-4 [&_button]:min-h-11 [&_input]:min-h-11"
    >
      {!opened ? (
        <Button
          type="button"
          variant="outline"
          disabled={blocked}
          onClick={() => setOpened(true)}
        >
          添加地址 {nextSequence}
        </Button>
      ) : (
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            submit(preview ? 'save' : 'preview');
          }}
        >
          <h2 className="mb-4 text-sm font-semibold">
            添加地址 {nextSequence}
          </h2>
          {error ? <ActionNotice tone="error" title={error} /> : null}
          <fieldset
            disabled={blocked || Boolean(preview)}
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <div className="min-w-0 sm:col-span-2">
              <Label htmlFor={`${uid}-source`}>从哪个地址分货</Label>
              <NativeSelect
                className="w-full min-w-0"
                id={`${uid}-source`}
                value={sourceId}
                onChange={(event) => {
                  setSourceId(event.target.value);
                  setQuantities({});
                }}
              >
                {sources.map((row) => (
                  <option key={row.id} value={row.id}>
                    地址 {row.sequence} · {row.receiverAddress}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {(
              [
                ['receiverName', '收件人'],
                ['receiverPhone', '收货电话'],
                ['receiverAddress', '收货地址'],
                ['destinationProvince', '计费省份'],
              ] as const
            ).map(([key, label]) => (
              <div
                key={key}
                className={
                  key === 'receiverAddress'
                    ? 'min-w-0 sm:col-span-2'
                    : 'min-w-0'
                }
              >
                {key === 'receiverAddress' ? (
                  <ReceiverAddressPasteField
                    id={`${uid}-${key}`}
                    label={label}
                    required
                    maxLength={256}
                    value={receiver.receiverAddress}
                    onChange={(next, parsed, source) =>
                      setReceiver((current) => ({
                        ...current,
                        receiverAddress: next,
                        receiverName: applyParsedReceiverFact(current.receiverName, parsed.receiverName, source),
                        receiverPhone: applyParsedReceiverFact(current.receiverPhone, parsed.receiverPhone, source),
                        destinationProvince: applyParsedReceiverFact(current.destinationProvince, parsed.province, source),
                      }))
                    }
                  />
                ) : (
                  <>
                  <Label htmlFor={`${uid}-${key}`}>{label}</Label>
                  <Input
                    id={`${uid}-${key}`}
                    required
                    maxLength={key === 'receiverName' ? 64 : 32}
                    value={receiver[key]}
                    onChange={(event) =>
                      setReceiver({ ...receiver, [key]: event.target.value })
                    }
                  />
                  </>
                )}
              </div>
            ))}
            {source?.lines.map((line) => (
              <div key={line.orderItemId} className="min-w-0">
                <Label htmlFor={`${uid}-${line.orderItemId}`}>
                  {orderItemRowLabel(line)} · 分配数量（最多 {line.quantity}）
                </Label>
                <Input
                  id={`${uid}-${line.orderItemId}`}
                  type="number"
                  min={0}
                  max={line.quantity}
                  step={1}
                  value={quantities[line.orderItemId] ?? '0'}
                  onChange={(event) =>
                    setQuantities({
                      ...quantities,
                      [line.orderItemId]: event.target.value,
                    })
                  }
                />
              </div>
            ))}
            {allowManualPricing ? (
              <Disclosure className="sm:col-span-2">
                <DisclosureSummary className="min-h-11 py-3 text-sm">
                  人工物流费用（选填）
                </DisclosureSummary>
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      ['shippingFee', '新地址快递费'],
                      ['packingMaterialFee', '新地址纸箱费'],
                      ['overrideReason', '人工费用说明'],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <Label htmlFor={`${uid}-${key}`}>{label}</Label>
                      <Input
                        id={`${uid}-${key}`}
                        inputMode={
                          key === 'overrideReason' ? 'text' : 'decimal'
                        }
                        maxLength={key === 'overrideReason' ? 500 : 13}
                        value={manual[key]}
                        onChange={(event) =>
                          setManual({ ...manual, [key]: event.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
              </Disclosure>
            ) : null}
          </fieldset>
          {preview ? (
            <div role="status" className="mt-4 space-y-2 text-sm">
              <p>
                地址 {preview.sequence}：{receiver.receiverName}{' '}
                {receiver.receiverPhone} {receiver.receiverAddress}
              </p>
              {source?.lines
                .filter((line) => Number(quantities[line.orderItemId]) > 0)
                .map((line) => (
                  <p key={line.orderItemId}>
                    {orderItemRowLabel(line)}：地址 {source.sequence} {line.quantity} →{' '}
                    {line.quantity - Number(quantities[line.orderItemId])}{' '}
                    件；地址 {preview.sequence} {quantities[line.orderItemId]}{' '}
                    件
                  </p>
                ))}
              <ShipmentPricingPreview preview={preview} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="submit" disabled={blocked}>
              {pending ? '正在处理…' : preview ? '保存地址' : '预览费用'}
            </Button>
            {preview ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setPreview(null)}
              >
                继续修改
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setOpened(false);
                setManual({
                  shippingFee: '',
                  packingMaterialFee: '',
                  overrideReason: '',
                });
                setQuantities({});
                setReceiver({
                  receiverName: '',
                  receiverPhone: '',
                  receiverAddress: '',
                  destinationProvince: '',
                });
                setPreview(null);
                setError('');
              }}
            >
              取消
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ShipmentPricingPreview({
  preview,
}: {
  preview: AddOrderShipmentPreview;
}) {
  return (
    <>
      {preview.charges.map((row) => (
        <p key={row.sequence}>
          地址 {row.sequence} · 快递费{' '}
          {row.shippingFee === null ? '待核价' : formatMoney(row.shippingFee)} ·
          纸箱费{' '}
          {row.packingMaterialFee === null
            ? '待核价'
            : formatMoney(row.packingMaterialFee)}
        </p>
      ))}
      {preview.packaging.map((group) => (
        <p key={group.groupId}>
          包装组 {group.sequence}：{group.oldBoxCount} → {group.boxCount} 盒，
          装盒费用 {formatMoney(group.oldSubtotal)} →{' '}
          {formatMoney(group.subtotal)}
        </p>
      ))}
      <p>
        工单金额 {formatMoney(preview.oldTotal)} →{' '}
        {formatMoney(preview.newTotal)}（差额 {formatMoney(preview.delta)}）
      </p>
      {preview.requiresPriceReview ? (
        <p>保存后需重新核价。</p>
      ) : preview.pricingMode === 'ON_SUBMIT' ? (
        <p>提交工单时核算各地址费用。</p>
      ) : null}
    </>
  );
}

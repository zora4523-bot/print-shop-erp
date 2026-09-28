'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { registerShipmentAction } from '@/actions/shipment-registration';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

export type ShipmentRegistrationProps = {
  orderId: string; shipmentId: string; version: number;
  revision: number; editVersion: number; workOrderVersion: number; priceRevision: number;
  trackingNo: string | null; carrierCode: string | null; carrierName: string | null;
  shipped: boolean; canConfirm: boolean; disabledReason: string | null;
  chargeable?: boolean;
  lastPending: boolean; amount: string; labels: { id: string; createdAt: string }[];
};

async function preparePhoto(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('请选择 15 MB 以内的 JPG、PNG 或 WebP 图片');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片处理失败，请重新选择');
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 512 * 1024) return new File([blob], 'waybill.jpg', { type: 'image/jpeg' });
    }
    throw new Error('图片仍然过大，请裁剪面单后重试');
  } finally { bitmap.close(); }
}

export function ShipmentRegistrationForm(props: ShipmentRegistrationProps) {
  const router = useRouter();
  const [tracking, setTracking] = useState(props.trackingNo ?? '');
  const [carrier, setCarrier] = useState(props.carrierCode ?? '');
  const [name, setName] = useState(props.carrierName ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const imageSequence = useRef(0);
  const busy = pending || processing || saved;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function choose(file?: File) {
    if (!file) return;
    const sequence = ++imageSequence.current;
    setProcessing(true); setMessage('');
    try { const prepared = await preparePhoto(file); if (sequence === imageSequence.current) { setPhoto(prepared); setPreview(URL.createObjectURL(prepared)); } }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : '图片处理失败，请重新选择'); }
    finally { if (sequence === imageSequence.current) setProcessing(false); }
  }
  function submit(confirm: boolean) {
    const signature = JSON.stringify([tracking, carrier, name, confirm, photo?.lastModified, photo?.size]);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    const form = new FormData();
    for (const [key, value] of Object.entries({ orderId: props.orderId, shipmentId: props.shipmentId, expectedVersion: props.version,
      expectedRevision: props.revision, expectedEditVersion: props.editVersion, expectedWorkOrderVersion: props.workOrderVersion,
      expectedPriceRevision: props.priceRevision, idempotencyKey: request.current.key,
      trackingNo: tracking, carrierCode: carrier, carrierName: name, confirm: String(confirm) })) form.set(key, String(value));
    if (photo) form.set('photo', photo);
    startTransition(async () => {
      try {
        const result = await registerShipmentAction(form);
        setMessage(result.message); setFailed(!result.ok);
        if (result.ok) { setSaved(true); router.refresh(); }
      } catch { setFailed(true); setMessage('保存失败，请重试；若提示内容已更新，请刷新查看'); }
    });
  }
  const ready = Boolean(tracking.trim() && carrier && (carrier !== 'OTHER' || name.trim()));
  const imageUrl = preview ?? (props.labels[0] ? `/api/orders/${props.orderId}/shipments/${props.shipmentId}/labels/${props.labels[0].id}` : null);
  return <div className="@container/shipment-form space-y-4 border-t pt-4" onPaste={(event) => {
    const file = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'))?.getAsFile();
    if (file && !busy) { event.preventDefault(); void choose(file); }
  }}>
    <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-3 @[28rem]/shipment-form:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <label className="min-w-0 space-y-1 text-sm">运单号<Input value={tracking} maxLength={64} onChange={(event) => setTracking(event.target.value)} /></label>
      <label className="min-w-0 space-y-1 text-sm">物流公司<NativeSelect value={carrier} onChange={(event) => setCarrier(event.target.value)}>
        <option value="">请选择</option><option value="ZTO">中通</option><option value="SF">顺丰</option><option value="OTHER">其他</option>
      </NativeSelect></label>
      {carrier === 'OTHER' ? <label className="col-span-full min-w-0 space-y-1 text-sm">物流公司名称<Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label> : null}
      <label className="col-span-full min-w-0 space-y-1 text-sm">面单照片（选填，可粘贴截图）<Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></label>
    </fieldset>
    {processing ? <p role="status">正在处理图片…</p> : null}
    {imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer" className="block" aria-label="查看面单照片">
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated private image and local clipboard preview */}
      <img src={imageUrl} alt="面单照片" className="max-h-48 max-w-full rounded-md border object-contain" />
    </a> : null}
    {photo ? <Button type="button" variant="outline" disabled={busy} onClick={() => { setPhoto(null); setPreview(null); }}>取消本次图片</Button> : null}
    {props.labels.length > 1 ? <Disclosure><DisclosureSummary className="cursor-pointer py-3 text-sm">历史面单照片（{props.labels.length - 1}）</DisclosureSummary><ul>{props.labels.slice(1).map((label) => <li key={label.id}><a className="block py-3 text-primary underline" target="_blank" rel="noreferrer" href={`/api/orders/${props.orderId}/shipments/${props.shipmentId}/labels/${label.id}`}>{label.createdAt}</a></li>)}</ul></Disclosure> : null}
    {message ? <p role={failed ? 'alert' : 'status'} className={failed ? 'text-sm text-destructive' : 'text-sm'}>{message}</p> : null}
    <div className="flex flex-col gap-2 @[28rem]/shipment-form:flex-row @[28rem]/shipment-form:flex-wrap">
      <Button type="button" variant="outline" disabled={busy} onClick={() => submit(false)}>{pending ? '保存中…' : '保存物流资料'}</Button>
      {!props.shipped ? <ConfirmActionController level="L2" disabled={busy || !ready || !props.canConfirm}
        trigger={<Button type="button" disabled={busy || !ready || !props.canConfirm}>确认该地址已发货</Button>}
        onConfirm={() => submit(true)}>
        <ConfirmActionDialog action="确认该地址已发货" changes={[{ label: '运单号', old: props.trackingNo || '未填', new: tracking }]}
          consequences={props.lastPending ? props.chargeable === false ? ['全部地址将标记已发货，工单自动结算；结算后不可再编辑，本单免收费'] : [`全部地址将标记已发货，工单自动结算，应收 ${props.amount} 元进入账单；结算后不可再编辑，尚未收款`] : ['该地址标记已发货，其他地址继续待发货']}
          confirmText="确认发货" />
      </ConfirmActionController> : null}
    </div>
    {!props.shipped && !props.canConfirm && props.disabledReason ? <p className="text-xs text-muted-foreground">{props.disabledReason}</p> : null}
  </div>;
}

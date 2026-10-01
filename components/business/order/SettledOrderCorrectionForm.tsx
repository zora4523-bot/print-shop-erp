'use client';

import { useState, useTransition } from 'react';
import Decimal from 'decimal.js';
import { correctSettledOrderAction } from '@/actions/settled-order-correction';
import { formatMoney, formatMoneyDelta } from '@/lib/dashboard/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Disclosure, DisclosureIndicator, DisclosureSummary } from '@/components/ui/disclosure';
import { ConfirmActionController, ConfirmActionDialog, DisabledReason } from '@/components/ui-business';

type Props = {
  orderId: string;
  orderRevision: number;
  settledFee: string;
  /** 最低可更正到的结算金额（加工费），见 lib/order/settled-correction.ts。 */
  minimumSettledFee: string;
  inDraftBill: boolean;
};

const AMOUNT_PATTERN = /^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

/** 返回更正后的结算金额；输入不是非零金额或结果低于下限时返回 null。 */
export function correctedSettledFee(settledFee: string, amount: string, minimum = '0'): Decimal | null {
  const text = amount.trim();
  if (!AMOUNT_PATTERN.test(text)) return null;
  const delta = new Decimal(text);
  if (delta.isZero()) return null;
  const after = new Decimal(settledFee).plus(delta);
  return after.lt(minimum) || after.isNegative() ? null : after;
}

/**
 * 业主 2026-10-01：发货即结算后，月账单确认前仍可更正金额。只追加一行「结算更正」，
 * 原收费明细不动；账单确认后改在账单里录抵扣或补收。
 */
export function SettledOrderCorrectionForm(props: Props) {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  // 表单实例在多次更正间保留（详情页按工单 id 挂载），成功后换新的请求标识。
  const [requestKey, setRequestKey] = useState(() => globalThis.crypto.randomUUID());
  const after = correctedSettledFee(props.settledFee, amount, props.minimumSettledFee);
  const delta = after ? new Decimal(amount.trim()) : null;

  return <Disclosure className="space-y-3 border-t pt-3">
    <DisclosureSummary className="min-h-11 cursor-pointer gap-2 py-3 text-sm font-medium">结算更正<DisclosureIndicator /></DisclosureSummary>
    <p className="text-sm text-muted-foreground">月账单确认前可更正本单结算金额：少收填正数补收，多收填负数。</p>
    <div className="flex min-w-0 flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1 space-y-1 text-sm">
        <span>更正金额（元；当前结算 {formatMoney(props.settledFee)}，最低可更正到 {formatMoney(props.minimumSettledFee)}）</span>
        <Input inputMode="decimal" value={amount} placeholder="例：-20.00 或 15.00" disabled={pending}
          aria-describedby={message ? 'settled-correction-message' : undefined}
          onChange={(event) => { setAmount(event.target.value); setMessage(null); }} />
      </label>
      {!after || pending ? <DisabledReason cause="prerequisite" reason={pending ? '正在保存…' : `先填写不为 0 的更正金额，更正后不低于 ${formatMoney(props.minimumSettledFee)}。`}>
        <Button variant="outline" disabled>更正结算金额</Button>
      </DisabledReason> : <ConfirmActionController level="L3" reasonLabel="更正原因" disabled={pending}
        trigger={<Button variant="outline">更正结算金额</Button>}
        onConfirm={(reason) => startTransition(async () => {
          const result = await correctSettledOrderAction({
            orderId: props.orderId, expectedRevision: props.orderRevision,
            amount: amount.trim(), reason, idempotencyKey: requestKey,
          });
          if (result.status === 'success') {
            setAmount('');
            setRequestKey(globalThis.crypto.randomUUID());
            setMessage({ text: result.message, failed: false });
          } else {
            setMessage({
              text: result.status === 'invalid'
                ? Object.values(result.fieldErrors).flat()[0] ?? '请检查填写内容'
                : result.message,
              failed: true,
            });
          }
        })}>
        <ConfirmActionDialog action="更正结算金额"
          changes={[{ label: '结算金额', old: formatMoney(props.settledFee), new: formatMoney(after!) }]}
          consequences={[
            `另记一行「结算更正」${formatMoneyDelta(delta!)}，原收费明细不变`,
            props.inDraftBill ? '本单所在的草稿月账单按新金额更新' : '生成月账单时按更正后金额入账',
          ]}
          confirmText="更正结算金额" />
      </ConfirmActionController>}
    </div>
    {message ? <p id="settled-correction-message" role={message.failed ? 'alert' : 'status'}
      className={message.failed ? 'text-sm text-destructive' : 'text-sm'}>{message.text}</p> : null}
  </Disclosure>;
}

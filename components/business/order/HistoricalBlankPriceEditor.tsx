'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmHistoricalBlankPriceAction } from '@/actions/historical-blank-price';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

type Props = {
  orderId: string;
  orderRevision: number;
  priceRevision: number;
  items: Array<{ id: string; name: string; unitPrice: string | null }>;
};

export function HistoricalBlankPriceEditor(props: Props) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <Disclosure className="space-y-3 border-t pt-3">
    <DisclosureSummary className="min-h-11 cursor-pointer py-3 text-sm font-medium">历史材料单价</DisclosureSummary>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {props.items.map((item) => {
      const value = drafts[item.id] ?? item.unitPrice ?? '';
      return <div key={item.id} className="flex min-w-0 flex-wrap items-end gap-3 rounded-md border p-3">
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          <span className="admin-wrap-anywhere">{item.name} · 材料单价（元 / 个，最多四位小数）</span>
          <Input inputMode="decimal" value={value} placeholder="待核价" disabled={pending}
            onChange={(event) => setDrafts((previous) => ({ ...previous, [item.id]: event.target.value }))} />
        </label>
        <ConfirmActionController level="L3" reasonLabel="定价依据" disabled={pending || !value.trim()}
          trigger={<Button variant="outline">确认材料单价</Button>}
          onConfirm={(reason) => startTransition(async () => {
            const result = await confirmHistoricalBlankPriceAction({ orderId: props.orderId, itemId: item.id,
              expectedOrderRevision: props.orderRevision, expectedPriceRevision: props.priceRevision,
              unitPrice: value, reason });
            setMessage(result.status === 'success' ? '材料单价已确认' : result.message);
            if (result.status === 'success') router.refresh();
          })}>
          <ConfirmActionDialog action="确认材料单价"
            changes={[{ label: item.name, old: item.unitPrice ? `${item.unitPrice} 元 / 个` : '待核价', new: `${value} 元 / 个` }]}
            consequences={['当前单价未启用时，原款式重算使用此材料单价；本次不改变已确认工单金额。']}
            confirmText="确认材料单价" />
        </ConfirmActionController>
      </div>;
    })}
  </Disclosure>;
}

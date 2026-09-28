'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';
import { correctProductionRegistrationAction } from '@/actions/production-dispatch';
export function CorrectRegistrationButton({ jobId, revision, quantity }: { jobId: string; revision: number; quantity: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [requestKey] = useState(() => globalThis.crypto.randomUUID());
  return <div aria-busy={pending}><ConfirmActionController level="L3" disabled={pending} reasonLabel="误登记原因" trigger={<Button type="button" variant="outline" className="min-h-11" disabled={pending}>更正误登记</Button>} onConfirm={reason => startTransition(async () => {
    const result = await correctProductionRegistrationAction({ jobId, revision, requestKey, reason, notActuallyProduced: true });
    setMessage(result?.message ?? '未能保存，请重试');
  })}><ConfirmActionDialog action="更正误登记" changes={[{ label: '完成数量', old: `${quantity} 个`, new: '未登记' }]} consequences={['仅用于没有实际生产的误登记；本次提成将冲回，工单恢复生产中。实际生产后改版补做不能使用此操作。']} confirmText="更正误登记" danger /></ConfirmActionController>{message && <p role="status" className="mt-2 text-sm">{message}</p>}</div>;
}

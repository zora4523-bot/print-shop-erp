'use client';

import { useActionState } from 'react';
import {
  confirmAgentMonthlyBillAction,
  createAgentMonthlyBillCreditAction,
  generateAgentMonthlyBillsAction,
  markAgentMonthlyBillPaidAction,
} from '@/actions/agent-monthly-bill';
import type { AgentMonthlyBillActionResult } from '@/actions/agent-monthly-bill.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function Feedback({ state }: { state: AgentMonthlyBillActionResult | null }) {
  if (!state) return null;
  if (state.status === 'success') {
    return <p className="text-xs text-success">{state.message}</p>;
  }
  if (state.status === 'error') {
    return <p className="text-xs text-destructive">{state.message}</p>;
  }
  const messages = Object.values(state.fieldErrors).flat();
  return <p className="text-xs text-destructive">{messages[0] ?? '请检查输入'}</p>;
}

export function GenerateAgentMonthlyBillsForm({
  defaultPeriod,
}: {
  defaultPeriod: string;
}) {
  const [state, action, pending] = useActionState<
    AgentMonthlyBillActionResult | null,
    FormData
  >(generateAgentMonthlyBillsAction, null);
  return (
    <form
      action={action}
      aria-busy={pending}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="space-y-1">
        <label htmlFor="agent-bill-period" className="text-xs text-muted-foreground">
          结算发生月（上海时区）
        </label>
        <Input
          id="agent-bill-period"
          name="period"
          type="month"
          defaultValue={defaultPeriod}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? '生成中…' : '生成或更新草稿'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ConfirmAgentMonthlyBillForm({
  billId,
  initialIdempotencyKey,
}: {
  billId: string;
  initialIdempotencyKey: string;
}) {
  const bound = confirmAgentMonthlyBillAction.bind(null, billId);
  const [state, action, pending] = useActionState<
    AgentMonthlyBillActionResult | null,
    FormData
  >(bound, null);
  return (
    <form action={action} aria-busy={pending} className="space-y-2">
      <input type="hidden" name="idempotencyKey" value={initialIdempotencyKey} />
      <Button type="submit" disabled={pending}>
        {pending ? '确认中…' : '确认并冻结账单'}
      </Button>
      <p className="text-xs text-muted-foreground">
        确认后账单不可修改。
      </p>
      <Feedback state={state} />
    </form>
  );
}

export function MarkAgentMonthlyBillPaidForm({
  billId,
  lockedAmount,
  initialIdempotencyKey,
}: {
  billId: string;
  lockedAmount: string;
  initialIdempotencyKey: string;
}) {
  const bound = markAgentMonthlyBillPaidAction.bind(null, billId);
  const [state, action, pending] = useActionState<
    AgentMonthlyBillActionResult | null,
    FormData
  >(bound, null);
  return (
    <form action={action} aria-busy={pending} className="space-y-3">
      <input type="hidden" name="idempotencyKey" value={initialIdempotencyKey} />
      <p className="text-sm">
        本次收款金额：
        <strong className="font-sans tabular-nums">¥ {lockedAmount}</strong>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="agent-bill-payment-method" className="text-xs text-muted-foreground">
            收款方式
          </label>
          <Input id="agent-bill-payment-method" name="paymentMethod" maxLength={100} />
        </div>
        <div className="space-y-1">
          <label htmlFor="agent-bill-reference" className="text-xs text-muted-foreground">
            流水号
          </label>
          <Input id="agent-bill-reference" name="referenceNo" maxLength={100} />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? '记录中…' : '标记已收'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function CreateAgentMonthlyBillCreditForm({
  billId,
  sourceItemId,
  sourceAmount,
  initialIdempotencyKey,
}: {
  billId: string;
  sourceItemId: string;
  sourceAmount: string;
  initialIdempotencyKey: string;
}) {
  const bound = createAgentMonthlyBillCreditAction.bind(null, billId);
  const [state, action, pending] = useActionState<
    AgentMonthlyBillActionResult | null,
    FormData
  >(bound, null);
  return (
    <form
      action={action}
      aria-busy={pending}
      className="mt-3 grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[9rem_1fr_auto]"
    >
      <input type="hidden" name="idempotencyKey" value={initialIdempotencyKey} />
      <input type="hidden" name="sourceItemId" value={sourceItemId} />
      <div className="space-y-1">
        <label htmlFor={`credit-amount-${sourceItemId}`} className="text-xs text-muted-foreground">
          负项金额（上限 ¥ {sourceAmount}）
        </label>
        <Input
          id={`credit-amount-${sourceItemId}`}
          name="amount"
          inputMode="decimal"
          placeholder="0.00"
          required
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`credit-reason-${sourceItemId}`} className="text-xs text-muted-foreground">
          原因
        </label>
        <Input
          id={`credit-reason-${sourceItemId}`}
          name="reason"
          maxLength={500}
          required
        />
      </div>
      <Button type="submit" variant="outline" disabled={pending} className="self-end">
        {pending ? '记录中…' : '记录负项'}
      </Button>
      <div className="sm:col-span-3">
        <Feedback state={state} />
      </div>
    </form>
  );
}

'use client';

import { useActionState, useCallback, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ActionNotice,
  ConfirmActionDialog,
  FormErrorSummary,
  type FormErrorSummaryItem,
} from '@/components/ui-business';
import { recordBillPaymentAction } from '@/actions/bill';
import type { RecordBillPaymentResult } from '@/actions/bill.types';

type Props = {
  billId: string;
  remainingAmount: string;
  initialIdempotencyKey: string;
};

type PaymentPreview = {
  amount: string;
  paidAt: string;
  paymentMethod: string;
  referenceNo: string;
};

export function paymentImpactItems(
  preview: PaymentPreview,
  remainingAmount: string,
): string[] {
  const amount = Number(preview.amount);
  const remaining = Number(remainingAmount);
  const after = remaining - amount;
  const settlement =
    Number.isFinite(after) && Math.abs(after) < 0.005
      ? '本次收款后账单将进入已结清终态，不能直接回退。'
      : `本次收款后预计仍有 ¥ ${after.toFixed(2)} 未收。`;

  return [
    `本次收款：¥ ${amount.toFixed(2)}`,
    `收款时间：${preview.paidAt.replace('T', ' ')}`,
    `收款方式：${preview.paymentMethod || '未填写'}`,
    `流水号：${preview.referenceNo || '未填写'}`,
    settlement,
    '系统使用本次请求标识防止重复记账；结果未确认前请勿再次录入。',
  ];
}

export function RecordPaymentForm({
  billId,
  remainingAmount,
  initialIdempotencyKey,
}: Props) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const submitPayment = useCallback(
    async (previous: RecordBillPaymentResult | null, formData: FormData) => {
      const result = await recordBillPaymentAction(billId, previous, formData);
      if (result.status === 'success') {
        formRef.current?.reset();
        setIdempotencyKey(window.crypto.randomUUID());
      }
      return result;
    },
    [billId],
  );
  const [state, action, pending] = useActionState<
    RecordBillPaymentResult | null,
    FormData
  >(submitPayment, null);
  const defaultPaidAt = shanghaiDateTimeLocal(new Date());
  const inputIds = {
    amount: `${formId}-amount`,
    paidAt: `${formId}-paid-at`,
    paymentMethod: `${formId}-payment-method`,
    referenceNo: `${formId}-reference-no`,
    remark: `${formId}-remark`,
  } as const;
  const fieldLabels: Record<string, string> = {
    amount: '本次收款金额',
    paidAt: '收款时间',
    paymentMethod: '收款方式',
    referenceNo: '流水号',
    remark: '备注',
    idempotencyKey: '付款请求',
  };
  const fieldErrors = state?.status === 'invalid' ? state.fieldErrors : {};
  const errorSummary: FormErrorSummaryItem[] = Object.entries(fieldErrors).flatMap(
    ([field, messages]) =>
      messages.map((message) => ({
        fieldId:
          inputIds[field as keyof typeof inputIds] ?? inputIds.amount,
        label: fieldLabels[field] ?? field,
        message,
      })),
  );
  const visibleState = pending ? null : state;

  function prepareConfirmation() {
    const form = formRef.current;
    if (!form) return;

    const amountInput = form.elements.namedItem('amount');
    if (!(amountInput instanceof HTMLInputElement)) return;
    amountInput.setCustomValidity('');
    const amount = Number(amountInput.value);
    const remaining = Number(remainingAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      amountInput.setCustomValidity('付款金额必须大于 0');
    } else if (!Number.isFinite(remaining) || amount - remaining > 0.0001) {
      amountInput.setCustomValidity(`本次最多可录入 ${remainingAmount}`);
    }
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    setPreview({
      amount: String(formData.get('amount') ?? ''),
      paidAt: String(formData.get('paidAt') ?? ''),
      paymentMethod: String(formData.get('paymentMethod') ?? '').trim(),
      referenceNo: String(formData.get('referenceNo') ?? '').trim(),
    });
    setConfirmationOpen(true);
  }

  return (
    <form
      ref={formRef}
      id={formId}
      action={action}
      aria-busy={pending}
      className="space-y-3"
      data-risk-level="L2"
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset
        disabled={pending}
        className="grid min-w-0 grid-cols-1 gap-3 disabled:opacity-70 sm:grid-cols-2"
      >
        <label className="space-y-1 text-sm">
          <span>本次收款金额</span>
          <Input
            id={inputIds.amount}
            type="text"
            name="amount"
            inputMode="decimal"
            placeholder={`最多 ${remainingAmount}`}
            className="font-sans tabular-nums"
            pattern="\d{1,10}(\.\d{1,2})?"
            maxLength={13}
            onInput={(event) => event.currentTarget.setCustomValidity('')}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>收款时间</span>
          <Input
            id={inputIds.paidAt}
            type="datetime-local"
            name="paidAt"
            defaultValue={defaultPaidAt}
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>收款方式</span>
          <Input
            id={inputIds.paymentMethod}
            name="paymentMethod"
            maxLength={32}
            placeholder="微信 / 支付宝 / 银行"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>流水号</span>
          <Input id={inputIds.referenceNo} name="referenceNo" maxLength={64} />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span>备注</span>
          <Input
            id={inputIds.remark}
            name="remark"
            maxLength={200}
            placeholder="例如：首付款、第二笔尾款"
          />
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          ref={triggerRef}
          type="button"
          disabled={pending}
          aria-busy={pending}
          className="min-h-11"
          onClick={prepareConfirmation}
        >
          {pending ? '正在录入…' : '核对并录入付款'}
        </Button>
      </div>
      <ConfirmActionDialog
        level="L2"
        formId={formId}
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={triggerRef}
        disabled={pending || preview === null}
        title="确认录入这笔收款？"
        description={`提交前未收金额为 ¥ ${remainingAmount}。请逐项核对金额、时间和流水信息。`}
        impactItems={
          preview ? paymentImpactItems(preview, remainingAmount) : []
        }
        confirmLabel="确认录入付款"
      />
      {visibleState?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title="付款流水已录入"
          description={`已付 ¥ ${visibleState.newPaidAmount} / ¥ ${visibleState.totalAmount} · ${visibleState.billStatus === 'FULLY_PAID' ? '账单已结清' : '账单部分结清'}`}
        />
      ) : null}
      {visibleState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="付款流水未录入"
          description={visibleState.message}
        />
      ) : null}
      {visibleState?.status === 'invalid' ? (
        <FormErrorSummary errors={errorSummary} />
      ) : null}
    </form>
  );
}

function shanghaiDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

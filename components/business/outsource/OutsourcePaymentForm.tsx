'use client';

import {
  useActionState,
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { recordOutsourcePaymentAction } from '@/actions/outsource';
import type { OutsourcePaymentMutationResult } from '@/actions/outsource.types';
import { formatDateTimeLocalShanghai } from '@/lib/format/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ActionNotice,
  ConfirmActionController, ConfirmActionDialog,
  FormErrorSummary,
  type FormErrorSummaryItem,
} from '@/components/ui-business';
import { nextOutsourceIdempotencyKey } from './idempotency';

type Props = {
  id: string;
  supplierName: string;
  orderNo: string | null;
  remainingAmount: string;
  initialIdempotencyKey: string;
};

type PaymentPreview = {
  amount: string;
  paidAt: string;
  method: string;
  reference: string;
};

export function outsourcePaymentImpactItems(
  preview: PaymentPreview,
  remainingAmount: string,
): string[] {
  const amount = Number(preview.amount);
  const remaining = Number(remainingAmount);
  const after = remaining - amount;
  const settlement =
    Number.isFinite(after) && Math.abs(after) < 0.005
      ? '本次付款后该外协单将全部结清。'
      : `本次付款后预计仍有 ¥ ${after.toFixed(2)} 未付。`;

  return [
    `本次付款：¥ ${amount.toFixed(2)}`,
    `付款时间：${preview.paidAt.replace('T', ' ')}`,
    `付款方式：${preview.method || '未填写'}`,
    `付款流水号：${preview.reference || '未填写'}`,
    settlement,
    '这笔流水只记入外协加工付款，不进入销售账单或员工工资。',
    '系统使用本次请求标识防止重复记账；结果未确认前请勿再次录入。',
  ];
}

export function OutsourcePaymentForm({
  id,
  supplierName,
  orderNo,
  remainingAmount,
  initialIdempotencyKey,
}: Props) {
  const router = useRouter();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const [idempotencyKey, setIdempotencyKey] = useState(
    initialIdempotencyKey,
  );
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [preview, setPreview] = useState<PaymentPreview | null>(null);
  const submitPayment = useCallback(
    async (
      previous: OutsourcePaymentMutationResult | null,
      formData: FormData,
    ) => {
      const result = await recordOutsourcePaymentAction(id, previous, formData);
      setIdempotencyKey((current) =>
        nextOutsourceIdempotencyKey(
          current,
          result,
          () => window.crypto.randomUUID(),
        ),
      );
      if (result.status === 'success') {
        formRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    [id, router],
  );
  const [state, action, pending] = useActionState<
    OutsourcePaymentMutationResult | null,
    FormData
  >(submitPayment, null);
  const errors = state?.status === 'invalid' ? state.fieldErrors : {};
  const inputIds = {
    amount: 'outsource-payment-amount',
    paidAt: 'outsource-payment-paid-at',
    method: 'outsource-payment-method',
    reference: 'outsource-payment-reference',
    remark: 'outsource-payment-remark',
  } as const;
  const fieldLabels: Record<string, string> = {
    amount: '本次付款金额',
    paidAt: '付款时间',
    method: '付款方式',
    reference: '付款流水号',
    remark: '备注',
    idempotencyKey: '付款请求',
  };
  const errorSummary: FormErrorSummaryItem[] = Object.entries(errors).flatMap(
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
      method: String(formData.get('method') ?? '').trim(),
      reference: String(formData.get('reference') ?? '').trim(),
    });
    setConfirmationOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    // 输入框内按 Enter 也只能打开确认层，不得直接记账。
    event.preventDefault();
    prepareConfirmation();
  }

  return (
    <form
      ref={formRef}
      id={formId}
      action={action}
      onSubmit={handleSubmit}
      aria-busy={pending}
      className="space-y-3"
      data-risk-level="L2"
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset
        disabled={pending}
        className="grid min-w-0 grid-cols-1 gap-3 disabled:opacity-70 sm:grid-cols-2"
      >
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-amount">本次付款金额（元）</Label>
          <Input
            id="outsource-payment-amount"
            name="amount"
            inputMode="decimal"
            placeholder={`最多 ${remainingAmount}`}
            className="font-sans tabular-nums"
            required
            aria-invalid={Boolean(errors.amount?.length)}
            onInput={(event) => event.currentTarget.setCustomValidity('')}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-paid-at">付款时间</Label>
          <Input
            id="outsource-payment-paid-at"
            type="datetime-local"
            name="paidAt"
            defaultValue={formatDateTimeLocalShanghai(new Date())}
            required
            aria-invalid={Boolean(errors.paidAt?.length)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-method">付款方式（选填）</Label>
          <Input
            id="outsource-payment-method"
            name="method"
            maxLength={32}
            placeholder="微信 / 支付宝 / 银行"
            aria-invalid={Boolean(errors.method?.length)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="outsource-payment-reference">付款流水号（选填）</Label>
          <Input
            id="outsource-payment-reference"
            name="reference"
            maxLength={64}
            aria-invalid={Boolean(errors.reference?.length)}
          />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="outsource-payment-remark">备注（选填）</Label>
          <Input
            id="outsource-payment-remark"
            name="remark"
            maxLength={200}
            placeholder="例如：首付款、第二笔尾款"
            aria-invalid={Boolean(errors.remark?.length)}
          />
        </div>
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
          {pending ? '正在记录…' : '核对并记录外协付款'}
        </Button>
      </div>
      <ConfirmActionController level="L2"
        formId={formId}
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={triggerRef}
        disabled={pending || preview === null}
        onConfirm={() => {
          confirmedRef.current = true;
        }}>
        <ConfirmActionDialog action={`向${supplierName}记录外协付款${orderNo ? ` · ${orderNo}` : ''}`} changes={[]} consequences={
          preview ? outsourcePaymentImpactItems(preview, remainingAmount) : []
        } confirmText="确认记录付款" />
      </ConfirmActionController>

      {visibleState?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title="外协付款流水已记入"
          description={`已付 ¥ ${visibleState.newPaidAmount} / ¥ ${visibleState.totalAmount} · ${visibleState.isFullyPaid ? '已结清' : `未付 ¥ ${visibleState.remainingAmount}`}`}
        />
      ) : null}
      {visibleState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="外协付款未记入"
          description={visibleState.message}
        />
      ) : null}
      {visibleState?.status === 'invalid' ? (
        <FormErrorSummary errors={errorSummary} />
      ) : null}
    </form>
  );
}

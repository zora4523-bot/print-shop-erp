'use client';

import {
  useActionState,
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { recordCsPayrollPaymentAction } from '@/actions/owner-salary';
import type { CsPayrollPaymentResult } from '@/actions/owner-salary.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ActionNotice,
  ConfirmActionDialog,
  FormErrorSummary,
  FormMessage,
  formMessageA11yProps,
  type FormErrorSummaryItem,
} from '@/components/ui-business';

type Props = {
  periodId: string;
  csUserName: string;
  periodLabel: string;
  remainingBase: string;
  remainingCommission: string;
  commissionAvailable: boolean;
  initialIdempotencyKey: string;
};

export type CsPayrollPaymentPreview = {
  baseAmount: string;
  commissionAmount: string;
  paidAt: string;
  paymentMethod: string;
  referenceNo: string;
};

function money(value: string): string {
  const parsed = Number(value || '0');
  return Number.isFinite(parsed) ? parsed.toFixed(2) : value;
}

export function csPayrollPaymentImpactItems({
  preview,
  csUserName,
  periodLabel,
  remainingBase,
  remainingCommission,
  commissionAvailable,
}: {
  preview: CsPayrollPaymentPreview;
  csUserName: string;
  periodLabel: string;
  remainingBase: string;
  remainingCommission: string;
  commissionAvailable: boolean;
}): string[] {
  const baseAmount = Number(preview.baseAmount || '0');
  const commissionAmount = Number(preview.commissionAmount || '0');
  const baseAfter = Number(remainingBase) - baseAmount;
  const commissionAfter = Number(remainingCommission) - commissionAmount;
  const fullyPaid =
    commissionAvailable &&
    Math.abs(baseAfter) < 0.005 &&
    Math.abs(commissionAfter) < 0.005;

  return [
    `发放对象：${csUserName}；工资周期：${periodLabel}。`,
    `本次底薪 ¥ ${money(preview.baseAmount)}；记录后预计剩余 ¥ ${baseAfter.toFixed(2)}。`,
    commissionAvailable
      ? `本次提成 ¥ ${money(preview.commissionAmount)}；记录后预计剩余 ¥ ${commissionAfter.toFixed(2)}。`
      : '周期尚未结算，本次不能发放提成。',
    `发放时间：${preview.paidAt.replace('T', ' ')}；方式：${preview.paymentMethod || '未填写'}；流水号：${preview.referenceNo || '未填写'}。`,
    fullyPaid
      ? '这笔入账后，已结算周期的底薪和提成将全部发放完成。'
      : !commissionAvailable && Math.abs(baseAfter) < 0.005
        ? '这笔入账后底薪将全部发放；周期尚未结算，暂时不能判定提成和周期整体发放状态。'
        : '这笔入账后仍保留未发余额，后续需通过新流水继续发放。',
    '确认后会追加一条不可覆盖的工资流水；当前界面不支持撤销或删除。',
    '系统会沿用当前请求标识防止重复入账；本操作不会自动发起银行或支付平台转账。',
  ];
}

export function CsPayrollPaymentForm({
  periodId,
  csUserName,
  periodLabel,
  remainingBase,
  remainingCommission,
  commissionAvailable,
  initialIdempotencyKey,
}: Props) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const [idempotencyKey, setIdempotencyKey] = useState(initialIdempotencyKey);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [preview, setPreview] = useState<CsPayrollPaymentPreview | null>(null);
  const submitPayment = useCallback(
    async (previous: CsPayrollPaymentResult | null, formData: FormData) => {
      const result = await recordCsPayrollPaymentAction(
        periodId,
        previous,
        formData,
      );
      if (result.status === 'success') {
        formRef.current?.reset();
        setIdempotencyKey(window.crypto.randomUUID());
        setPreview(null);
      }
      return result;
    },
    [periodId],
  );
  const [state, action, pending] = useActionState<
    CsPayrollPaymentResult | null,
    FormData
  >(submitPayment, null);
  const fieldErrors =
    !pending && state?.status === 'invalid' ? state.fieldErrors : {};
  const visibleState = pending ? null : state;
  const inputIds = {
    baseAmount: `${formId}-base-payment`,
    commissionAmount: `${formId}-commission-payment`,
    paidAt: `${formId}-paid-at`,
    paymentMethod: `${formId}-method`,
    referenceNo: `${formId}-reference`,
    remark: `${formId}-remark`,
  } as const;
  const fieldLabels: Record<string, string> = {
    baseAmount: '本次发放底薪',
    commissionAmount: '本次发放提成',
    paidAt: '发放时间',
    paymentMethod: '发放方式',
    referenceNo: '流水号',
    remark: '备注',
    idempotencyKey: '工资发放请求',
  };
  const errorSummary: FormErrorSummaryItem[] = Object.entries(fieldErrors).flatMap(
    ([field, messages]) =>
      messages.map((message) => ({
        fieldId:
          inputIds[field as keyof typeof inputIds] ?? inputIds.baseAmount,
        label: fieldLabels[field] ?? field,
        message,
      })),
  );

  function prepareConfirmation() {
    const form = formRef.current;
    if (!form) return;
    const baseInput = form.elements.namedItem('baseAmount');
    const commissionInput = form.elements.namedItem('commissionAmount');
    if (
      !(baseInput instanceof HTMLInputElement) ||
      !(commissionInput instanceof HTMLInputElement)
    ) {
      return;
    }

    baseInput.setCustomValidity('');
    commissionInput.setCustomValidity('');
    const baseAmount = Number(baseInput.value || '0');
    const commissionAmount = Number(commissionInput.value || '0');
    if (baseAmount + commissionAmount <= 0) {
      baseInput.setCustomValidity('本次发放的底薪或提成至少填写一项');
    } else if (baseAmount - Number(remainingBase) > 0.0001) {
      baseInput.setCustomValidity(`底薪本次最多可发 ${remainingBase}`);
    }
    if (!commissionAvailable && commissionAmount > 0) {
      commissionInput.setCustomValidity('周期结算后才能发放提成');
    } else if (commissionAmount - Number(remainingCommission) > 0.0001) {
      commissionInput.setCustomValidity(
        `提成本次最多可发 ${remainingCommission}`,
      );
    }
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    setPreview({
      baseAmount: String(formData.get('baseAmount') ?? ''),
      commissionAmount: String(formData.get('commissionAmount') ?? ''),
      paidAt: String(formData.get('paidAt') ?? ''),
      paymentMethod: String(formData.get('paymentMethod') ?? '').trim(),
      referenceNo: String(formData.get('referenceNo') ?? '').trim(),
    });
    setConfirmationOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    // Enter 键也必须经过同一个确认层，不能绕过 L2。
    event.preventDefault();
    prepareConfirmation();
  }

  return (
    <form
      ref={formRef}
      id={formId}
      action={action}
      onSubmit={handleSubmit}
      onInputCapture={(event) => {
        const target = event.target;
        if (
          !(target instanceof HTMLInputElement) ||
          (target.name !== 'baseAmount' && target.name !== 'commissionAmount')
        ) {
          return;
        }
        const form = formRef.current;
        const baseInput = form?.elements.namedItem('baseAmount');
        const commissionInput = form?.elements.namedItem('commissionAmount');
        if (baseInput instanceof HTMLInputElement) {
          baseInput.setCustomValidity('');
        }
        if (commissionInput instanceof HTMLInputElement) {
          commissionInput.setCustomValidity('');
        }
      }}
      aria-busy={pending}
      className="space-y-4"
      data-risk-level="L2"
    >
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <fieldset
        disabled={pending}
        className="grid min-w-0 grid-cols-1 gap-3 disabled:opacity-70 sm:grid-cols-2"
      >
        <AmountField
          id={inputIds.baseAmount}
          name="baseAmount"
          label="本次发放底薪（元）"
          hint={`剩余可发 ¥ ${remainingBase}`}
          error={fieldErrors.baseAmount?.[0]}
        />
        <AmountField
          id={inputIds.commissionAmount}
          name="commissionAmount"
          label="本次发放提成（元）"
          hint={
            commissionAvailable
              ? `剩余可发 ¥ ${remainingCommission}`
              : '周期结算后才可发放提成'
          }
          error={fieldErrors.commissionAmount?.[0]}
          disabled={!commissionAvailable}
        />
        <div className="space-y-1.5">
          <Label htmlFor={inputIds.paidAt}>发放时间</Label>
          <Input
            id={inputIds.paidAt}
            type="datetime-local"
            name="paidAt"
            defaultValue={shanghaiDateTimeLocal(new Date())}
            required
            className="min-h-11"
            {...formMessageA11yProps(
              inputIds.paidAt,
              fieldErrors.paidAt?.[0] ? 'error' : 'hint',
            )}
          />
          <FormMessage
            fieldId={inputIds.paidAt}
            tone={fieldErrors.paidAt?.[0] ? 'error' : 'hint'}
          >
            {fieldErrors.paidAt?.[0] ?? '按上海时区记录实际发放时间。'}
          </FormMessage>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={inputIds.paymentMethod}>发放方式</Label>
          <Input
            id={inputIds.paymentMethod}
            name="paymentMethod"
            maxLength={32}
            placeholder="微信 / 支付宝 / 银行"
            className="min-h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={inputIds.referenceNo}>流水号</Label>
          <Input
            id={inputIds.referenceNo}
            name="referenceNo"
            maxLength={64}
            className="min-h-11"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={inputIds.remark}>备注</Label>
          <Input
            id={inputIds.remark}
            name="remark"
            maxLength={200}
            placeholder="例如：第 3 月底薪、周期提成"
            className="min-h-11"
          />
        </div>
      </fieldset>

      <Button
        ref={triggerRef}
        type="button"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11"
        onClick={prepareConfirmation}
      >
        {pending ? '记录中…' : '核对并记录工资发放'}
      </Button>
      {/* remark 是业务备注，不是服务端强制持久的审计 reason。
          不能把它偷换成 L3 理由，所以此处保持 L2 并展示完整流水影响。 */}
      <ConfirmActionDialog
        level="L2"
        formId={formId}
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={triggerRef}
        disabled={pending || preview === null}
        title={`确认记录 ${csUserName} 的这笔工资发放？`}
        description="这会追加不可覆盖的财务流水。请逐项核对金额、时间、方式和流水号。"
        impactItems={
          preview
            ? csPayrollPaymentImpactItems({
                preview,
                csUserName,
                periodLabel,
                remainingBase,
                remainingCommission,
                commissionAvailable,
              })
            : []
        }
        confirmLabel="确认追加发放流水"
        onConfirm={() => {
          confirmedRef.current = true;
        }}
      />

      {visibleState?.status === 'error' ? (
        <ActionNotice
          tone="error"
          title="工资发放未记录"
          description={visibleState.message}
        />
      ) : null}
      {visibleState?.status === 'invalid' ? (
        <FormErrorSummary errors={errorSummary} />
      ) : null}
      {visibleState?.status === 'success' ? (
        <ActionNotice
          tone="success"
          title="工资发放流水已记录"
          description={`累计底薪 ¥ ${visibleState.paidBase}，累计提成 ¥ ${visibleState.paidCommission}。${visibleState.isFullyPaid ? '本周期工资已全部发放。' : '本周期仍有未发金额。'}`}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        每次发放都会追加独立流水，不能覆盖或撤销。提交前请核对金额、时间和流水号。
      </p>
    </form>
  );
}

function AmountField({
  id,
  name,
  label,
  hint,
  error,
  disabled = false,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        pattern="[0-9]{1,10}([.][0-9]{1,2})?"
        maxLength={13}
        placeholder="0.00"
        disabled={disabled}
        className="min-h-11 font-sans tabular-nums"
        onInput={(event) => event.currentTarget.setCustomValidity('')}
        {...formMessageA11yProps(id, error ? 'error' : 'hint')}
      />
      <FormMessage fieldId={id} tone={error ? 'error' : 'hint'}>
        {error ?? hint}
      </FormMessage>
    </div>
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

'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  reportProductionOperationAction,
  reportProductionProgressAction,
} from '@/actions/production-operations';
import type {
  ReportProductionOperationActionResult,
  ReportProductionProgressActionResult,
} from '@/actions/production-operations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/dashboard/format';

export function OperationReportForm({
  context = [],
  quantityUnit = '个',
  operationId,
  payrollRevision,
  rateKey,
  idempotencyKey,
  remainingQty,
  workOrderProgressRemainingQty,
}: {
  context?: string[];
  quantityUnit?: '个' | '袋';
  operationId: string;
  payrollRevision: number;
  rateKey: string;
  idempotencyKey: string;
  remainingQty: string;
  workOrderProgressRemainingQty: string;
}) {
  const action = reportProductionOperationAction.bind(null, operationId);
  const [state, formAction, pending] = useActionState<
    ReportProductionOperationActionResult | null,
    FormData
  >(action, null);

  return (
    <ReportFields
      context={context}
      quantityUnit={quantityUnit}
      rateKey={rateKey}
      payrollRevision={payrollRevision}
      state={state}
      formAction={formAction}
      pending={pending}
      idempotencyKey={idempotencyKey}
      remainingQty={remainingQty}
      workOrderProgressRemainingQty={workOrderProgressRemainingQty}
      explanation={quantityUnit === '袋' ? '合格完成数填袋数；工单件数进度填完成包装的产品个数。例如每袋 10 个，完成 10 袋对应 100 个。' : '合格完成数填本工序完成的个数，不用乘过版次数；工单件数进度填本次完成全部烫金的产品个数。'}
      successMessage={
        state?.status === 'success'
          ? `已记录本次报工，计件金额 ${formatMoney(state.amount)}`
          : null
      }
    />
  );
}

export function ProgressReportForm({
  progressStepId,
  idempotencyKey,
  remainingQty,
}: {
  progressStepId: string;
  idempotencyKey: string;
  remainingQty: string;
}) {
  const action = reportProductionProgressAction.bind(null, progressStepId);
  const [state, formAction, pending] = useActionState<
    ReportProductionProgressActionResult | null,
    FormData
  >(action, null);

  return (
    <ReportFields
      state={state}
      formAction={formAction}
      pending={pending}
      idempotencyKey={idempotencyKey}
      remainingQty={remainingQty}
      workOrderProgressRemainingQty={null}
      explanation="合格数用于推进工序；缺陷数与返工数只做记录，此步骤不计薪。"
      successMessage={
        state?.status === 'success'
          ? '已记录本次生产进度（不计入工资）'
          : null
      }
    />
  );
}

type ReportFormState =
  | ReportProductionOperationActionResult
  | ReportProductionProgressActionResult
  | null;

function ReportFields({
  context = [],
  quantityUnit = '个',
  rateKey,
  payrollRevision,
  state,
  formAction,
  pending,
  idempotencyKey,
  remainingQty,
  workOrderProgressRemainingQty,
  explanation,
  successMessage,
}: {
  context?: string[];
  quantityUnit?: '个' | '袋';
  rateKey?: string;
  payrollRevision?: number;
  state: ReportFormState;
  formAction: (payload: FormData) => void;
  pending: boolean;
  idempotencyKey: string;
  remainingQty: string;
  workOrderProgressRemainingQty: string | null;
  explanation: string;
  successMessage: string | null;
}) {
  const [review, setReview] = useState<{ completed: string; progress: string | null; defect: string; rework: string } | null>(null);
  return (
    <form
      action={formAction}
      onChange={() => setReview(null)}
      onSubmit={(event) => {
        if (review) { setReview(null); return; }
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setReview({ completed: String(data.get('completedQty')), progress: workOrderProgressRemainingQty === null ? null : String(data.get('workOrderProgressQuantity')), defect: String(data.get('defectQty')), rework: String(data.get('reworkQty')) });
      }}
      aria-busy={pending}
      className="space-y-4"
    >
      <fieldset disabled={pending} hidden={Boolean(review)} className="space-y-4 border-0 p-0">
        {rateKey && <input type="hidden" name="expectedRateKey" value={rateKey} />}
        {payrollRevision !== undefined && <input type="hidden" name="expectedPayrollRevision" value={payrollRevision} />}
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <QuantityField
          id="completedQty"
          label="本次合格完成数"
          unit={quantityUnit}
          defaultValue=""
          maximum={remainingQty}
          disabled={pending}
        />
        {workOrderProgressRemainingQty !== null ? (
          <QuantityField
            id="workOrderProgressQuantity"
            label="本次工单件数进度"
            unit="个"
            defaultValue=""
            maximum={workOrderProgressRemainingQty}
            disabled={pending}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <QuantityField
            id="defectQty"
            label="缺陷数"
            unit={quantityUnit}
            defaultValue="0"
            disabled={pending}
          />
          <QuantityField
            id="reworkQty"
            label="返工数"
            unit={quantityUnit}
            defaultValue="0"
            disabled={pending}
          />
        </div>
        <p className="text-xs text-muted-foreground">{explanation}</p>
        {state?.status === 'invalid' || state?.status === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}
        {state?.status === 'success' ? (
          <p role="status" className="text-sm text-success-foreground">
            {successMessage}
            {'amount' in state && <Link href={`/worker/reports/${state.reportId}`} className="mt-2 flex min-h-11 items-center underline">查看本次报工明细</Link>}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="min-h-13 w-full">
          {pending ? '提交中…' : '提交扫码报工'}
        </Button>
      </fieldset>
      {review && <section aria-label="核对本次报工" className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
        <h3 className="font-semibold">核对本次报工</h3>
        {context.map((line, index) => <p key={index} className="break-words">{line}</p>)}
        <p>合格完成数：{review.completed} {quantityUnit}</p>
        {review.progress !== null && <p>工单件数进度：{review.progress} 个</p>}
        <p>缺陷数：{review.defect} · 返工数：{review.rework}</p>
        <p>{rateKey ? '提交后按本次数量记录生产进度和本人提成，需核定的提成由管理员确认。' : '提交后记录本次生产进度，不计入工资。'}</p>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>确认报工</Button><Button type="button" variant="outline" disabled={pending} onClick={() => setReview(null)}>返回修改</Button></div>
      </section>}
    </form>
  );
}

function QuantityField({
  id,
  label,
  defaultValue,
  unit = '个',
  maximum,
  disabled,
}: {
  id: string;
  label: string;
  defaultValue: string;
  unit?: string;
  maximum?: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor={id}>{label}</Label><span className="text-sm text-muted-foreground">{maximum !== undefined ? `最多 ${maximum} ${unit}` : unit}</span></div>
      <Input
        id={id}
        name={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={maximum}
        step={1}
        required
        disabled={disabled}
        defaultValue={defaultValue}
      />
    </div>
  );
}

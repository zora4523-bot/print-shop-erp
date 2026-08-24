'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reportTaskAction } from '@/actions/production';
import type { ReportTaskMutationResult } from '@/actions/production.types';

type Props = {
  taskId: string;
  plannedQty: number;
  /**
   * 计划数 × Setting 的倍数上限。合计**达到**它服务端一律拒绝（勾了确认也拒）。
   * 只用来写说明文字 —— 判定全在服务端，见下面 NumberField 里为什么不设 max。
   */
  maxReportQty: number;
  isPiecework: boolean;
};

export function ReportTaskForm({
  taskId,
  plannedQty,
  maxReportQty,
  isPiecework,
}: Props) {
  // `bind` on a Server Action keeps the $$FORM_ACTION marker, so React can
  // emit the native form action + hidden $ACTION_ID at SSR time. Passing
  // `formAction` straight to <form action> (rather than wrapping it in an
  // arrow) is what preserves the zero-JS submit path — 车间弱网/hydration
  // 失败时师傅仍能报工。See DECISIONS.md 2026-08-17.
  const bound = reportTaskAction.bind(null, taskId);
  const [state, formAction, pending] = useActionState<
    ReportTaskMutationResult | null,
    FormData
  >(bound, null);
  const router = useRouter();

  // On success, kick the router to refresh server state — the task
  // page itself will re-render showing the completed view. We don't
  // navigate away since the worker might want to look at the payoff
  // breakdown.
  if (state?.status === 'success' && !pending) {
    // Defer to microtask so React finishes committing before refresh.
    queueMicrotask(() => router.refresh());
  }

  // 回填。零 JS 下一次提交就是一次整页 POST + 服务端重渲染，浏览器不会保留
  // 输入框里的值。不回填的话「超报被拦下 → 数字被重置回计划数 → 勾确认再
  // 提交」会静默按计划数入库 —— 正好把这个守卫要防的事情做实。
  const values = state && state.status !== 'success' ? state.values : null;

  // 服务端状态保证零 JS 提交后仍会显示确认框；hydration 成功时再叠加即时
  // 合计，让师傅一输到超计划就能看到确认动作，不必先走一次失败往返。
  // defaultChecked 跟着回填走：第二次提交若撞上别的校验错误，已确认状态和
  // 三个数量都不能被悄悄清掉。
  const overReport = state?.status === 'invalid' ? state.overReport : undefined;
  const confirmErrors = fieldErrors(state, 'overReportConfirmed');
  const [liveTotal, setLiveTotal] = useState<number | null>(() => {
    if (!values) return null;
    const parts = [values.completedQty, values.defectQty, values.reworkQty].map(
      (value) => Number(value),
    );
    return parts.every(Number.isFinite)
      ? parts.reduce((sum, value) => sum + value, 0)
      : null;
  });
  const liveOverPlan = liveTotal !== null && liveTotal > plannedQty;
  const liveAtCap = liveTotal !== null && liveTotal >= maxReportQty;
  const showOverReportConfirm =
    !liveAtCap &&
    (liveOverPlan ||
      overReport !== undefined ||
      values?.overReportConfirmed === true);

  return (
    <form
      action={formAction}
      aria-busy={pending}
      onInput={(event) => {
        const nativeForm = event.currentTarget;
        const read = (name: string) => {
          const field = nativeForm.elements.namedItem(name);
          if (!(field instanceof HTMLInputElement)) return 0;
          const value = Number(field.value);
          return Number.isFinite(value) ? value : 0;
        };
        setLiveTotal(
          read('completedQty') + read('defectQty') + read('reworkQty'),
        );
      }}
    >
      <fieldset
        disabled={pending}
        className="min-w-0 space-y-4 border-0 p-0"
      >
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberField
          name="completedQty"
          label="合格数"
          defaultValue={values?.completedQty ?? String(plannedQty)}
          errors={fieldErrors(state, 'completedQty')}
          autoFocus
        />
        <NumberField
          name="defectQty"
          label="不良数"
          defaultValue={values?.defectQty ?? '0'}
          errors={fieldErrors(state, 'defectQty')}
        />
        <NumberField
          name="reworkQty"
          label="返工数"
          defaultValue={values?.reworkQty ?? '0'}
          errors={fieldErrors(state, 'reworkQty')}
        />
      </div>

      <p className="worker-wrap-anywhere text-xs text-muted-foreground">
        计划数量 {plannedQty.toLocaleString()}。合格 + 不良 + 返工 合计需 &gt;
        0；少报可以直接提交，超过计划数需勾选确认，合计达到{' '}
        {maxReportQty.toLocaleString()} 会被拒绝。{isPiecework
          ? '计件金额按机台薪资规则计算。'
          : '本任务只记录完工数量，工资按考勤时薪结算。'}
      </p>

      {liveAtCap ? (
        <p className="text-sm text-warning-foreground">
          合计已达到上限 {maxReportQty.toLocaleString()}，提交会被服务端拒绝；请先核对并修改数量。
        </p>
      ) : null}

      {showOverReportConfirm ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
          <label
            htmlFor="overReportConfirmed"
            className="flex min-w-0 items-start gap-2 text-sm"
          >
            {/* 原生 checkbox，不是 Radix 控件：零 JS 下必须能勾能提交。 */}
            <input
              id="overReportConfirmed"
              name="overReportConfirmed"
              type="checkbox"
              value="true"
              defaultChecked={values?.overReportConfirmed ?? false}
              aria-invalid={confirmErrors.length > 0}
              aria-describedby={
                confirmErrors.length > 0
                  ? 'overReportConfirmed-error overReportConfirmed-help'
                  : 'overReportConfirmed-help'
              }
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-input"
            />
            <span className="min-w-0">
              <span className="font-medium text-warning-foreground">
                确认超出计划数
              </span>
              <span
                id="overReportConfirmed-help"
                className="worker-wrap-anywhere block text-xs text-muted-foreground"
              >
                {overReport
                  ? `合计 ${overReport.totalReported.toLocaleString()} 超过计划数 ${overReport.plannedQty.toLocaleString()}。`
                  : liveOverPlan
                    ? `当前合计 ${liveTotal.toLocaleString()} 超过计划数 ${plannedQty.toLocaleString()}。`
                    : ''}
                勾选后提交，超出情况会记进任务备注和工单日志。
              </span>
            </span>
          </label>
          {confirmErrors.length > 0 ? (
            // 逐字段错误不标 role="alert"：靠 aria-describedby 与控件关联，
            // 聚焦时读屏器自然读出来，不抢播报。与 EditOrderForm 一致。
            <p
              id="overReportConfirmed-error"
              className="mt-2 text-xs text-destructive"
            >
              {confirmErrors[0]}
            </p>
          ) : null}
        </div>
      ) : null}

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <Button
          type="submit"
          disabled={pending}
          size="lg"
          className="min-h-[52px] w-full bg-foreground text-background hover:bg-foreground/80"
        >
          {pending ? '提交中…' : '完工报工'}
        </Button>
      </div>
      </fieldset>
    </form>
  );
}

function fieldErrors(
  state: ReportTaskMutationResult | null,
  name: string,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}

function NumberField({
  name,
  label,
  defaultValue,
  errors,
  autoFocus,
}: {
  name: string;
  label: string;
  defaultValue: string;
  errors: string[];
  autoFocus?: boolean;
}) {
  const errorId = `${name}-error`;

  return (
    <div className="min-w-0">
      <Label htmlFor={name} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {/*
        刻意**不设 max**。上限是「合计 >= 计划数 × 倍数」，只有服务端算得出；
        而原生约束校验在关掉 JS 时也生效，手机上只弹一个原生气泡、极易滚出
        视野，那句写清楚「已达到计划数 N 倍上限（具体数字）」的中文提示就
        永远看不到。上限信息放在下面的说明文字里，判定留在服务端。
        （schema 的单字段 10,000,000 已是绝对上限，越界会走同一套逐字段错误。）
      */}
      <Input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length > 0 ? errorId : undefined}
        className={`mt-1 min-h-11 text-lg ${errors.length > 0 ? 'border-destructive' : ''}`}
      />
      {errors.length > 0 ? (
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

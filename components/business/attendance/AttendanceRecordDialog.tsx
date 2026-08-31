'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  recordAttendanceAction,
} from '@/actions/foreman-attendance';
import type { AttendanceMutationResult } from '@/actions/foreman-attendance.types';
import { WorkerType } from '@/generated/prisma/enums';

type Props = {
  workerId: string;
  workerName: string;
  workerType: WorkerType | null;
  date: string;
  // 如果已有记录，默认回填数值；无则全部 "" 表示未录入
  existing?: {
    normalHours: string;
    otHours: string;
    spareHours: string;
    remark: string | null;
    workUnits: string;
    leaveUnits: string;
    leaveType: string | null;
  };
  // 从 WORK_HOURS 规则算出来的"全勤"快速填模板（纯 UI hint）。
  // 如果规则缺失就是 null，面板不显示快速填按钮。
  quickFill?: {
    normalHours: number;
    otStartHour: string;
  };
};

export function AttendanceRecordDialog({
  workerId,
  workerName,
  workerType,
  date,
  existing,
  quickFill,
}: Props) {
  const [normal, setNormal] = useState(existing?.normalHours ?? '');
  const [ot, setOt] = useState(existing?.otHours ?? '');
  const [spare, setSpare] = useState(existing?.spareHours ?? '');
  const [remark, setRemark] = useState(existing?.remark ?? '');
  const [workUnits, setWorkUnits] = useState(existing?.workUnits ?? '1');
  const [leaveUnits, setLeaveUnits] = useState(existing?.leaveUnits ?? '0');
  const [leaveType, setLeaveType] = useState(existing?.leaveType ?? '');

  const [recordState, recordAction, actionPending] = useActionState<
    AttendanceMutationResult | null,
    unknown
  >(recordAttendanceAction, null);
  const [transitionPending, startTransition] = useTransition();
  const pending = actionPending || transitionPending;
  // useActionState 在新一轮 action 完成前会保留上一轮 state。
  // 如果上次也是 success，新一轮成功后文字完全相同，live region
  // 没有 DOM 变化就不会再播报。pending 时卸载旧 outcome，完成后
  // 重新挂载，同时避免在「保存中…」旁还显示过期的「已保存」。
  const state = pending ? null : recordState;

  const isCook = workerType === WorkerType.COOK;
  const usesHourlyFields =
    workerType === WorkerType.PACKER ||
    workerType === WorkerType.CLEANER ||
    workerType === WorkerType.COOK;

  function onApplyFullDay() {
    if (!quickFill) return;
    setNormal(String(quickFill.normalHours));
    setOt('0');
    setSpare('');
    setWorkUnits('1');
    setLeaveUnits('0');
    setLeaveType('');
  }

  function onSave() {
    startTransition(() =>
      recordAction({
        workerId,
        date,
        normalHours: normal || '0',
        otHours: ot || '0',
        spareHours: isCook ? (spare || '0') : '0',
        workUnits,
        leaveUnits,
        leaveType: leaveType || null,
        remark: remark || undefined,
      }),
    );
  }

  function onMarkLeave() {
    setNormal('0');
    setOt('0');
    setSpare('0');
    setWorkUnits('0');
    setLeaveUnits('1');
    setLeaveType('请假');
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {workerName} · <span className="font-sans tabular-nums">{date}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {workerTypeLabel(workerType)}
            {quickFill
              ? ` · 工时段: 正常 ${quickFill.normalHours}h, 加班 ${quickFill.otStartHour} 起`
              : ''}
          </div>
        </div>
        {quickFill ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onApplyFullDay}
          >
            快速填&ldquo;全勤&rdquo;
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">实际上班</span>
          <select
            aria-label="实际上班"
            value={workUnits}
            onChange={(event) => setWorkUnits(event.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            <option value="1">1 天</option>
            <option value="0.5">0.5 天</option>
            <option value="0">0 天</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">请假</span>
          <select
            aria-label="请假"
            value={leaveUnits}
            onChange={(event) => setLeaveUnits(event.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            <option value="0">0 天</option>
            <option value="0.5">0.5 天</option>
            <option value="1">1 天</option>
          </select>
        </label>
      </div>

      {usesHourlyFields ? (
        <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-3">
          <NumberField
            label="正常工时"
            value={normal}
            onChange={setNormal}
            errors={fieldErr(state, 'normalHours')}
          />
          <NumberField
            label="加班工时"
            value={ot}
            onChange={setOt}
            errors={fieldErr(state, 'otHours')}
          />
          {isCook ? (
          <NumberField
            label="代班打包工时"
            value={spare}
            onChange={setSpare}
            errors={fieldErr(state, 'spareHours')}
          />
          ) : null}
        </div>
      ) : null}

      {Number(leaveUnits) > 0 ? (
        <label className="block">
          <span className="text-xs text-muted-foreground">请假类型</span>
          <Input
            value={leaveType}
            onChange={(event) => setLeaveType(event.target.value)}
            maxLength={50}
            placeholder="事假 / 病假 / 年假"
            className="mt-1"
          />
        </label>
      ) : null}

      <label className="block">
        <span className="text-xs text-muted-foreground">备注</span>
        <Input
          type="text"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="（可选）"
          className="mt-1"
        />
      </label>

      {/* 保存成功此前没有任何回执：按钮从「保存中…」变回「保存」就完了。

          注意这里**不需要** router.refresh()。Server Action 里的
          revalidatePath('/foreman/attendance') 会让服务端在 action 响应上
          带回 x-action-revalidated 头，客户端 server-action-reducer 据此把
          freshnessPolicy 提成 RefreshAll、对当前 URL 重新取数（见
          next/dist/client/components/router-reducer/reducers/
          server-action-reducer.js 与 next/dist/server/web/spec-extension/
          revalidate.js），所以上方的汇总徽章和日卡片是会跟着变的。

          真正缺的是「回执」：那次刷新对读屏器不产生任何播报，视觉上变化
          也离按钮很远，容易被当成没存上而重复录入。补一条 role="status"
          （polite），和下面 error 的 role="alert" 是同一套机制的两半。 */}
      {state?.status === 'success' ? (
        <p role="status" className="text-xs text-success-foreground">
          已保存 {date} 的考勤
        </p>
      ) : null}
      {state?.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <ul
          role="alert"
          aria-atomic="true"
          className="space-y-1 text-xs text-destructive"
        >
          {Object.entries(state.fieldErrors).flatMap(([field, msgs]) =>
            msgs.map((m) => <li key={`${field}-${m}`}>{m}</li>),
          )}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onSave} disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onMarkLeave}
          disabled={pending}
        >
          填为请假 1 天
        </Button>
      </div>
    </div>
  );
}

function workerTypeLabel(t: WorkerType | null): string {
  switch (t) {
    case WorkerType.PACKER:
      return '打包工';
    case WorkerType.CLEANER:
      return '清废工';
    case WorkerType.COOK:
      return '厨师';
    default:
      return t ?? '正式员工';
  }
}

function fieldErr(
  state: AttendanceMutationResult | null,
  name: string,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}

function NumberField({
  label,
  value,
  onChange,
  errors,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  errors: string[];
}) {
  // useId 而不是按 label 派生 id：label 是中文，拿来做 id 既不稳定也不
  // 合法；useId 在 SSR/CSR 两侧一致，不会引起 hydration 不匹配。
  const errorId = `${useId()}-error`;
  const hasError = errors.length > 0;
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={24}
        step={0.5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        className={`mt-1 ${hasError ? 'border-destructive' : ''}`}
      />
      {hasError ? (
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </label>
  );
}

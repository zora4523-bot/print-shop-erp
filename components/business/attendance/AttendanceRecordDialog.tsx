'use client';

import { useActionState, useState, useTransition } from 'react';
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

  const [recordState, recordAction] = useActionState<
    AttendanceMutationResult | null,
    unknown
  >(recordAttendanceAction, null);
  const [pending, startTransition] = useTransition();
  const state = recordState;

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
            errors={fieldErr(recordState, 'normalHours')}
          />
          <NumberField
            label="加班工时"
            value={ot}
            onChange={setOt}
            errors={fieldErr(recordState, 'otHours')}
          />
          {isCook ? (
          <NumberField
            label="代班打包工时"
            value={spare}
            onChange={setSpare}
            errors={fieldErr(recordState, 'spareHours')}
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

      {state?.status === 'error' ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
      {state?.status === 'invalid' ? (
        <ul className="text-xs text-destructive space-y-1">
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
        className={`mt-1 ${errors.length > 0 ? 'border-destructive' : ''}`}
      />
      {errors.length > 0 ? (
        <p className="mt-1 text-xs text-destructive">{errors[0]}</p>
      ) : null}
    </label>
  );
}

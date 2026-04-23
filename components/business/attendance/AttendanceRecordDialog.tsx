'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  recordAttendanceAction,
  removeAttendanceAction,
} from '@/actions/foreman-attendance';
import type { AttendanceMutationResult } from '@/actions/foreman-attendance.types';
import { WorkerType } from '@/generated/prisma/enums';

type Props = {
  workerId: string;
  workerName: string;
  workerType: WorkerType;
  date: string;
  // 如果已有记录，默认回填数值；无则全部 "" 表示未录入
  existing?: {
    normalHours: string;
    otHours: string;
    spareHours: string;
    remark: string | null;
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

  const [recordState, recordAction] = useActionState<
    AttendanceMutationResult | null,
    unknown
  >(recordAttendanceAction, null);
  const [removeState, removeAction] = useActionState<
    AttendanceMutationResult | null,
    unknown
  >(removeAttendanceAction, null);
  const [pending, startTransition] = useTransition();
  const state = recordState ?? removeState;

  const isCook = workerType === WorkerType.COOK;

  function onApplyFullDay() {
    if (!quickFill) return;
    setNormal(String(quickFill.normalHours));
    setOt('0');
    setSpare('');
  }

  function onSave() {
    startTransition(() =>
      recordAction({
        workerId,
        date,
        normalHours: normal || '0',
        otHours: ot || '0',
        spareHours: isCook ? (spare || '0') : '0',
        remark: remark || undefined,
      }),
    );
  }

  function onMarkLeave() {
    // "请假 = 删行" 约定
    startTransition(() =>
      removeAction({ workerId, date }),
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">
            {workerName} · <span className="font-mono">{date}</span>
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

      <div className="grid grid-cols-3 gap-3">
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
        ) : (
          <div className="text-xs text-muted-foreground">
            代班字段仅厨师可填
          </div>
        )}
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">备注</Label>
        <Input
          type="text"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="（可选）"
          className="mt-1"
        />
      </div>

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

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={pending}>
          {pending ? '保存中…' : '保存'}
        </Button>
        {existing ? (
          <Button
            type="button"
            variant="outline"
            onClick={onMarkLeave}
            disabled={pending}
          >
            删除此日（标记请假）
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function workerTypeLabel(t: WorkerType): string {
  switch (t) {
    case WorkerType.PACKER:
      return '打包工';
    case WorkerType.CLEANER:
      return '清废工';
    case WorkerType.COOK:
      return '厨师';
    default:
      return t;
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
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
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
    </div>
  );
}

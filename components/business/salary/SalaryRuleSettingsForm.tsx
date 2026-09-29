'use client';

import { useActionState, useMemo, useState } from 'react';
import { createSalaryRuleVersionAction } from '@/actions/owner-salary-rules';
import type { SalaryRuleVersionMutationResult } from '@/actions/owner-salary-rules.types';
import {
  SALARY_RULE_CATALOG,
  type SalaryRuleKey
} from '@/lib/salary/rule-catalog';
import type { SalaryRuleSettingsData } from '@/lib/salary/rule-admin';
import { formatDateTimeShanghai } from '@/lib/format/dates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormMessage } from '@/components/ui-business';

function defaultValues(current: SalaryRuleSettingsData[SalaryRuleKey]) {
  const workHours = current?.ruleValue;
  return {
    morningStart: workHours?.morning.start ?? '08:00',
    morningEnd: workHours?.morning.end ?? '12:00',
    afternoonStart: workHours?.afternoon.start ?? '13:30',
    afternoonEnd: workHours?.afternoon.end ?? '17:30',
    otStart: workHours?.otStart ?? '18:00',
  };
}

export function SalaryRuleSettingsForm({
  rules,
  defaultEffectiveFrom,
}: {
  rules: SalaryRuleSettingsData;
  defaultEffectiveFrom: string;
}) {
  const [selectedKey, setSelectedKey] = useState<SalaryRuleKey>(
    SALARY_RULE_CATALOG[0].key,
  );
  const selected = useMemo(
    () => SALARY_RULE_CATALOG.find((rule) => rule.key === selectedKey)!,
    [selectedKey],
  );
  const current = rules[selectedKey];
  const [state, formAction, pending] = useActionState<
    SalaryRuleVersionMutationResult | null,
    FormData
  >(createSalaryRuleVersionAction, null);
  const defaults = defaultValues(current);
  const errors = state?.status === 'invalid' ? state.fieldErrors : {};

  function switchRule(key: SalaryRuleKey) {
    setSelectedKey(key);
  }

  return (
    <form
      key={`${selectedKey}:${current?.id ?? 'new'}`}
      action={formAction}
      aria-busy={pending}
      className="space-y-5"
      noValidate
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="工资规则">
          <select
            name="ruleKey"
            value={selectedKey}
            onChange={(event) => switchRule(event.target.value as SalaryRuleKey)}
            disabled={pending}
            className={selectClass}
          >
            {SALARY_RULE_CATALOG.map((definition) => (
              <option key={definition.key} value={definition.key}>
                {definition.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="生效时间（上海）">
          <Input
            name="effectiveFrom"
            type="datetime-local"
            defaultValue={defaultEffectiveFrom}
            required
            disabled={pending}
          />
        </Field>
      </div>

      <div className="rounded-lg border bg-muted/20 p-3 text-sm">
        <p className="font-medium">{selected.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          当前版本：{current ? `自 ${formatDateTime(current.effectiveFrom)} 起生效` : '尚未配置'}。
          已生成的工资不受影响，仍按生成时的规则计算。
        </p>
      </div>

      {selectedKey === 'WORK_HOURS' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="上午上班"><Input name="morningStart" type="time" defaultValue={defaults.morningStart} required disabled={pending} /></Field>
          <Field label="上午下班"><Input name="morningEnd" type="time" defaultValue={defaults.morningEnd} required disabled={pending} /></Field>
          <Field label="下午上班"><Input name="afternoonStart" type="time" defaultValue={defaults.afternoonStart} required disabled={pending} /></Field>
          <Field label="下午下班"><Input name="afternoonEnd" type="time" defaultValue={defaults.afternoonEnd} required disabled={pending} /></Field>
          <Field label="加班起点"><Input name="otStart" type="time" defaultValue={defaults.otStart} required disabled={pending} /></Field>
        </div>
      ) : null}

      <Field label="备注（可选）">
        <Input name="remark" defaultValue={current?.remark ?? ''} maxLength={200} placeholder="例如：2026 年 8 月调整" disabled={pending} />
      </Field>
      {errors._?.length ? <ErrorText text={errors._.join('；')} /> : null}
      {Object.entries(errors).filter(([key]) => key !== '_').length > 0 ? (
        <ErrorText text={Object.entries(errors).filter(([key]) => key !== '_').flatMap(([, messages]) => messages).join('；')} />
      ) : null}
      {state?.status === 'error' ? <ErrorText text={state.message} /> : null}
      {state?.status === 'success' ? (
        <FormMessage fieldId="salary-rule-status" tone="success">
          工资规则新版本已保存。
        </FormMessage>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? '正在保存…' : '保存新规则版本'}</Button>
        <span className="text-xs text-muted-foreground">保存会自动关闭相交的上一版本，不会修改历史工资单。</span>
      </div>
    </form>
  );
}

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 text-sm"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}

function ErrorText({ text }: { text: string }) {
  return <p role="alert" className="text-sm text-destructive">{text}</p>;
}

// 这里原来自建了一个 dateStyle:'medium' 的 formatter，渲染成
// 「2026年8月17日 14:30」，与全站的 2026/08/17 14:30 不一致。
function formatDateTime(value: Date) {
  return formatDateTimeShanghai(value);
}

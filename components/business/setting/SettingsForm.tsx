'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateSettingsAction } from '@/actions/owner-settings';
import type { SettingsMutationResult } from '@/actions/owner-settings.types';
import {
  SETTING_KEYS,
  SETTING_METADATA,
  type SettingKey,
} from '@/lib/settings/metadata';

type Props = {
  // 由 Server Component 读好当前值传进来（页面层不直连 Prisma 之外的东西，
  // 这里只负责渲染）。key → 输入框里该显示的字符串。
  initialValues: Record<SettingKey, string>;
};

export function SettingsForm({ initialValues }: Props) {
  // 直接把 Server Action 引用交给 useActionState、再原样传给 <form action>，
  // 保住零 JS 提交路径（CLAUDE.md §15.8）。不要用箭头函数包一层。
  const [state, formAction, pending] = useActionState<
    SettingsMutationResult | null,
    FormData
  >(updateSettingsAction, null);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        {SETTING_KEYS.map((key) => (
          <SettingField
            // The action revalidates this Server Component and can return a
            // new saved default. Base UI correctly warns when an uncontrolled
            // input's defaultValue changes in place, so remount only that
            // field when its persisted value changes. Invalid submissions keep
            // the same key and therefore preserve the user's attempted input.
            key={`${key}:${initialValues[key]}`}
            settingKey={key}
            defaultValue={initialValues[key]}
            errors={fieldErrors(state, key)}
          />
        ))}
      </div>

      {state?.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      {state?.status === 'success' ? (
        <p role="status" className="text-sm text-success-foreground">
          {state.message ?? '设置已保存'}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? '保存中…' : '保存设置'}
      </Button>
    </form>
  );
}

function SettingField({
  settingKey,
  defaultValue,
  errors,
}: {
  settingKey: SettingKey;
  defaultValue: string;
  errors: string[];
}) {
  const definition = SETTING_METADATA[settingKey];
  const { field } = definition;
  const hasError = errors.length > 0;
  const errorId = `${settingKey}-error`;
  const helpId = `${settingKey}-help`;

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={settingKey} className="text-sm font-medium">
        {definition.label}
      </Label>
      <p id={helpId} className="text-xs text-muted-foreground">
        {definition.help}
      </p>
      <div className="flex items-center gap-2">
        <Input
          id={settingKey}
          name={settingKey}
          defaultValue={defaultValue}
          aria-invalid={hasError}
          // 说明文字始终关联，出错时把错误排在前面先读
          aria-describedby={hasError ? `${errorId} ${helpId}` : helpId}
          {...(field.kind === 'int'
            ? {
                type: 'number',
                inputMode: 'numeric' as const,
                min: field.min,
                max: field.max,
                step: 1,
                className: 'max-w-32',
              }
            : {
                type: 'text',
                maxLength: field.maxLength,
                className: 'max-w-md',
              })}
        />
        {field.kind === 'int' ? (
          <span className="text-sm text-muted-foreground">{field.unit}</span>
        ) : null}
      </div>
      {hasError ? (
        // 逐字段错误不标 role="alert"：靠 aria-describedby 与控件关联，
        // 聚焦时读屏器自然读出来，不抢播报。与 EditOrderForm 一致。
        <p id={errorId} className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

function fieldErrors(
  state: SettingsMutationResult | null,
  name: string,
): string[] {
  if (!state || state.status !== 'invalid') return [];
  return state.fieldErrors[name] ?? [];
}

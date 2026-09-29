'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changeMyPassword, type ChangePasswordResult } from '@/actions/account';

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordResult | null, FormData>(
    changeMyPassword,
    null,
  );

  const fieldErrors = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';

  return (
    <form action={formAction} aria-busy={pending} className="space-y-4" noValidate>
      <Field
        id="currentPassword"
        label="当前密码"
        autoComplete="current-password"
        error={fieldErrors.currentPassword?.[0]}
        disabled={pending}
      />
      <Field
        id="newPassword"
        label="新密码（至少 8 位）"
        autoComplete="new-password"
        error={fieldErrors.newPassword?.[0]}
        disabled={pending}
      />
      <Field
        id="confirmPassword"
        label="再次输入新密码"
        autoComplete="new-password"
        error={fieldErrors.confirmPassword?.[0]}
        disabled={pending}
      />

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}

      {success ? (
        <p role="status" className="text-sm text-success-foreground">
          ✓ 密码已更新
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '正在提交…' : '更新密码'}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  autoComplete,
  error,
  disabled,
}: {
  id: string;
  label: string;
  autoComplete: string;
  error: string | undefined;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        type="password"
        autoComplete={autoComplete}
        required
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

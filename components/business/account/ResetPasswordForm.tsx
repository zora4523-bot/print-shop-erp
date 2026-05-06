'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetUserPasswordAction } from '@/actions/owner-accounts';
import type { AccountMutationResult } from '@/actions/owner-accounts.types';

export function ResetPasswordForm({ userId }: { userId: string }) {
  // Bind the user id so the action's signature matches useActionState's
  // (prev, formData) → result contract.
  const boundAction = resetUserPasswordAction.bind(null, userId);
  const [state, formAction, pending] = useActionState<AccountMutationResult | null, FormData>(
    boundAction,
    null,
  );

  const fieldErrors = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;
  const success = state?.status === 'success';

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <div className="space-y-2">
        <Label htmlFor="newPassword">新密码</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.newPassword)}
          aria-describedby={fieldErrors.newPassword ? 'newPassword-error' : 'newPassword-hint'}
        />
        {fieldErrors.newPassword?.[0] ? (
          <p id="newPassword-error" className="text-sm text-destructive">
            {fieldErrors.newPassword[0]}
          </p>
        ) : (
          <p id="newPassword-hint" className="text-xs text-muted-foreground">
            至少 8 位；最多 72 字符（bcrypt 限制）。
          </p>
        )}
      </div>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm text-success">
          ✓ 密码已重置
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? '重置中…' : '重置密码'}
      </Button>
    </form>
  );
}

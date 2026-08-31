'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ActionNotice,
  FormErrorSummary,
  FormMessage,
  PendingButton,
  formMessageA11yProps,
} from '@/components/ui-business';
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

  const visibleState = pending ? null : state;
  const fieldErrors =
    visibleState?.status === 'invalid' ? visibleState.fieldErrors : {};
  const generalError =
    visibleState?.status === 'error' ? visibleState.message : null;
  const success = visibleState?.status === 'success';
  const passwordErrors = fieldErrors.newPassword ?? [];
  const passwordError = passwordErrors[0];

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="space-y-3"
      noValidate
    >
      <FormErrorSummary
        errors={
          passwordErrors.map((message) => ({
            fieldId: 'newPassword',
            label: '新密码',
            message,
          }))
        }
      />

      <div className="space-y-2">
        <Label htmlFor="newPassword">新密码</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          disabled={pending}
          {...formMessageA11yProps(
            'newPassword',
            passwordError ? 'error' : 'hint',
          )}
        />
        {passwordError ? (
          <FormMessage fieldId="newPassword" tone="error">
            {passwordError}
          </FormMessage>
        ) : (
          <FormMessage fieldId="newPassword" tone="hint" className="text-xs">
            8–72 位。
          </FormMessage>
        )}
      </div>

      {generalError ? (
        <ActionNotice
          tone="error"
          title="密码重置失败"
          description={generalError}
        />
      ) : null}
      {success ? (
        <ActionNotice tone="success" title="密码已重置" />
      ) : null}

      <PendingButton pending={pending} pendingLabel="正在重置密码…">
        重置密码
      </PendingButton>
    </form>
  );
}

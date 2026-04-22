'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInWithCredentials, type LoginActionResult } from '@/actions/auth';

export function LoginForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState<LoginActionResult | null, FormData>(
    signInWithCredentials,
    null,
  );

  const fieldErrors = state?.status === 'invalid' ? state.fieldErrors : {};
  const generalError = state?.status === 'error' ? state.message : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="from" value={from} />

      <div className="space-y-2">
        <Label htmlFor="username">用户名</Label>
        <Input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.username)}
          aria-describedby={fieldErrors.username ? 'username-error' : undefined}
        />
        {fieldErrors.username ? (
          <p id="username-error" className="text-sm text-destructive">
            {fieldErrors.username[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">密码</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? 'password-error' : undefined}
        />
        {fieldErrors.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {fieldErrors.password[0]}
          </p>
        ) : null}
      </div>

      {generalError ? (
        <p role="alert" className="text-sm text-destructive">
          {generalError}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? '登录中…' : '登录'}
      </Button>
    </form>
  );
}

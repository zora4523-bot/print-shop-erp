'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { signOutAction } from '@/actions/account';

export function LogoutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={() => {
        startTransition(() => {
          void signOutAction();
        });
      }}
    >
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? '退出中…' : '退出登录'}
      </Button>
    </form>
  );
}

'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SalesOrderRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending}
      aria-label="刷新工单详情" aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}>
      <RefreshCw aria-hidden="true" />
      {pending ? '正在刷新…' : '刷新'}
    </Button>
  );
}

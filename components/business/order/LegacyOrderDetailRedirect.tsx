'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ActionNotice } from '@/components/ui-business';
import { orderNoFromHash } from './order-detail-hash';

type OrderIdentity = { id: string; orderNo: string };

/** Keep previously shared notification/billing links working without a drawer. */
export function LegacyOrderDetailRedirect({ orders }: { orders: readonly OrderIdentity[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active: AbortController | undefined;
    const navigate = async () => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      setError('');
      const orderNo = orderNoFromHash(window.location.hash);
      if (!orderNo) return;
      try {
        let order = orders.find((entry) => entry.orderNo === orderNo);
        if (!order) {
          const response = await fetch(`/api/orders/admin/${encodeURIComponent(orderNo)}`, {
            cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' },
          });
          if (!response.ok) throw new Error('无法打开工单，请确认工单存在且有权访问');
          const payload = await response.json() as { order?: OrderIdentity };
          order = payload.order;
          if (!order || order.orderNo !== orderNo || typeof order.id !== 'string' || !order.id.trim()) {
            throw new Error('工单链接解析失败，请重试');
          }
        }
        if (!controller.signal.aborted) router.replace(`/orders/${encodeURIComponent(order.id)}`);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '工单链接解析失败，请重试');
      }
    };
    void navigate();
    window.addEventListener('hashchange', navigate);
    window.addEventListener('popstate', navigate);
    return () => {
      active?.abort();
      window.removeEventListener('hashchange', navigate);
      window.removeEventListener('popstate', navigate);
    };
  }, [orders, router, attempt]);

  return error ? <ActionNotice tone="error" title={error} action={
    <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>重试打开工单</Button>
  } /> : null;
}

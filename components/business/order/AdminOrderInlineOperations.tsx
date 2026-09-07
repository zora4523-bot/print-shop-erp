'use client';

import { useCallback, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { ActionNotice } from '@/components/ui-business';
import { OrderPricingReviewForm } from './OrderPricingReviewForm';
import { FulfillmentPricingReviewForm } from './FulfillmentPricingReviewForm';
import { ShipOrderForm } from './ShipOrderForm';
import styles from './AdminOrderInlineOperations.module.css';

export function AdminOrderInlineOperations({ order, disabled = false, onCompleted }: {
  order: Pick<AdminOrderWorkspaceRow, 'id' | 'inlineOperations' | 'pendingChangeRequest' | 'fee' | 'priceComparisonError'>;
  disabled?: boolean;
  onCompleted?: (message: string) => void;
}) {
  const router = useRouter();
  const panelId = useId();
  const [mode, setMode] = useState<'pricing' | 'shipping' | null>(null);
  const [openedModes, setOpenedModes] = useState({ pricing: false, shipping: false });
  const [receipt, setReceipt] = useState('');
  const [requestKey] = useState(() => globalThis.crypto.randomUUID());
  const data = order.inlineOperations;
  const finish = useCallback((message: string) => {
    if (onCompleted) onCompleted(message);
    else setReceipt(message);
    setMode(null);
    setOpenedModes({ pricing: false, shipping: false });
    router.refresh();
  }, [onCompleted, router]);
  const pricingFinished = useCallback(() => finish('核价已确认'), [finish]);
  const shippingFinished = useCallback(() => finish('工单已发货'), [finish]);
  if (order.pendingChangeRequest) return null;
  const pricingFallback = !data?.pricing && (order.fee.source === 'PENDING' || Boolean(order.priceComparisonError));
  if (!data?.pricing && !data?.shipping && !pricingFallback && !receipt) return null;

  function toggleMode(nextMode: 'pricing' | 'shipping') {
    setOpenedModes((current) => ({ ...current, [nextMode]: true }));
    setMode((current) => current === nextMode ? null : nextMode);
  }

  return (
    <div data-slot="admin-order-inline-operations" className="mt-3 min-w-0">
      {receipt ? <ActionNotice tone="success" title={receipt} /> : null}
      <div className="flex flex-wrap gap-2">
        {data?.pricing ? <Button type="button" disabled={disabled} aria-expanded={mode === 'pricing'} aria-controls={`${panelId}-pricing`} onClick={() => toggleMode('pricing')}>
          {data.pricing === 'fulfillment' ? '核对物流费用' : '录入人工核价'}
        </Button> : pricingFallback ? <Link href={`/orders/${order.id}#pricing-review`} prefetch={false} className={buttonVariants({ variant: 'outline' })}>处理核价</Link> : null}
        {data?.shipping ? <Button type="button" disabled={disabled} aria-expanded={mode === 'shipping'} aria-controls={`${panelId}-shipping`} onClick={() => toggleMode('shipping')}>录运单发货</Button> : null}
      </div>
      {openedModes.pricing ? <div id={`${panelId}-pricing`} hidden={mode !== 'pricing'} className={styles.form}>
        {data?.pricing === 'factory' ? <OrderPricingReviewForm orderId={order.id} variant="drawer" onSuccess={pricingFinished} /> : null}
        {data?.pricing === 'fulfillment' && data.fulfillment ? <FulfillmentPricingReviewForm orderId={order.id} {...data.fulfillment} variant="drawer" onSuccess={pricingFinished} /> : null}
      </div> : null}
      {openedModes.shipping && data?.shipping ? <div id={`${panelId}-shipping`} hidden={mode !== 'shipping'} className={styles.form}>
        <ShipOrderForm orderId={order.id} {...data.shipping} initialIdempotencyKey={requestKey} onSuccess={shippingFinished} />
      </div> : null}
    </div>
  );
}

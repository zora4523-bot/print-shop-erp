'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { ActionNotice } from '@/components/ui-business';
import { OrderPricingReviewForm } from './OrderPricingReviewForm';
import { FulfillmentPricingReviewForm } from './FulfillmentPricingReviewForm';
import { ORDER_DETAIL_REVEAL, type OrderDetailRevealRequest } from './order-detail-navigation';
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
  const data = order.inlineOperations;
  const finish = useCallback((message: string) => {
    if (onCompleted) onCompleted(message);
    else setReceipt(message);
    setMode(null);
    setOpenedModes({ pricing: false, shipping: false });
    router.refresh();
  }, [onCompleted, router]);
  const pricingFinished = useCallback(() => finish('核价已确认'), [finish]);
  useEffect(() => {
    const reveal = (event: Event) => {
      const request = (event as CustomEvent<OrderDetailRevealRequest>).detail;
      if (request.orderId !== order.id || disabled || order.pendingChangeRequest) return;
      const genericPricing = request.targetId === 'pricing-review' && Boolean(data?.pricing);
      const matches = genericPricing || (data?.pricing === 'fulfillment'
        ? request.targetId === 'fulfillment-pricing'
        : data?.pricing === 'factory' && /^pricing-review-(item|packaging|charge|shipment)-/.test(request.targetId));
      if (!matches) return;
      request.handled = true;
      if (genericPricing) request.resolvedTargetId = `${panelId}-pricing`;
      setOpenedModes((current) => ({ ...current, pricing: true }));
      setMode('pricing');
    };
    window.addEventListener(ORDER_DETAIL_REVEAL, reveal);
    return () => window.removeEventListener(ORDER_DETAIL_REVEAL, reveal);
  }, [data?.pricing, disabled, order.id, order.pendingChangeRequest, panelId]);
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
        <Link href={`/orders/${order.id}#shipment-registration`} prefetch={false} className={buttonVariants({ variant: 'outline' })}>前往登记物流</Link>
      </div> : null}
    </div>
  );
}

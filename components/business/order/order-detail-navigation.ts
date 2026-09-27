export const ORDER_DETAIL_REVEAL = 'order-detail-reveal';
export type OrderDetailRevealRequest = { orderId: string; targetId: string; handled: boolean; resolvedTargetId?: string };

function visibleTarget(id: string): HTMLElement | null {
  const element = document.getElementById(id);
  return element && !element.closest('[hidden]') ? element : null;
}

/** Wait for an authorized inline editor to mount; native details are opened by the caller. */
export function revealOrderDetailTarget(orderId: string, targetId: string, signal: AbortSignal): Promise<HTMLElement | null> {
  const existing = visibleTarget(targetId);
  // The generic pricing anchor also exists when its authorized editor is lazy.
  if (existing && targetId !== 'pricing-review') return Promise.resolve(existing);
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request: OrderDetailRevealRequest = { orderId, targetId, handled: false };
    const finish = (element: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      resolve(element);
    };
    const abort = () => finish(null);
    const observer = new MutationObserver(() => {
      const element = visibleTarget(request.resolvedTargetId ?? targetId);
      if (element) finish(element);
    });
    const timeout = setTimeout(() => finish(null), 10000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    signal.addEventListener('abort', abort, { once: true });
    window.dispatchEvent(new CustomEvent(ORDER_DETAIL_REVEAL, { detail: request }));
    if (!request.handled) finish(existing);
    else {
      const element = visibleTarget(request.resolvedTargetId ?? targetId);
      if (element) finish(element);
    }
  });
}

'use client';

import { useEffect } from 'react';

export function CustomerPricingRuleFocus({ targetId }: { targetId: string }) {
  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLElement)) return;

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
  }, [targetId]);

  return null;
}

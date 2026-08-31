'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function CustomerPricingUrlCleanup({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href, { scroll: false });
  }, [href, router]);

  return null;
}

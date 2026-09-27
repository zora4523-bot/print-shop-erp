import type { ReactNode } from 'react';

export function OrderQueueResults({ children }: { children: ReactNode }) {
  return <div className="min-w-0 space-y-3.5">{children}</div>;
}

import type { ReactNode } from 'react';
import styles from './AdminOrderWorkspace.module.css';

export function OrderQueueResults({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <p aria-hidden="true" className={`${styles.pendingNotice} min-h-5 text-sm font-medium text-muted-foreground`}>
        正在切换，当前仍显示切换前的结果
      </p>
      <div className={`${styles.results} min-w-0 space-y-3.5`}>
        {children}
      </div>
    </div>
  );
}

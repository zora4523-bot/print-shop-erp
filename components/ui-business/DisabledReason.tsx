import { useId } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type DisabledReasonCause = 'permission' | 'status' | 'prerequisite';

type DisabledReasonBaseProps = {
  children?: React.ReactNode;
  className?: string;
};

export type DisabledReasonProps =
  | (DisabledReasonBaseProps & {
      cause: 'permission';
      reason?: never;
      fixHref?: never;
      fixLabel?: never;
    })
  | (DisabledReasonBaseProps & {
      cause: 'status';
      /** 一行原因，常驻可见，不进 tooltip。 */
      reason: string;
      fixHref?: never;
      fixLabel?: never;
    })
  | (DisabledReasonBaseProps & {
      cause: 'prerequisite';
      reason: string;
      /** 可操作的解除路径，不只告诉用户“不能”。 */
      fixHref?: string;
      fixLabel?: string;
    });

/**
 * 无权限时返回 null，避免灰按钮暗示「可以去申请」。
 * 状态 / 前置禁用：中性灰 + 原因常驻。
 */
export function DisabledReason({
  cause,
  reason,
  fixHref,
  fixLabel = '去处理',
  children,
  className,
}: DisabledReasonProps) {
  const reasonId = useId();
  if (cause === 'permission') return null;

  return (
    <div
      data-slot="disabled-reason"
      data-cause={cause}
      role="group"
      aria-describedby={reasonId}
      className={cn('flex min-w-0 flex-col gap-1', className)}
    >
      {children}
      <p
        id={reasonId}
        data-slot="disabled-reason-copy"
        className="text-sm text-muted-foreground"
      >
        {reason}
      </p>
      {cause === 'prerequisite' && fixHref ? (
        <Link
          href={fixHref}
          prefetch={false}
          className="w-fit text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          {fixLabel}
        </Link>
      ) : null}
    </div>
  );
}

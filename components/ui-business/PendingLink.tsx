'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type PendingLinkProps = ComponentProps<typeof Link> & {
  pending: boolean;
};

export function PendingLink({
  pending,
  className,
  onClick,
  onNavigate,
  tabIndex,
  ...props
}: PendingLinkProps) {
  return (
    <Link
      {...props}
      aria-disabled={pending || undefined}
      tabIndex={pending ? -1 : tabIndex}
      onClick={
        pending
          ? (event) => {
              event.preventDefault();
            }
          : onClick
      }
      onNavigate={
        pending
          ? (event) => {
              event.preventDefault();
            }
          : onNavigate
      }
      className={cn(
        className,
        pending && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
    />
  );
}

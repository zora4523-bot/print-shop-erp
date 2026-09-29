import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { FIELD_ARIA_READONLY_CLASS, FIELD_BASE_CLASS } from './field-styles';

export function NativeSelect({
  className,
  ...props
}: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        FIELD_BASE_CLASS,
        FIELD_ARIA_READONLY_CLASS,
        'flex min-h-11 py-2',
        className,
      )}
      {...props}
    />
  );
}

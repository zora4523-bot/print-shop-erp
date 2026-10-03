'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ConfirmActionController, ConfirmActionDialog } from './ConfirmActionDialog';
import { useNavigationGuard, type BlockedNavigation } from './navigation-guard';

export type PendingButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  'aria-busy' | 'children' | 'ref' | 'render'
> & {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel?: string;
  /** 整组提交语义，渲染在按钮旁。 */
  groupNote?: string;
  /** pending 时离开页面要拦截。 */
  blockNavigation?: boolean;
};

export function PendingButton({
  pending,
  children,
  pendingLabel = '正在保存…',
  groupNote,
  blockNavigation = true,
  type = 'submit',
  disabled,
  form,
  className,
  onClick,
  'aria-describedby': describedBy,
  ...buttonProps
}: PendingButtonProps) {
  const noteId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const navigationSourceRef = useRef<HTMLElement | null>(null);
  const [pendingNavigation, setPendingNavigation] =
    useState<BlockedNavigation | null>(null);

  useEffect(() => {
    const formElement = form
      ? document.getElementById(form)
      : buttonRef.current?.form;
    if (!(formElement instanceof HTMLFormElement)) return;

    const previous = formElement.getAttribute('aria-busy');
    formElement.setAttribute('aria-busy', pending ? 'true' : 'false');
    return () => {
      if (previous === null) formElement.removeAttribute('aria-busy');
      else formElement.setAttribute('aria-busy', previous);
    };
  }, [form, pending]);

  // Same-origin links, browser back/forward and reload/close while the
  // submission is in flight go through the shared navigation guard. External
  // links fall back to the browser's own beforeunload confirmation.
  const navigationGuard = useNavigationGuard({
    when: pending && blockNavigation,
    onBlocked: (navigation) => {
      navigationSourceRef.current = navigation.source;
      setPendingNavigation(navigation);
    },
  });

  const ariaDescribedBy = [describedBy, groupNote ? noteId : undefined]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button
        ref={buttonRef}
        type={type}
        form={form}
        disabled={disabled || pending}
        aria-busy={pending}
        aria-describedby={ariaDescribedBy}
        className={cn('min-h-11', className)}
        onClick={(event) => {
          // 新一轮由按钮发起的提交不继承上一轮可能残留的离开目标。
          setPendingNavigation(null);
          onClick?.(event);
        }}
        {...buttonProps}
      >
        {pending ? (
          <>
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            {pendingLabel}
          </>
        ) : (
          children
        )}
      </Button>
      {groupNote ? (
        <p id={noteId} className="max-w-sm text-xs text-muted-foreground">
          {groupNote}
        </p>
      ) : null}
      <ConfirmActionController level="L2"
        open={pending && pendingNavigation !== null}
        onOpenChange={(open) => {
          if (!open) setPendingNavigation(null);
        }}
        focusReturnRef={navigationSourceRef}
        cancelLabel="留在当前页面"
        onConfirm={() => {
          if (!pendingNavigation) return;
          if (pendingNavigation.kind === 'traverse') {
            pendingNavigation.resume();
            return;
          }
          // A full document load does not wait behind the in-flight action.
          // Release first so the browser does not ask a second time.
          navigationGuard.release();
          window.location.assign(pendingNavigation.href);
        }}>
        <ConfirmActionDialog action="当前操作仍在提交，仍要离开" changes={[]} consequences={[
          '操作可能已经到达服务器，返回后请先核对结果。',
          '在确认结果前不要重复提交同一操作。',
        ]} confirmText="仍要离开" />
      </ConfirmActionController>
    </div>
  );
}

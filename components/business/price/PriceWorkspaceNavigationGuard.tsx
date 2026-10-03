'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ConfirmActionController,
  ConfirmActionDialog,
  NAVIGATION_GUARD_SKIP_ATTRIBUTE,
  useNavigationGuard,
} from '@/components/ui-business';

type UnsavedTierState = {
  registered: boolean;
  tierCount: number;
};

type NavigationGuardContextValue = {
  unsaved: UnsavedTierState;
  reportTierChanges: (tierCount: number) => void;
  clearTierChanges: () => void;
  unregisterTierEditor: () => void;
};

const EMPTY_UNSAVED_STATE: UnsavedTierState = {
  registered: false,
  tierCount: 0,
};

const NavigationGuardContext = createContext<NavigationGuardContextValue>({
  unsaved: EMPTY_UNSAVED_STATE,
  reportTierChanges: () => undefined,
  clearTierChanges: () => undefined,
  unregisterTierEditor: () => undefined,
});

export function unsavedTierNavigationMessage(tierCount: number): string {
  return `当前选中组有 ${tierCount.toLocaleString('zh-CN')} 个档位尚未保存。离开后将丢失这些修改，仍要离开吗？`;
}

export function guardedPriceWorkspaceDestination(
  currentHref: string,
  nextHref: string,
): string | null {
  try {
    const current = new URL(currentHref);
    const destination = new URL(nextHref, current);
    if (
      destination.origin !== current.origin ||
      (destination.pathname === current.pathname &&
        destination.search === current.search)
    ) {
      return null;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return null;
  }
}

export function PriceWorkspaceNavigationGuardProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [unsaved, setUnsaved] = useState<UnsavedTierState>(
    EMPTY_UNSAVED_STATE,
  );
  const [pending, setPending] = useState<{ href: string; leave: () => void } | null>(null);
  const pendingLinkRef = useRef<HTMLAnchorElement | null>(null);

  const reportTierChanges = useCallback((tierCount: number) => {
    const normalizedCount = Math.max(0, Math.floor(tierCount));
    setUnsaved((current) =>
      current.registered && current.tierCount === normalizedCount
        ? current
        : { registered: true, tierCount: normalizedCount },
    );
  }, []);
  const clearTierChanges = useCallback(() => {
    setUnsaved({ registered: true, tierCount: 0 });
  }, []);
  const unregisterTierEditor = useCallback(() => {
    setUnsaved(EMPTY_UNSAVED_STATE);
  }, []);

  // The price editor is rendered inside the page while the global admin
  // sidebar lives outside it. The shared guard captures same-origin links at
  // document level (and browser back/forward) so moving section navigation into
  // that sidebar does not bypass draft safety. PriceWorkspaceLink confirms by
  // itself and is skipped through NAVIGATION_GUARD_SKIP_ATTRIBUTE.
  useNavigationGuard({
    when: unsaved.tierCount > 0,
    onBlocked: (navigation) => {
      const destination = guardedPriceWorkspaceDestination(
        window.location.href,
        navigation.href,
      );
      if (!destination) return;
      pendingLinkRef.current = navigation.source;
      // Continue the original navigation: a replayed link keeps its own
      // pending feedback (sidebar useLinkStatus); history returns by key.
      setPending({ href: destination, leave: navigation.resume });
    },
  });

  const value = useMemo<NavigationGuardContextValue>(
    () => ({
      unsaved,
      reportTierChanges,
      clearTierChanges,
      unregisterTierEditor,
    }),
    [
      clearTierChanges,
      reportTierChanges,
      unregisterTierEditor,
      unsaved,
    ],
  );

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
      <ConfirmActionController level="L2"
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        focusReturnRef={pendingLinkRef}
        cancelLabel="继续编辑"
        onConfirm={() => {
          pending?.leave();
        }}>
        <ConfirmActionDialog action="放弃未保存修改并离开" changes={[]} consequences={[
          `${unsaved.tierCount.toLocaleString('zh-CN')} 个未保存档位修改将丢失。`,
          '已保存的价目和已发布版本保持不变。',
        ]} confirmText="放弃修改并离开" danger />
      </ConfirmActionController>
    </NavigationGuardContext.Provider>
  );
}

export function usePriceWorkspaceUnsavedTierChanges(
  tierCount: number,
): () => void {
  const {
    reportTierChanges,
    clearTierChanges,
    unregisterTierEditor,
  } = useContext(NavigationGuardContext);

  useEffect(() => {
    reportTierChanges(tierCount);
  }, [reportTierChanges, tierCount]);

  useEffect(
    () => () => unregisterTierEditor(),
    [unregisterTierEditor],
  );

  return clearTierChanges;
}

export function PriceWorkspaceUnsavedSummary() {
  const { unsaved } = useContext(NavigationGuardContext);

  if (!unsaved.registered) {
    return (
      <span className="text-xs text-muted-foreground">
        当前未编辑价格阶梯
      </span>
    );
  }
  if (unsaved.tierCount === 0) {
    return (
      <span className="text-xs text-success-foreground">
        当前阶梯组无待保存修改
      </span>
    );
  }
  return (
    <span role="status" className="text-xs font-medium text-warning-foreground">
      1 组 · {unsaved.tierCount.toLocaleString('zh-CN')} 档待保存
    </span>
  );
}

type GuardedLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & {
  href: string;
};

export function PriceWorkspaceLink({
  href,
  onNavigate,
  replace = false,
  scroll = true,
  ...props
}: GuardedLinkProps) {
  const { unsaved } = useContext(NavigationGuardContext);
  const router = useRouter();
  const linkRef = useRef<HTMLAnchorElement | null>(null);
  const confirmedRef = useRef(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  return (
    <>
      <Link
        {...props}
        ref={linkRef}
        href={href}
        {...{ [NAVIGATION_GUARD_SKIP_ATTRIBUTE]: '' }}
        replace={replace}
        scroll={scroll}
        onNavigate={(event) => {
          let consumerPrevented = false;
          onNavigate?.({
            preventDefault: () => {
              consumerPrevented = true;
              event.preventDefault();
            },
          });
          if (consumerPrevented || unsaved.tierCount === 0 || confirmedRef.current) return;

          const destination = guardedPriceWorkspaceDestination(
            window.location.href,
            href,
          );
          if (!destination) return;
          event.preventDefault();
          setConfirmationOpen(true);
        }}
      />
      <ConfirmActionController level="L2"
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={linkRef}
        cancelLabel="继续编辑"
        onConfirm={() => {
          // Replay the link itself (keeps replace / scroll and its pending
          // state); the confirmation covers this one click only.
          const link = linkRef.current;
          if (!link) {
            if (replace) router.replace(href, { scroll });
            else router.push(href, { scroll });
            return;
          }
          confirmedRef.current = true;
          try {
            link.click();
          } finally {
            confirmedRef.current = false;
          }
        }}>
        <ConfirmActionDialog action="放弃未保存修改并离开" changes={[]} consequences={[
          `${unsaved.tierCount.toLocaleString('zh-CN')} 个未保存档位修改将丢失。`,
          '已保存的价目和已发布版本保持不变。',
        ]} confirmText="放弃修改并离开" danger />
      </ConfirmActionController>
    </>
  );
}

/**
 * 收费项目筛选表单：next/form 软导航（审查 #41）。原生 GET 提交时由
 * beforeunload 拦住未保存档位；软导航不触发 beforeunload，也不经过文档级
 * 链接拦截，所以这里在提交时自己判断：有未保存档位就先弹同一个确认层。
 */
export function PriceWorkspaceFilterForm({
  action,
  onSubmit,
  ...props
}: Omit<ComponentProps<typeof Form>, 'action'> & { action: string }) {
  const { unsaved } = useContext(NavigationGuardContext);
  const router = useRouter();
  const submitterRef = useRef<HTMLElement | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  return (
    <>
      <Form
        {...props}
        action={action}
        onSubmit={(event) => {
          onSubmit?.(event);
          if (event.defaultPrevented || unsaved.tierCount === 0) return;

          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          const target = new URL(action, window.location.href);
          const params = new URLSearchParams();
          for (const [name, value] of new FormData(event.currentTarget, submitter)) {
            if (typeof value === 'string') params.append(name, value);
          }
          target.search = params.toString();
          const destination = guardedPriceWorkspaceDestination(
            window.location.href,
            target.href,
          );
          if (!destination) return;

          event.preventDefault();
          submitterRef.current = submitter ?? event.currentTarget;
          setPendingHref(destination);
        }}
      />
      <ConfirmActionController level="L2"
        open={pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingHref(null);
        }}
        focusReturnRef={submitterRef}
        cancelLabel="继续编辑"
        onConfirm={() => {
          if (pendingHref) router.push(pendingHref);
        }}>
        <ConfirmActionDialog action="放弃未保存修改并离开" changes={[]} consequences={[
          `${unsaved.tierCount.toLocaleString('zh-CN')} 个未保存档位修改将丢失。`,
          '已保存的价目和已发布版本保持不变。',
        ]} confirmText="放弃修改并离开" danger />
      </ConfirmActionController>
    </>
  );
}

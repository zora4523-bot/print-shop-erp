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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmActionDialog } from '@/components/ui-business';

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
  return `当前选中组有 ${tierCount.toLocaleString('zh-CN')} 个档位尚未保存。离开后会丢失这些本地修改，仍要离开吗？`;
}

export function PriceWorkspaceNavigationGuardProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [unsaved, setUnsaved] = useState<UnsavedTierState>(
    EMPTY_UNSAVED_STATE,
  );

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

  useEffect(() => {
    if (unsaved.tierCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved.tierCount]);

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
        未保存状态以右侧表单为准
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
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  return (
    <>
      <Link
        {...props}
        ref={linkRef}
        href={href}
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
          if (consumerPrevented || unsaved.tierCount === 0) return;

          const current = new URL(window.location.href);
          const destination = new URL(href, current);
          if (
            destination.pathname === current.pathname &&
            destination.search === current.search
          ) {
            return;
          }
          event.preventDefault();
          setConfirmationOpen(true);
        }}
      />
      <ConfirmActionDialog
        level="L2"
        open={confirmationOpen}
        onOpenChange={setConfirmationOpen}
        focusReturnRef={linkRef}
        title="放弃未保存修改并离开？"
        description={unsavedTierNavigationMessage(unsaved.tierCount)}
        impactItems={[
          `${unsaved.tierCount.toLocaleString('zh-CN')} 个本地档位修改不会保存。`,
          '服务器上已保存的价目和已发布版本不会改变。',
        ]}
        confirmLabel="放弃修改并离开"
        cancelLabel="继续编辑"
        onConfirm={() => {
          if (replace) router.replace(href, { scroll });
          else router.push(href, { scroll });
        }}
      />
    </>
  );
}

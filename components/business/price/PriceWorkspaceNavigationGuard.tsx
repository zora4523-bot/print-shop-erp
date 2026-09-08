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
import { ConfirmActionController, ConfirmActionDialog } from '@/components/ui-business';

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
  const router = useRouter();
  const [unsaved, setUnsaved] = useState<UnsavedTierState>(
    EMPTY_UNSAVED_STATE,
  );
  const [pendingHref, setPendingHref] = useState<string | null>(null);
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

  useEffect(() => {
    if (unsaved.tierCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved.tierCount]);

  useEffect(() => {
    if (unsaved.tierCount === 0) return;

    const onDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (
        !anchor ||
        anchor.dataset.priceWorkspaceGuarded === 'true' ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      ) {
        return;
      }

      const destination = guardedPriceWorkspaceDestination(
        window.location.href,
        anchor.href,
      );
      if (!destination) return;

      event.preventDefault();
      event.stopPropagation();
      pendingLinkRef.current = anchor;
      setPendingHref(destination);
    };

    // The price editor is rendered inside the page while the global admin
    // sidebar lives outside it. Capture same-origin links at document level so
    // moving section navigation into that sidebar does not bypass draft safety.
    document.addEventListener('click', onDocumentClick, true);
    return () => document.removeEventListener('click', onDocumentClick, true);
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
      <ConfirmActionController level="L2"
        open={pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingHref(null);
        }}
        focusReturnRef={pendingLinkRef}
        cancelLabel="继续编辑"
        onConfirm={() => {
          if (pendingHref) router.push(pendingHref);
        }}>
        <ConfirmActionDialog action="放弃未保存修改并离开？" changes={[]} consequences={[
          `${unsaved.tierCount.toLocaleString('zh-CN')} 个未保存档位修改将丢失。`,
          '已保存的价目和已发布版本保持不变。',
        ]} confirmText="放弃修改并离开" />
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
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  return (
    <>
      <Link
        {...props}
        ref={linkRef}
        href={href}
        data-price-workspace-guarded="true"
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
          if (replace) router.replace(href, { scroll });
          else router.push(href, { scroll });
        }}>
        <ConfirmActionDialog action="放弃未保存修改并离开？" changes={[]} consequences={[
          `${unsaved.tierCount.toLocaleString('zh-CN')} 个未保存档位修改将丢失。`,
          '已保存的价目和已发布版本保持不变。',
        ]} confirmText="放弃修改并离开" />
      </ConfirmActionController>
    </>
  );
}

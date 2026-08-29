'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { History, Send } from 'lucide-react';
import {
  RULE_CENTER_HREFS,
  RULE_CENTER_SIDEBAR_ITEMS,
  priceVersionsHref,
} from '@/lib/navigation/rule-center';
import {
  getActiveAdminMenuHref,
  type AdminMenuItem,
} from '@/lib/navigation/admin-menu';

export type RuleCenterPriceVersionStream = {
  key: 'processing' | 'logistics';
  label: '加工费' | '物流费';
  currentVersion: number | null;
  draftVersion: number | null;
  draftId: string | null;
  scheduledVersion: number | null;
};

export type RuleCenterPriceVersionSummary = {
  state: 'ready' | 'hidden' | 'unavailable';
  streams: readonly RuleCenterPriceVersionStream[];
};

const EMPTY_VERSION_SUMMARY: RuleCenterPriceVersionSummary = {
  state: 'hidden',
  streams: [],
};

const PRICE_WORKSPACE_PATHS = [
  RULE_CENTER_HREFS.customerPricing,
  RULE_CENTER_HREFS.priceVersions,
] as const;

function isPriceWorkspacePath(pathname: string): boolean {
  return PRICE_WORKSPACE_PATHS.some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}

export function priceWorkspaceNavigationKey(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'toString'>,
): string {
  return `${pathname}?${searchParams.toString()}`;
}

const RULE_CENTER_MATCH_ITEMS: readonly AdminMenuItem[] =
  RULE_CENTER_SIDEBAR_ITEMS.map((item) => ({
    label: item.label,
    href: item.href,
    activeRouteBase: item.activeRouteBase,
    activeQuery: 'activeQuery' in item ? item.activeQuery : undefined,
    iconName: item.iconName,
    breadcrumbLabel: item.breadcrumbLabel,
    status: 'implemented',
  }));

function currentRuleCenterItem(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get'>,
) {
  const activeHref = getActiveAdminMenuHref(
    pathname,
    RULE_CENTER_MATCH_ITEMS,
    searchParams,
  );
  return RULE_CENTER_SIDEBAR_ITEMS.find((item) => item.href === activeHref);
}

function PriceStreamStatus({
  stream,
}: {
  stream: RuleCenterPriceVersionStream;
}) {
  return (
    <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border border-background/15 bg-background/5 px-2.5 text-[11px] font-semibold text-background/70 dark:border-card-foreground/15 dark:bg-card-foreground/5 dark:text-card-foreground/70">
      <span className="text-background/55 dark:text-card-foreground/55">
        {stream.label}
      </span>
      {stream.currentVersion !== null ? (
        <span className="font-mono text-background dark:text-card-foreground">
          当前 v{stream.currentVersion}
        </span>
      ) : (
        <span>暂无生效版</span>
      )}
      {stream.draftVersion !== null ? (
        <span className="text-warning">草稿 v{stream.draftVersion}</span>
      ) : null}
      {stream.scheduledVersion !== null ? (
        <span className="text-info">计划 v{stream.scheduledVersion}</span>
      ) : null}
    </span>
  );
}

export function RuleCenterWorkspaceBar({
  priceVersionSummary: initialPriceVersionSummary,
  loadPriceVersionSummary,
}: {
  priceVersionSummary?: RuleCenterPriceVersionSummary;
  loadPriceVersionSummary?: () => Promise<RuleCenterPriceVersionSummary>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isPriceWorkspace = isPriceWorkspacePath(pathname);
  const isVersionPage = pathname === RULE_CENTER_HREFS.priceVersions;
  const navigationKey = priceWorkspaceNavigationKey(pathname, searchParams);
  const [loadedPriceVersionSummary, setLoadedPriceVersionSummary] =
    useState<RuleCenterPriceVersionSummary>(EMPTY_VERSION_SUMMARY);
  const priceVersionSummary =
    initialPriceVersionSummary ?? loadedPriceVersionSummary;

  useEffect(() => {
    if (
      !isPriceWorkspace ||
      initialPriceVersionSummary ||
      !loadPriceVersionSummary
    ) {
      return;
    }

    let isActive = true;

    void loadPriceVersionSummary().then((summary) => {
      if (isActive) setLoadedPriceVersionSummary(summary);
    });

    return () => {
      isActive = false;
    };
  }, [
    initialPriceVersionSummary,
    isPriceWorkspace,
    loadPriceVersionSummary,
    navigationKey,
  ]);

  if (!isPriceWorkspace) return null;

  const current = currentRuleCenterItem(pathname, searchParams);
  const draftStreams = priceVersionSummary.streams.filter(
    (stream) => stream.draftId !== null,
  );
  const publishHref =
    draftStreams.length === 1
      ? priceVersionsHref(draftStreams[0]?.draftId ?? undefined)
      : RULE_CENTER_HREFS.priceVersions;

  return (
    <header
      className="admin-sticky-below-header sticky z-[8] mb-4 min-w-0 overflow-hidden rounded-xl border border-foreground/20 bg-foreground text-background shadow-sm dark:border-border dark:bg-card dark:text-card-foreground"
      aria-label="规则中心版本与发布"
    >
      <div className="flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm font-extrabold tracking-[0.06em]">
              规则配置中心
            </span>
            {current?.id !== 'overview' ? (
              <span className="hidden whitespace-nowrap text-xs font-medium text-background/55 lg:inline dark:text-card-foreground/55">
                / {current?.label}
              </span>
            ) : null}
          </div>
        </div>

        {priceVersionSummary.state === 'ready' ? (
          <div
            className="order-3 flex w-full min-w-0 gap-1.5 overflow-x-auto md:order-none md:w-auto"
            aria-label="客户价目版本状态"
          >
            {priceVersionSummary.streams.map((stream) => (
              <PriceStreamStatus key={stream.key} stream={stream} />
            ))}
          </div>
        ) : priceVersionSummary.state === 'unavailable' ? (
          <span className="order-3 w-full text-[11px] font-medium text-background/50 md:order-none md:w-auto dark:text-card-foreground/50">
            版本状态暂不可用
          </span>
        ) : null}

        {!isVersionPage ? (
          <nav
            aria-label="规则中心审阅与发布"
            className="ml-auto flex shrink-0 items-center gap-1.5"
          >
            <Link
              href={RULE_CENTER_HREFS.priceVersions}
              prefetch={false}
              aria-label="审阅价格版本变更"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-background/20 px-3 text-xs font-bold text-background transition-colors hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground dark:border-card-foreground/20 dark:text-card-foreground dark:hover:bg-card-foreground/10 dark:focus-visible:ring-card-foreground dark:focus-visible:ring-offset-card"
            >
              <History aria-hidden="true" className="size-3.5" />
              <span>
                {draftStreams.length > 0
                  ? `${draftStreams.length} 份草稿`
                  : '审阅变更'}
              </span>
            </Link>

            {draftStreams.length > 0 ? (
              <Link
                href={publishHref}
                prefetch={false}
                aria-label="进入价格版本发布"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-background px-3.5 text-xs font-extrabold text-foreground transition-colors hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground dark:bg-card-foreground dark:text-card dark:hover:bg-card-foreground/90 dark:focus-visible:ring-card-foreground dark:focus-visible:ring-offset-card"
              >
                <Send aria-hidden="true" className="size-3.5" />
                发布
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </header>
  );
}

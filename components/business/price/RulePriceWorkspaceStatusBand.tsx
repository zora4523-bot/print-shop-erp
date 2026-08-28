import type { ReactNode } from 'react';
import { GitCompareArrows } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { cn } from '@/lib/utils';
import {
  PriceWorkspaceLink,
  PriceWorkspaceUnsavedSummary,
} from './PriceWorkspaceNavigationGuard';

export type ExternalSalesChargeWorkspaceStatus =
  | 'CURRENT'
  | 'SCHEDULED'
  | 'UNAVAILABLE';

export type ExternalSalesChargeDraftSummary = {
  version: number;
  changeReason: string;
  changedCount: number;
  lastSavedLabel: string;
  compareHref: string;
  publishHref: string;
};

export function RulePriceWorkspaceStatusBand({
  draft,
  workspaceStatus,
  createDraftHref,
  createDraftEditor,
  createDraftOpen,
  createDraftBlockedReason,
}: {
  draft?: ExternalSalesChargeDraftSummary | null;
  workspaceStatus: ExternalSalesChargeWorkspaceStatus;
  createDraftHref?: string;
  createDraftEditor?: ReactNode;
  createDraftOpen?: boolean;
  createDraftBlockedReason?: string | null;
}) {
  if (draft) {
    return (
      <section
        aria-label="调价草稿状态"
        className="min-w-0 rounded-xl border border-warning/40 bg-warning/10 p-3 shadow-sm"
      >
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-warning/50 bg-warning/15 text-foreground"
              >
                调价草稿 v{draft.version}
              </Badge>
              <span className="font-sans text-sm font-semibold tabular-nums">
                {draft.changedCount} 处未发布
              </span>
              <PriceWorkspaceUnsavedSummary />
            </div>
            <p className="admin-wrap-anywhere mt-1.5 text-sm">
              {draft.changeReason}
              <span className="ml-2 text-xs text-muted-foreground">
                最近保存 {draft.lastSavedLabel}
              </span>
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <PriceWorkspaceLink
              href={draft.compareHref}
              prefetch={false}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'min-h-11',
              )}
            >
              <GitCompareArrows aria-hidden="true" />
              审阅变更
            </PriceWorkspaceLink>
            <PriceWorkspaceLink
              href={draft.publishHref}
              prefetch={false}
              className={cn(buttonVariants({ size: 'sm' }), 'min-h-11')}
            >
              校验并发布
            </PriceWorkspaceLink>
          </div>
        </div>
      </section>
    );
  }

  const status = {
    CURRENT: ['当前生效', '用于之后的新工单计价。'],
    SCHEDULED: ['等待生效', '计划版本生效前不能再发起调价。'],
    UNAVAILABLE: ['暂无生效价', '请在价格版本中检查。'],
  }[workspaceStatus];

  return (
    <section
      aria-label="价格状态"
      className="min-w-0 rounded-xl border bg-card p-3 shadow-sm"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">{status[0]}</Badge>
          <p className="text-sm text-muted-foreground">
            {createDraftBlockedReason ?? status[1]}
          </p>
        </div>
        {createDraftEditor ? null : createDraftHref ? (
          <PriceWorkspaceLink
            href={createDraftHref}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'min-h-11 shrink-0',
            )}
          >
            发起调价
          </PriceWorkspaceLink>
        ) : null}
      </div>
      {createDraftEditor ? (
        <Disclosure
          className="mt-3 rounded-lg border bg-muted/20 p-3"
          open={createDraftOpen}
        >
          <DisclosureSummary className="font-medium">
            发起调价
          </DisclosureSummary>
          <div className="border-t pt-3">{createDraftEditor}</div>
        </Disclosure>
      ) : null}
    </section>
  );
}

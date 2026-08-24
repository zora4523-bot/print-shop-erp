import { useId } from 'react';
import { GitCompareArrows, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ConflictResolutionPanelProps = {
  title?: string;
  description?: React.ReactNode;
  mineLabel?: string;
  latestLabel?: string;
  mine: React.ReactNode;
  latest: React.ReactNode;
  keepMineAction: React.ReactNode;
  useLatestAction: React.ReactNode;
  cancelAction: React.ReactNode;
  className?: string;
};

/**
 * 并发写入冲突的显式决策面板。组件只负责对照与三个动作插槽，不自行覆盖
 * 任一版本；调用方仍负责权限、版本号校验和持久化。
 */
export function ConflictResolutionPanel({
  title = '检测到其他人已更新此内容',
  description = '请比较两个版本后选择要保留的内容；系统不会自动覆盖。',
  mineLabel = '我的版本',
  latestLabel = '最新版本',
  mine,
  latest,
  keepMineAction,
  useLatestAction,
  cancelAction,
  className,
}: ConflictResolutionPanelProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <section
      data-slot="conflict-resolution-panel"
      role="alert"
      aria-live="assertive"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        'rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning-foreground',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0">
          <h2 id={titleId} className="font-medium">
            {title}
          </h2>
          <div id={descriptionId} className="mt-1 text-sm text-current/80">
            {description}
          </div>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
        <VersionSlot
          slot="mine"
          label={mineLabel}
          content={mine}
          action={keepMineAction}
        />
        <GitCompareArrows
          aria-hidden
          className="mx-auto size-5 self-center text-warning"
        />
        <VersionSlot
          slot="latest"
          label={latestLabel}
          content={latest}
          action={useLatestAction}
        />
      </div>

      <div
        data-slot="conflict-resolution-cancel"
        className="mt-3 flex justify-end"
      >
        {cancelAction}
      </div>
    </section>
  );
}

function VersionSlot({
  slot,
  label,
  content,
  action,
}: {
  slot: 'mine' | 'latest';
  label: string;
  content: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <section
      data-slot={`conflict-resolution-${slot}`}
      aria-label={label}
      className="flex min-w-0 flex-col rounded-lg border border-current/20 bg-background/80 p-3 text-foreground"
    >
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="mt-2 min-w-0 flex-1 text-sm text-muted-foreground">
        {content}
      </div>
      <div className="mt-3">{action}</div>
    </section>
  );
}

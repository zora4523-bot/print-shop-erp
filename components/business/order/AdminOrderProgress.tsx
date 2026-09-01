import type { AdminOrderWorkspaceRow } from '@/lib/order/admin-workspace';
import { cn } from '@/lib/utils';

type Progress = AdminOrderWorkspaceRow['progress'];

export function AdminOrderProgress({
  progress,
  compact = false,
}: {
  progress: Progress;
  compact?: boolean;
}) {
  const foiling = progressValue(progress.foilingProgress, progress.orderTotal);
  const packing = progressValue(progress.packingProgress, progress.orderTotal);
  const corrupt = progress.foilingOverLimit || progress.packingOverLimit;

  return (
    <div className={cn('min-w-0 space-y-1.5', compact && 'space-y-1')}>
      <ProgressLine
        label="烫金"
        value={progress.foilingProgress}
        total={progress.orderTotal}
        percent={foiling}
        invalid={progress.foilingOverLimit}
        compact={compact}
      />
      <ProgressLine
        label="打包"
        value={progress.packingProgress}
        total={progress.orderTotal}
        percent={packing}
        invalid={progress.packingOverLimit}
        warning={progress.packingAhead}
        compact={compact}
      />
      {corrupt ? (
        <p role="alert" className="text-[10px] font-semibold text-destructive">
          进度超过工单数量 · 查数据
        </p>
      ) : progress.packingAhead ? (
        <p role="status" className="text-[10px] font-semibold text-warning-foreground">
          打包进度领先烫金，请核对
        </p>
      ) : progress.stagnant ? (
        <p role="alert" className="text-[10px] font-semibold text-destructive">
          下发满 {progress.stagnationDays} 天仍无有效扫码认领
        </p>
      ) : null}
    </div>
  );
}

function ProgressLine({
  label,
  value,
  total,
  percent,
  invalid,
  warning = false,
  compact,
}: {
  label: string;
  value: string;
  total: string;
  percent: number;
  invalid: boolean;
  warning?: boolean;
  compact: boolean;
}) {
  return (
    <div>
      <div
        className={cn(
          'mb-0.5 flex items-center justify-between gap-2 text-[10px] tabular-nums',
          invalid && 'font-semibold text-destructive',
          !invalid && warning && 'font-semibold text-warning-foreground',
          !invalid && !warning && 'text-muted-foreground',
        )}
      >
        <span>{label}</span>
        <span>
          {formatQuantity(value)} / {formatQuantity(total)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className={cn(
          'overflow-hidden rounded-full bg-muted',
          compact ? 'h-1' : 'h-1.5',
        )}
      >
        <span
          className={cn(
            'block h-full rounded-full transition-[width]',
            invalid
              ? 'bg-destructive'
              : warning
                ? 'bg-warning'
                : label === '烫金'
                  ? 'bg-foreground'
                  : 'bg-muted-foreground',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function progressValue(value: string, total: string): number {
  const numerator = Number(value);
  const denominator = Number(total);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (numerator / denominator) * 100));
}

function formatQuantity(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('zh-CN', { maximumFractionDigits: 3 })
    : value;
}

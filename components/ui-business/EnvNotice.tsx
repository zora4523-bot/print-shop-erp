import { cn } from '@/lib/utils';

export type EnvNoticeProps = {
  children: React.ReactNode;
  className?: string;
};

/** 环境 / mock / DEVELOPMENT 提示。中性灰 + 左侧色条，不与业务预警同色。 */
export function EnvNotice({ children, className }: EnvNoticeProps) {
  return (
    <aside
      data-slot="env-notice"
      aria-label="环境提示"
      className={cn(
        'rounded-md border border-border border-l-4 border-l-info-neutral bg-muted/40 px-4 py-3 text-sm text-info-neutral-foreground',
        className,
      )}
    >
      {children}
    </aside>
  );
}

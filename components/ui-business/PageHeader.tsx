import { cn } from '@/lib/utils';

// 页面标题区——所有 admin 页面的标准顶部，统一 spacing / typography /
// actions 摆放，避免每个页面自己写&ldquo;<h1 + 副标题 + 右上按钮组>&rdquo;。

export type PageHeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  // breadcrumb 槽——AdminBreadcrumb 已存在，业务侧塞进来即可。
  breadcrumb?: React.ReactNode;
  // 右侧 actions：按钮组、过滤器开关等。
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn('space-y-1.5', className)}
    >
      {breadcrumb}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="admin-wrap-anywhere text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

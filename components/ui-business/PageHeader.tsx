import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

// 页面标题区——管理端、账单、销售、师傅端所有页面的唯一页头
// （ui-规范 §8.3）。统一 H1 字号、返回入口、状态徽标与右侧操作的摆放，
// 不再允许页面手写 `<h1 + 返回按钮 + 徽标>`。

export type PageHeaderBack = {
  href: string;
  /** 完整文案，统一写成「返回<目标页名>」，例如「返回工单列表」。 */
  label: string;
};

export type PageHeaderProps = {
  title: string;
  subtitle?: React.ReactNode;
  // breadcrumb 槽——AdminBreadcrumb 已存在，业务侧塞进来即可。
  breadcrumb?: React.ReactNode;
  /** 二级页（详情 / 新建 / 编辑 / 盘点 / 归档）唯一的返回入口，渲染在标题左上。 */
  back?: PageHeaderBack;
  /** 标题右侧的状态徽标（StatusBadge / ActiveStatusBadge），不写进副标题文字。 */
  status?: React.ReactNode;
  /** 标题上方的范围胶囊（如规则中心的作用域与生效方式）。 */
  eyebrow?: React.ReactNode;
  // 右侧 actions：按钮组、过滤器开关等。
  actions?: React.ReactNode;
  /** worker：师傅端 H5 的统一字号（20px）；默认管理端 24px。 */
  size?: 'default' | 'worker';
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  back,
  status,
  eyebrow,
  actions,
  size = 'default',
  className,
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn('min-w-0 space-y-1.5', className)}
    >
      {breadcrumb}
      {back ? (
        <Link
          href={back.href}
          data-slot="page-header-back"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div
              data-slot="page-header-eyebrow"
              className="mb-2 flex min-w-0 flex-wrap items-center gap-2"
            >
              {eyebrow}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1
              className={cn(
                'admin-wrap-anywhere min-w-0 font-semibold tracking-tight',
                size === 'worker' ? 'text-xl' : 'text-2xl',
              )}
            >
              {title}
            </h1>
            {status ? (
              <div
                data-slot="page-header-status"
                className="flex shrink-0 flex-wrap items-center gap-2"
              >
                {status}
              </div>
            ) : null}
          </div>
          {subtitle ? (
            <div className="admin-wrap-anywhere mt-1 text-sm text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

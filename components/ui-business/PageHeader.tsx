import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PendingLink } from './PendingLink';

// 页面标题区——管理端、账单、销售、师傅端所有页面的唯一页头
// （ui-规范 §8.3）。统一 H1 字号、返回入口、状态徽标与右侧操作的摆放，
// 不再允许页面手写 `<h1 + 返回按钮 + 徽标>`。

export type PageHeaderBack = {
  href: string;
  /** 完整文案，统一写成「返回<目标页名>」，例如「返回工单列表」。 */
  label: string;
  /**
   * 表单提交中锁住返回入口（aria-disabled、tabindex -1、阻止点击），
   * 语义与 PendingLink 一致。只在客户端表单持有 pending 时传入。
   */
  pending?: boolean;
  /**
   * 站内导航即将发生时调用（Next Link onNavigate；Cmd/Ctrl 新标签打开不触发）。
   * 有未保存内容时调用 `event.preventDefault()` 取消本次导航，改由调用方弹出
   * 「放弃修改并离开」确认层——`beforeunload` 拦不住站内跳转。
   */
  onNavigate?: (event: { preventDefault(): void }) => void;
};

/** 页面 H1 的字重与换行（字号按 size 另给）；无权限空态等整页标题复用它，保持同一层级。 */
export const PAGE_TITLE_CLASS = 'admin-wrap-anywhere min-w-0 font-semibold tracking-tight';

const BACK_CLASS =
  '-ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export type PageHeaderProps = {
  title: string;
  /** h1 的 id，供外层 `<section aria-labelledby>` 引用。 */
  titleId?: string;
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
  titleId,
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
        back.pending === undefined ? (
          <Link href={back.href} onNavigate={back.onNavigate} data-slot="page-header-back" className={BACK_CLASS}>
            <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
            {back.label}
          </Link>
        ) : (
          <PendingLink
            href={back.href}
            pending={back.pending}
            onNavigate={back.onNavigate}
            data-slot="page-header-back"
            className={BACK_CLASS}
          >
            <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
            {back.label}
          </PendingLink>
        )
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
              id={titleId}
              className={cn(
                PAGE_TITLE_CLASS,
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

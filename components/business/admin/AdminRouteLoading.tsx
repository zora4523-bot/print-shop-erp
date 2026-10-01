import { ContentSkeleton, FORM_PAGE_WIDTH_CLASS, SectionLoading } from '@/components/ui-business';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

type AdminRouteLoadingVariant = 'list' | 'detail' | 'form';

/**
 * 管理端路由级 loading。骨架形状必须和目标页一致（审查 #26，CLS）：
 * - list：列表页，表格骨架；
 * - detail：详情页，页头（返回 + 标题 + 状态）+ 卡片区，不画表格；页头没有返回入口的
 *   详情（工单详情：返回由顶栏面包屑承担）传 `withBack={false}`，骨架同样不画返回占位；
 * - form：新建 / 编辑 / 盘点等表单页，页头 + FormPage 宽度（max-w-3xl）的字段卡片。
 *
 * 刻意没有 loading 的分组（登记）：`(billing)` 与 `(admin-forms)` 是零 JS
 * 原生表单组，streaming 边界会让无 JS 时页面停在骨架上；不要给它们补 loading.tsx。
 */
export function AdminRouteLoading({
  label = '正在加载页面',
  variant = 'list',
  withBack = true,
}: {
  label?: string;
  variant?: AdminRouteLoadingVariant;
  /** 目标页页头是否有 `PageHeader` 返回入口；只影响 detail / form 骨架。 */
  withBack?: boolean;
}) {
  if (variant === 'list') {
    return (
      <section className="space-y-6" data-slot="admin-route-loading" data-variant="list">
        <ContentSkeleton rows={6} variant="table" keepChrome={false} label={label} />
      </section>
    );
  }

  return (
    <SectionLoading label={label.replace(/^正在加载/, '')}>
      <section
        data-slot="admin-route-loading"
        data-variant={variant}
        className={cn(variant === 'form' && FORM_PAGE_WIDTH_CLASS, 'min-w-0 space-y-6')}
      >
        <HeaderSkeleton withBack={withBack} />
        {variant === 'form' ? (
          <div className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="space-y-2">
                <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
                <Skeleton className="h-10 w-full motion-reduce:animate-none" />
              </div>
            ))}
            <Skeleton className="h-10 w-28 motion-reduce:animate-none" />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Skeleton className="h-48 w-full rounded-xl border bg-card motion-reduce:animate-none" />
              <Skeleton className="h-64 w-full rounded-xl border bg-card motion-reduce:animate-none" />
            </div>
            <Skeleton className="h-56 w-full rounded-xl border bg-card motion-reduce:animate-none" />
          </div>
        )}
      </section>
    </SectionLoading>
  );
}

function HeaderSkeleton({ withBack }: { withBack?: boolean }) {
  return (
    <div className="space-y-1.5">
      {withBack ? <Skeleton className="h-5 w-24 motion-reduce:animate-none" /> : null}
      <Skeleton className="h-8 w-56 max-w-full motion-reduce:animate-none" />
      <Skeleton className="h-4 w-80 max-w-full motion-reduce:animate-none" />
    </div>
  );
}

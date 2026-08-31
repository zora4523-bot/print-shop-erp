import { ContentSkeleton } from '@/components/ui-business';

export default function ExternalSalesChargeItemsLoading() {
  return (
    <div
      className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]"
      aria-busy="true"
      aria-live="polite"
    >
      <ContentSkeleton variant="table" rows={6} />
      <aside className="hidden min-w-0 rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm xl:block">
        选择一个收费项目
      </aside>
      <span className="sr-only">正在加载收费项目工作台</span>
    </div>
  );
}

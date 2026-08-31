import { ContentSkeleton } from '@/components/ui-business';

export function AdminRouteLoading({
  label = '正在加载页面',
}: {
  label?: string;
}) {
  return (
    <section
      className="space-y-6"
      data-slot="admin-route-loading"
    >
      <ContentSkeleton
        rows={6}
        variant="table"
        keepChrome={false}
        label={label}
      />
    </section>
  );
}

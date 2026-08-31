import { ContentSkeleton } from '@/components/ui-business';

export default function AdminLoading() {
  return (
    <div className="space-y-4">
      <ContentSkeleton
        rows={4}
        variant="card"
        keepChrome={false}
        label="正在加载管理后台"
      />
    </div>
  );
}

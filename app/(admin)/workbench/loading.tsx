import { ContentSkeleton } from '@/components/ui-business';

export default function Loading() {
  return <ContentSkeleton variant="card" rows={3} label="正在加载工作台" />;
}

import { EmptyState } from '@/components/ui-business';

export default function AdminNotFound() {
  return <EmptyState kind="no-access" homeHref="/owner" />;
}

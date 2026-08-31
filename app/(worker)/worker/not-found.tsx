import { EmptyState } from '@/components/ui-business';

export default function WorkerNotFound() {
  return <EmptyState kind="no-access" homeHref="/worker/tasks" />;
}

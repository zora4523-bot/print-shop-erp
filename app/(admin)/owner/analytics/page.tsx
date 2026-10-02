import { requirePermission } from '@/lib/auth/permissions';
import { PageHeader } from '@/components/ui-business';
import { OwnerAnalytics } from '@/components/business/dashboard/OwnerAnalytics';

export const metadata = { title: '经营概览' };

export default async function OwnerAnalyticsPage() {
  await requirePermission('report:all');

  return (
    <div className="space-y-4">
      <PageHeader
        title="经营概览"
      />
      <OwnerAnalytics />
    </div>
  );
}
